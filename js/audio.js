// js/audio.js
// 统一端侧语音录制、VAD 智能静音切除与 WAV 编码传输引擎
// 1. 基于 Web Audio API 捕获硬件麦克风并自适应重采样为 16,000 Hz 单声道。
// 2. 内置强制启用本地 VAD（自适应底噪学习 + 250ms 前置环形缓冲 + 800ms 静音悬挂倒计时）。
// 3. 纯原生 JavaScript 零依赖生成 16-Bit Linear PCM RIFF/WAV 二进制并编码为 Base64。
// 4. 将切除静音后的有效语音载荷分发至 /api/audio 边缘网关完成云端 ASR 识别。

import { state } from './state.js';

/**
 * 将任意输入采样率的高精度 Float32Array 缓冲区线性下采样至 16,000 Hz 单声道
 */
export function downsampleTo16k(buffer, sampleRate) {
  if (sampleRate === 16000) return buffer;
  const ratio = sampleRate / 16000;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : buffer[offsetBuffer];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

/**
 * 将 16kHz Float32Array 样本序列封装为合规的 44 字节 RIFF/WAV (16-bit Linear PCM) ArrayBuffer
 */
export function encodeWAV(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);              // AudioFormat (1 = Linear PCM)
  view.setUint16(22, 1, true);              // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true);     // SampleRate (16000)
  view.setUint32(28, sampleRate * 2, true); // ByteRate (16000 * 1 * 2 = 32000)
  view.setUint16(32, 2, true);              // BlockAlign (1 * 2 = 2)
  view.setUint16(34, 16, true);             // BitsPerSample (16-bit)

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // 写入 16-bit 有符号 PCM 数据
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

/**
 * 将 ArrayBuffer 快速转换为 Base64 字符串（分块规避参数栈溢出）
 */
export function bufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * 核心语音转录客户端通信调度器
 */
export async function transcribeAudio(base64Audio, model = 'bytedance/doubao-seed-asr-2.0', token = '') {
  const gateToken = token || state.token || localStorage.getItem('zm.gate.token') || '';
  const response = await fetch('/api/audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Token': gateToken
    },
    body: JSON.stringify({
      audio: base64Audio,
      model,
      format: 'wav'
    })
  });

  if (!response.ok) {
    let errDetail = '';
    try {
      const errJson = await response.json();
      errDetail = errJson.error || errJson.detail || `HTTP ${response.status}`;
    } catch (_) {
      errDetail = `HTTP ${response.status}`;
    }
    throw new Error(errDetail);
  }

  const data = await response.json();
  return data.text || '';
}

/**
 * 具有 VAD 强制静音切除、前置环形缓冲与能量感知的端侧录音机
 */
export class AudioRecorder {
  constructor(options = {}) {
    this.options = Object.assign({
      sampleRate: 16000,
      frameSize: 2048,           // 脚本处理器缓冲区大小
      preBufferMs: 250,          // 前置语音回溯环形缓冲（防止开头爆破音/清辅音被裁切）
      hangoverMs: 800,           // 尾部静音悬挂窗口（毫秒）
      minSpeechDurationMs: 300,  // 最短有效语音时长（低于此值视为误触取消）
      maxSpeechDurationMs: 60000 // 单次录音物理上限（60秒自动截断）
    }, options);

    this.state = 'idle'; // 'idle' | 'listening' | 'transcribing'
    this.audioCtx = null;
    this.stream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.gainNode = null;

    // VAD 状态变量
    this.recordedChunks = [];
    this.speechStarted = false;
    this.speechStartTime = 0;
    this.lastSpeechTime = 0;
    this.noiseFloor = 0.008; // 动态底噪初值
    this.preBuffer = [];     // 存储最近 250ms 的 16k Float32 帧
    this.maxPreBufferFrames = 0;

    // 回调事件
    this.onStateChange = options.onStateChange || (() => {});
    this.onVolume = options.onVolume || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || (() => {});
  }

  setState(newState) {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange(this.state);
    }
  }

  /**
   * 启动麦克风录音与 VAD 监听
   */
  async start() {
    if (this.state !== 'idle') return;

    try {
      // 1. 申请麦克风权限（优先采用单声道、回声消除与自动降噪）
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      const inputSampleRate = this.audioCtx.sampleRate;
      this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);

      // 计算 250ms 对应的 16k 样本帧数
      const samplesPerFrame16k = Math.round(this.options.frameSize / (inputSampleRate / 16000));
      this.maxPreBufferFrames = Math.max(2, Math.ceil((16000 * (this.options.preBufferMs / 1000)) / samplesPerFrame16k));

      this.recordedChunks = [];
      this.preBuffer = [];
      this.speechStarted = false;
      this.speechStartTime = 0;
      this.lastSpeechTime = 0;
      this.noiseFloor = 0.008;

      // 创建处理节点
      this.processorNode = this.audioCtx.createScriptProcessor(this.options.frameSize, 1, 1);
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 0; // 静音本地监听，避免啸叫

      this.processorNode.onaudioprocess = (e) => {
        this.processAudioFrame(e.inputBuffer.getChannelData(0), inputSampleRate);
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.setState('listening');
    } catch (err) {
      this.cleanup();
      let friendlyMsg = '无法启动语音输入';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendlyMsg = '麦克风权限未允许，请在浏览器或系统设置中授权麦克风访问';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendlyMsg = '未检测到可用的麦克风输入设备';
      } else if (err.name === 'NotReadableError') {
        friendlyMsg = '麦克风已被其他应用占用，无法访问';
      } else {
        friendlyMsg = `麦克风初始化失败: ${err.message || String(err)}`;
      }
      this.onError(friendlyMsg);
    }
  }

  /**
   * 实时音频帧分析与 VAD 决策
   */
  processAudioFrame(inputData, inputSampleRate) {
    if (this.state !== 'listening') return;

    // 1. 统一重采样至 16kHz
    const frame16k = downsampleTo16k(inputData, inputSampleRate);

    // 2. 计算当前帧的 RMS 能量
    let sum = 0;
    const len = frame16k.length;
    for (let i = 0; i < len; i++) {
      sum += frame16k[i] * frame16k[i];
    }
    const rms = Math.sqrt(sum / len);

    // 计算归一化音量 (0 - 1)，供前端麦克风动效渲染
    const normalizedVol = Math.min(1, rms * 12);
    this.onVolume(normalizedVol);

    const now = Date.now();

    // 3. 动态底噪学习与语音阈值判决
    if (!this.speechStarted) {
      // 维护前置 250ms 环形缓冲（保存人声触发前的小片段，保留声母音素）
      this.preBuffer.push(new Float32Array(frame16k));
      if (this.preBuffer.length > this.maxPreBufferFrames) {
        this.preBuffer.shift();
      }

      // 平滑学习背景环境底噪
      this.noiseFloor = this.noiseFloor * 0.94 + rms * 0.06;
      const speechTriggerThreshold = Math.max(0.015, this.noiseFloor * 2.8);

      // 人声触发判定
      if (rms > speechTriggerThreshold) {
        this.speechStarted = true;
        this.speechStartTime = now;
        this.lastSpeechTime = now;

        // 释放前置环形缓冲，拼入主录音队列
        while (this.preBuffer.length > 0) {
          this.recordedChunks.push(this.preBuffer.shift());
        }
        this.recordedChunks.push(new Float32Array(frame16k));
      }
    } else {
      // 已经进入说话阶段：持续追加音频帧
      this.recordedChunks.push(new Float32Array(frame16k));

      // 人声维持门限（略低于触发门限，具备滞后效应）
      const speechHoldThreshold = Math.max(0.010, this.noiseFloor * 1.8);

      if (rms > speechHoldThreshold) {
        this.lastSpeechTime = now;
      } else {
        // 静音检测：若持续静音超过 hangoverMs (默认 800ms)，触发自动完结
        if (now - this.lastSpeechTime >= this.options.hangoverMs) {
          this.stop();
          return;
        }
      }

      // 超时安全上限保护（超过 60 秒自动收口）
      if (now - this.speechStartTime >= this.options.maxSpeechDurationMs) {
        this.stop();
      }
    }
  }

  /**
   * 手动或 VAD 自动结束录音，进入 ASR 识别流程
   */
  async stop() {
    if (this.state !== 'listening') return;

    const chunksToProcess = this.recordedChunks;
    const wasSpeechStarted = this.speechStarted;
    const durationMs = wasSpeechStarted ? Date.now() - this.speechStartTime : 0;

    this.cleanup();

    // 误触丢弃判定：若未检测到任何有效人声，或说话总时长过短 (< 300ms)
    if (!wasSpeechStarted || chunksToProcess.length === 0 || durationMs < this.options.minSpeechDurationMs) {
      this.setState('idle');
      this.onVolume(0);
      return;
    }

    this.setState('transcribing');

    try {
      // 1. 合并所有 16k Float32 分块
      let totalLength = 0;
      for (let i = 0; i < chunksToProcess.length; i++) {
        totalLength += chunksToProcess[i].length;
      }
      const fullBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (let i = 0; i < chunksToProcess.length; i++) {
        fullBuffer.set(chunksToProcess[i], offset);
        offset += chunksToProcess[i].length;
      }

      // 2. 编码为 16-Bit Linear PCM WAV 格式
      const wavArrayBuffer = encodeWAV(fullBuffer, 16000);
      const base64Audio = bufferToBase64(wavArrayBuffer);

      // 3. 读取用户在设置中设定的 ASR 模型（默认为豆包大模型 ASR）
      const asrModel = state.asrModel || localStorage.getItem('zm.asr.model') || 'bytedance/doubao-seed-asr-2.0';

      // 4. 调用边缘网关完成语音转文字
      const transcript = await transcribeAudio(base64Audio, asrModel);

      this.setState('idle');
      this.onVolume(0);

      if (transcript && transcript.trim()) {
        this.onTranscript(transcript.trim());
      } else {
        this.onError('未能识别到有效文字内容，请重试');
      }

    } catch (err) {
      this.setState('idle');
      this.onVolume(0);
      this.onError(err.message || '语音转文字处理失败');
    }
  }

  /**
   * 中途取消录制，丢弃音频帧
   */
  cancel() {
    this.cleanup();
    this.setState('idle');
    this.onVolume(0);
  }

  /**
   * 彻底释放 Web Audio 硬件资源与麦克风流
   */
  cleanup() {
    if (this.processorNode) {
      try {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      } catch (_) {}
      this.processorNode = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try { this.gainNode.disconnect(); } catch (_) {}
      this.gainNode = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
      this.audioCtx = null;
    }
    if (this.stream) {
      try {
        this.stream.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      this.stream = null;
    }
    this.recordedChunks = [];
    this.preBuffer = [];
  }
}
