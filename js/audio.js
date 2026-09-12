// js/audio.js
// 统一端侧语音录制、VAD 智能静音切除与 WAV 编码传输引擎
// 1. 基于 Web Audio API 捕获硬件麦克风并自适应重采样为 16,000 Hz 单声道。
// 2. 内置强制启用本地 VAD（自适应底噪学习 + 250ms 前置环形缓冲 + 800ms 静音悬挂倒计时）。
// 3. 纯原生 JavaScript 零依赖生成 16-Bit Linear PCM RIFF/WAV 二进制并编码为 Base64。
// 4. 将切除静音后的有效语音载荷分发至 /api/audio 边缘网关完成云端 ASR 识别。

import { state, el, LS } from './state.js';
import { sileroVAD } from './vad-onnx.js';
import { t } from './i18n.js';

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
  const gateToken = token || state.token || localStorage.getItem(LS.token) || localStorage.getItem('zm.token') || '';
  const headers = {
    'Content-Type': 'application/json'
  };
  if (gateToken) {
    headers['X-Access-Token'] = gateToken;
    headers['Authorization'] = `Bearer ${gateToken}`;
  }

  const response = await fetch('/api/audio', {
    method: 'POST',
    headers,
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
  return {
    text: (typeof data.text === 'string' ? data.text : '') || '',
    notice: data.notice || ''
  };
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
      hangoverMs: 3000,          // 尾部静音悬挂窗口（3.0秒，充足容忍语流自然换气与思考停顿）
      minSpeechDurationMs: 300,  // 最短有效语音时长（低于此值视为误触取消）
      maxSpeechDurationMs: 60000,// 单次录音物理上限（60秒自动截断）
      noSpeechTimeoutMs: 6000,   // 首声无声超时门限（非按住模式下6秒未开口自动释放）
      manualMode: true           // 按住说话模式（默认由物理按键按下与释放全权掌控，禁用启发式静音提前掐断）
    }, options);

    this.state = 'idle'; // 'idle' | 'listening' | 'transcribing'
    this.audioCtx = null;
    this.stream = null;
    this.sourceNode = null;
    this.filterNode = null;
    this.processorNode = null;
    this.gainNode = null;

    // VAD 状态变量
    this.recordedChunks = [];
    this.speechStarted = false;
    this.speechStartIndex = -1;
    this.lastSpeechTime = 0;
    this.noiseFloor = 0.004; // 动态底噪初值
    this.preBuffer = [];     // 存储最近 250ms 的 16k Float32 帧
    this.maxPreBufferFrames = 0;
    this.noSpeechTimer = null;
    this.consecutiveSpeechFrames = 0;
    this.validSpeechFramesCount = 0;
    this.frameCount = 0;

    // 回调事件
    this.onStateChange = options.onStateChange || (() => {});
    this.onVolume = options.onVolume || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onError = options.onError || (() => {});
    this.onNotice = options.onNotice || ((msg) => this.onError(msg));
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
      // 1. 申请麦克风权限（优先采用单声道、回声消除与自动降噪，降级容灾兜底）
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (_) {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

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
      this.startTime = Date.now();
      this.speechStarted = false;
      this.speechStartIndex = -1;
      this.lastSpeechTime = Date.now();
      this.lastSpeechIndex = -1;
      this.noiseFloor = 0.004;
      this.consecutiveSpeechFrames = 0;
      this.validSpeechFramesCount = 0;
      this.frameCount = 0;

      // 首声 6 秒无声超时看门狗硬件定时器（仅在非 manualMode 免提模式下生效）
      if (this.noSpeechTimer) clearTimeout(this.noSpeechTimer);
      if (!this.options.manualMode) {
        this.noSpeechTimer = setTimeout(() => {
          if (this.state === 'listening' && !this.speechStarted) {
            this.stop();
          }
        }, this.options.noSpeechTimeoutMs);
      }

      // 准备神经网络 VAD 状态（若用户启用了 Silero ONNX 引擎）
      if (state.vadEngine === 'silero-onnx') {
        sileroVAD.resetState();
        if (!sileroVAD.isReady()) {
          sileroVAD.loadModel().catch((err) => {
            console.warn('[AudioRecorder] Silero ONNX 暂未就绪，降级调度端侧能量 VAD:', err);
          });
        }
      }

      // 2. 创建音频处理节点（优先采用现代化 AudioWorkletNode 独立线程处理，规避 ScriptProcessor 废弃警告）
      let workletReady = false;
      if (this.audioCtx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
          const workletCode = `
            class ZenAudioCaptureProcessor extends AudioWorkletProcessor {
              constructor() {
                super();
                this.bufferSize = 2048;
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
              }
              process(inputs) {
                const input = inputs[0];
                if (input && input[0]) {
                  const channel = input[0];
                  for (let i = 0; i < channel.length; i++) {
                    this.buffer[this.bufferIndex++] = channel[i];
                    if (this.bufferIndex >= this.bufferSize) {
                      this.port.postMessage(this.buffer);
                      this.buffer = new Float32Array(this.bufferSize);
                      this.bufferIndex = 0;
                    }
                  }
                }
                return true;
              }
            }
            registerProcessor('zen-audio-capture', ZenAudioCaptureProcessor);
          `;
          const blob = new Blob([workletCode], { type: 'application/javascript' });
          const workletUrl = URL.createObjectURL(blob);
          await this.audioCtx.audioWorklet.addModule(workletUrl);
          URL.revokeObjectURL(workletUrl);

          this.processorNode = new AudioWorkletNode(this.audioCtx, 'zen-audio-capture');
          this.processorNode.port.onmessage = (e) => {
            this.processAudioFrame(e.data, inputSampleRate);
          };
          workletReady = true;
        } catch (workletErr) {
          console.warn('[AudioEngine] AudioWorklet init failed, falling back to ScriptProcessor:', workletErr);
          workletReady = false;
        }
      }

      if (!workletReady) {
        this.processorNode = this.audioCtx.createScriptProcessor(this.options.frameSize, 1, 1);
        this.processorNode.onaudioprocess = (e) => {
          this.processAudioFrame(e.inputBuffer.getChannelData(0), inputSampleRate);
        };
      }

      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 0; // 静音本地监听，避免啸叫

      // 硬件级高通滤波器（85Hz Cutoff，Q=0.707 巴特沃斯响应）：
      // 物理级滤除麦克风直流偏置 (DC offset)、桌面机械共振及 50Hz/60Hz 工频市电底噪
      try {
        this.filterNode = this.audioCtx.createBiquadFilter();
        this.filterNode.type = 'highpass';
        this.filterNode.frequency.setValueAtTime(85, this.audioCtx.currentTime);
        this.filterNode.Q.setValueAtTime(0.707, this.audioCtx.currentTime);
        this.sourceNode.connect(this.filterNode);
        this.filterNode.connect(this.processorNode);
      } catch (filterErr) {
        console.warn('[AudioEngine] BiquadFilter highpass unavailable, bypassing:', filterErr);
        this.filterNode = null;
        this.sourceNode.connect(this.processorNode);
      }

      this.processorNode.connect(this.gainNode);
      this.gainNode.connect(this.audioCtx.destination);

      this.setState('listening');
    } catch (err) {
      this.cleanup();
      let friendlyMsg = state.lang === 'en' ? 'Cannot start voice input' : '无法启动语音输入';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        friendlyMsg = state.lang === 'en'
          ? 'Microphone permission not granted. Please allow microphone access in your browser or system settings.'
          : '麦克风权限未开启，请在浏览器地址栏或系统设置中允许麦克风权限';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        friendlyMsg = state.lang === 'en'
          ? 'No microphone device detected.'
          : '未检测到可用的麦克风硬件设备';
      } else if (err.name === 'NotReadableError') {
        friendlyMsg = state.lang === 'en'
          ? 'Microphone is currently in use by another application.'
          : '麦克风已被其他应用独占，无法访问';
      } else {
        friendlyMsg = state.lang === 'en'
          ? `Microphone initialization failed: ${err.message || String(err)}`
          : `麦克风初始化失败: ${err.message || String(err)}`;
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

    // 2. 软件级二次均值去直流偏置（DC Mean Detrending）：将残存的硬件恒定电平偏移归零
    const len = frame16k.length;
    let frameSum = 0;
    for (let i = 0; i < len; i++) {
      frameSum += frame16k[i];
    }
    const frameMean = frameSum / len;
    for (let i = 0; i < len; i++) {
      frame16k[i] -= frameMean;
    }

    // 3. 计算当前去偏置帧的 RMS 能量
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += frame16k[i] * frame16k[i];
    }
    const rms = Math.sqrt(sum / len);

    // 归一化音量反馈 (0 - 1)
    const normalizedVol = Math.min(1, rms * 15);
    this.onVolume(normalizedVol);

    this.frameCount++;
    const now = Date.now();
    const frameCopy = new Float32Array(frame16k);
    this.recordedChunks.push(frameCopy);
    const currentIndex = this.recordedChunks.length - 1;

    // 4. VAD 人声检测决策
    const useOnnx = state.vadEngine === 'silero-onnx' && sileroVAD.isReady();

    if (useOnnx) {
      // 4A. Silero 深度神经网络引擎（异步推流至 ONNX Runtime WASM）
      sileroVAD.process(frame16k).then((vadRes) => {
        if (this.state !== 'listening') return;
        if (vadRes && vadRes.isSpeech) {
          if (!this.speechStarted) {
            this.speechStarted = true;
            if (this.noSpeechTimer) {
              clearTimeout(this.noSpeechTimer);
              this.noSpeechTimer = null;
            }
            this.speechStartIndex = Math.max(0, currentIndex - this.maxPreBufferFrames - 3);
          }
          this.lastSpeechTime = now;
          this.lastSpeechIndex = currentIndex;
          this.validSpeechFramesCount++;
        }
      }).catch((onnxErr) => {
        console.warn('[AudioRecorder] Silero ONNX 帧推流异常:', onnxErr);
      });
    } else {
      // 4B. 内置自适应能量 VAD（零外部依赖秒开兜底）
      const inWarmup = this.frameCount <= 10;
      if (inWarmup) {
        if (rms < 0.020) {
          this.noiseFloor = Math.max(this.noiseFloor, rms);
        }
      } else if (!this.speechStarted) {
        if (rms < 0.020) {
          this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05;
        }
      } else if (rms < this.noiseFloor * 1.5) {
        this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
      }

      const speechTriggerThreshold = Math.max(0.018, this.noiseFloor * 2.5);
      const speechHoldThreshold = Math.max(0.010, this.noiseFloor * 1.5);

      if (!inWarmup && rms > speechTriggerThreshold) {
        this.consecutiveSpeechFrames++;
        if (this.consecutiveSpeechFrames >= 2) {
          if (!this.speechStarted) {
            this.speechStarted = true;
            if (this.noSpeechTimer) {
              clearTimeout(this.noSpeechTimer);
              this.noSpeechTimer = null;
            }
            this.speechStartIndex = Math.max(0, currentIndex - this.maxPreBufferFrames - 2);
          }
          this.lastSpeechTime = now;
          this.lastSpeechIndex = currentIndex;
          this.validSpeechFramesCount++;
        }
      } else if (this.speechStarted && rms > speechHoldThreshold) {
        this.consecutiveSpeechFrames = 0;
        this.lastSpeechTime = now;
        this.lastSpeechIndex = currentIndex;
        this.validSpeechFramesCount++;
      } else {
        this.consecutiveSpeechFrames = 0;
      }
    }

    // 6. VAD 自动静音截断（人声出现后，若持续静音超过 hangoverMs，自动停止并识别；按住模式下禁用）
    if (!this.options.manualMode && this.speechStarted && (now - this.lastSpeechTime >= this.options.hangoverMs)) {
      this.stop();
      return;
    }

    // 7. 首声超时自愈：若开启录音后持续 6 秒完全未检测到发声，自动停止并释放麦克风硬件（按住模式下禁用）
    if (!this.options.manualMode && !this.speechStarted && (now - this.startTime >= this.options.noSpeechTimeoutMs)) {
      this.stop();
      return;
    }

    // 8. 超时物理上限（默认 60 秒自动收口）
    if (now - this.startTime >= this.options.maxSpeechDurationMs) {
      this.stop();
    }
  }

  /**
   * 手动或 VAD 自动结束录音，进入 ASR 识别流程
   */
  async stop() {
    if (this.state !== 'listening') return;

    let chunksToProcess = this.recordedChunks;
    const hadSpeech = this.speechStarted &&
      this.validSpeechFramesCount >= 2 &&
      this.speechStartIndex >= 0 &&
      this.lastSpeechIndex >= this.speechStartIndex;

    this.cleanup();

    // 1. 全程无声判定：如果 VAD 未捕获人声活动 (speechStarted === false) 或有效人声不足 6 帧 (~250ms)，
    // 说明用户未曾开口或仅为轻微杂音，直接优雅收口，绝对不向云端 ASR 发送无声垃圾载荷（规避 upstream HTTP 500 且省流省费用）
    if (!hadSpeech || !chunksToProcess || chunksToProcess.length === 0) {
      this.setState('idle');
      this.onVolume(0);
      this.onNotice(t('composer.voiceNoAudio') || (state.lang === 'en' ? 'No valid speech detected' : '未检测到有效声音输入'));
      return;
    }

    // 2. VAD 智能静音裁剪：切除头部长时间未说话的静音与尾部冗余静音
    const tailFrames = Math.max(8, Math.ceil(this.maxPreBufferFrames * 1.5));
    const endIndex = Math.min(chunksToProcess.length, this.lastSpeechIndex + tailFrames);
    chunksToProcess = chunksToProcess.slice(this.speechStartIndex, endIndex);

    // 3. 计算切除静音后的纯人声有效样本总量与持续时间
    let totalLength = 0;
    for (let i = 0; i < chunksToProcess.length; i++) {
      totalLength += chunksToProcess[i].length;
    }
    const effectiveSpeechDurationMs = (totalLength / 16000) * 1000;

    // 4. 录音过短判定（有效人声低于 300ms 视为轻微按键碰撞或环境杂音误触）
    if (effectiveSpeechDurationMs < this.options.minSpeechDurationMs) {
      this.setState('idle');
      this.onVolume(0);
      this.onNotice(state.lang === 'en' ? 'Voice input too short to recognize' : '声音过短，未识别到有效内容');
      return;
    }

    // 5. 唯有确认存在有效人声切片时，才进入 'transcribing' 转录状态并锁定 UI
    this.setState('transcribing');
    this.onVolume(0);

    try {
      // 合并 16k Float32 分块
      const fullBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (let i = 0; i < chunksToProcess.length; i++) {
        fullBuffer.set(chunksToProcess[i], offset);
        offset += chunksToProcess[i].length;
      }

      // 编码为 16-Bit Linear PCM WAV 格式
      const wavArrayBuffer = encodeWAV(fullBuffer, 16000);
      const base64Audio = bufferToBase64(wavArrayBuffer);

      // 读取设置中的 ASR 模型
      const asrModel = state.asrModel || localStorage.getItem('zm.asr.model') || 'bytedance/doubao-seed-asr-2.0';

      // 调用边缘网关完成语音转文字
      const result = await transcribeAudio(base64Audio, asrModel);

      this.setState('idle');
      this.onVolume(0);

      const transcript = typeof result === 'string' ? result : (result.text || '');
      const serverNotice = result && result.notice ? result.notice : '';

      if (transcript && transcript.trim()) {
        this.onTranscript(transcript.trim());
      } else if (serverNotice) {
        this.onNotice(serverNotice);
      } else {
        this.onNotice(state.lang === 'en' ? 'No text content recognized' : '未能识别到文字内容');
      }

    } catch (err) {
      this.setState('idle');
      this.onVolume(0);
      this.onError(err.message || (state.lang === 'en' ? 'Speech-to-text processing failed' : '语音转文字处理失败'));
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
    if (this.noSpeechTimer) {
      clearTimeout(this.noSpeechTimer);
      this.noSpeechTimer = null;
    }
    if (this.processorNode) {
      try {
        if (this.processorNode.port) {
          this.processorNode.port.onmessage = null;
          if (typeof this.processorNode.port.close === 'function') {
            this.processorNode.port.close();
          }
        }
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      } catch (_) {}
      this.processorNode = null;
    }
    if (this.filterNode) {
      try { this.filterNode.disconnect(); } catch (_) {}
      this.filterNode = null;
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

/* ---------- Voice Dictation UI & Waveform Visualizer Controller ---------- */
export function initVoiceDictation({ toast = () => {}, autoGrow = () => {}, syncSend = () => {} } = {}) {
  let recorder = null;
  let voiceTimerInterval = null;
  let secondsElapsed = 0;

  const MIC_ICON_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>
  `;
  const KEYBOARD_ICON_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
      <line x1="6" y1="8" x2="6.01" y2="8"></line>
      <line x1="10" y1="8" x2="10.01" y2="8"></line>
      <line x1="14" y1="8" x2="14.01" y2="8"></line>
      <line x1="18" y1="8" x2="18.01" y2="8"></line>
      <line x1="6" y1="12" x2="6.01" y2="12"></line>
      <line x1="10" y1="12" x2="10.01" y2="12"></line>
      <line x1="14" y1="12" x2="14.01" y2="12"></line>
      <line x1="18" y1="12" x2="18.01" y2="12"></line>
      <line x1="7" y1="16" x2="17" y2="16"></line>
    </svg>
  `;
  const STOP_ICON_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2.5"></rect>
    </svg>
  `;
  const SPINNER_ICON_SVG = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="spin">
      <circle cx="12" cy="12" r="9" stroke-opacity="0.25"></circle>
      <path d="M12 3a9 9 0 0 1 9 9"></path>
    </svg>
  `;

  function ensureVoiceOverlayStyles() {
    if (document.getElementById('zen-voice-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'zen-voice-overlay-styles';
    style.textContent = `
      #composer.in-voice-mode .composer-main-row #send,
      #composer.in-voice-mode .composer-main-row #stop {
        display: none !important;
      }
      #composer.in-voice-mode .composer-main-row {
        align-items: center;
      }
      .composer-voice-overlay {
        flex: 1 1 auto;
        min-width: 0;
        width: 100%;
        min-height: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-elev, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--line, rgba(255, 255, 255, 0.12));
        border-radius: 12px;
        padding: 0 16px;
        box-sizing: border-box;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }
      @media (max-width: 640px) {
        #composer.in-voice-mode {
          padding: 7px 10px 10px 12px;
        }
        .composer-voice-overlay {
          min-height: 56px;
          height: 56px;
          border-radius: 16px;
          padding: 0 20px;
          box-shadow: 0 3px 12px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .composer-voice-overlay .voice-bar-mic-icon {
          width: 20px;
          height: 20px;
        }
        .composer-voice-overlay .voice-bar-prompt,
        .composer-voice-overlay .voice-overlay-status {
          font-size: 15.5px;
          font-weight: 600;
          letter-spacing: 0.4px;
        }
      }
      .composer-voice-overlay:hover:not(.is-pressing):not(.is-transcribing) {
        background: rgba(255, 255, 255, 0.08);
        border-color: var(--accent, #7f77dd);
      }
      .composer-voice-overlay.is-touch-down {
        background: rgba(127, 119, 221, 0.1);
        border-color: var(--accent, #7f77dd);
        transform: scale(0.99);
      }
      .composer-voice-overlay.is-pressing {
        background: rgba(255, 74, 74, 0.16);
        border-color: rgba(255, 74, 74, 0.7);
        box-shadow: 0 0 22px rgba(255, 74, 74, 0.35), inset 0 2px 4px rgba(0, 0, 0, 0.3);
        transform: scale(0.985);
      }
      .composer-voice-overlay.is-cancelling {
        background: rgba(255, 74, 74, 0.28);
        border-color: #ff4a4a;
        box-shadow: 0 0 26px rgba(255, 74, 74, 0.55), inset 0 2px 4px rgba(0, 0, 0, 0.35);
      }
      .composer-voice-overlay.is-transcribing {
        border-color: rgba(127, 119, 221, 0.6);
        background: rgba(127, 119, 221, 0.12);
        cursor: wait;
      }
      .voice-overlay-resting,
      .voice-overlay-active {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        font-size: 14.5px;
        font-weight: 550;
        color: var(--fg, #eee);
        pointer-events: none;
        letter-spacing: 0.3px;
        width: 100%;
        text-align: center;
      }
      .voice-bar-mic-icon {
        color: var(--accent, #7f77dd);
        transition: transform 0.15s;
        flex-shrink: 0;
        width: 18px;
        height: 18px;
      }
      .composer-voice-overlay:hover .voice-bar-mic-icon {
        transform: scale(1.12);
      }
      .voice-overlay-active {
        display: none;
      }
      .composer-voice-overlay.is-pressing .voice-overlay-resting,
      .composer-voice-overlay.is-transcribing .voice-overlay-resting {
        display: none;
      }
      .composer-voice-overlay.is-pressing .voice-overlay-active,
      .composer-voice-overlay.is-transcribing .voice-overlay-active {
        display: flex;
      }
      .voice-overlay-status {
        font-size: 14.5px;
        color: var(--fg, #eee);
        font-weight: 600;
        letter-spacing: 0.2px;
        text-align: center;
        transition: color 0.15s;
      }
      .composer-voice-overlay.is-cancelling .voice-overlay-status {
        color: #ff4a4a;
        font-weight: 700;
      }
      .composer-voice-overlay.is-transcribing .voice-overlay-status {
        color: var(--accent, #7f77dd);
      }
      @keyframes voice-btn-shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-5px); }
        40%, 80% { transform: translateX(5px); }
      }
      .composer-voice-overlay.shake-hint {
        animation: voice-btn-shake 0.32s ease-in-out;
        border-color: var(--accent, #7f77dd) !important;
      }
      .composer-icon-btn.mode-voice {
        color: var(--accent, #7f77dd);
        background: var(--accent-glow, rgba(127, 119, 221, 0.15));
        border: 1px solid var(--accent, #7f77dd);
      }
    `;
    document.head.appendChild(style);
  }

  function ensureVoiceOverlay() {
    ensureVoiceOverlayStyles();
    let overlay = el.voiceOverlay || document.getElementById('composer-voice-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'composer-voice-overlay';
      overlay.className = 'composer-voice-overlay';
      overlay.style.display = 'none';
      overlay.setAttribute('role', 'button');
      overlay.setAttribute('tabindex', '0');
      overlay.setAttribute('aria-live', 'polite');
      overlay.setAttribute('aria-label', t('composer.voiceHoldToSpeak') || (state.lang === 'en' ? 'Hold to Speak' : '按住 说话'));
      overlay.innerHTML = `
        <div class="voice-overlay-resting">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="voice-bar-mic-icon">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span id="voice-bar-prompt" class="voice-bar-prompt">${t('composer.voiceHoldToSpeak') || (state.lang === 'en' ? 'Hold to Speak' : '按住 说话')}</span>
        </div>
        <div class="voice-overlay-active">
          <span id="voice-overlay-status" class="voice-overlay-status">${t('composer.voiceReleaseToSend') || (state.lang === 'en' ? 'Release to Finish' : '松开 结束')}</span>
        </div>
      `;
      const mainRow = document.getElementById('composer-main-row');
      if (mainRow) {
        const inputEl = document.getElementById('input');
        if (inputEl && inputEl.nextSibling) {
          mainRow.insertBefore(overlay, inputEl.nextSibling);
        } else {
          mainRow.appendChild(overlay);
        }
      }
    }
    el.voiceOverlay = overlay;
    el.voiceStatus = overlay.querySelector('#voice-overlay-status') || document.getElementById('voice-overlay-status');
    el.voiceBarPrompt = overlay.querySelector('#voice-bar-prompt') || document.getElementById('voice-bar-prompt');
    return overlay;
  }

  /* ---------- Floating Voice HUD Island Reference & Cache ---------- */
  let hudCapsuleEl = null;
  let hudStatusEl = null;
  let hudTimerEl = null;
  let hudCountdownEl = null;
  let hudWaveEl = null;
  let hudGestureHintEl = null;
  let hudBars = [];

  function ensureVoiceHud() {
    if (!hudCapsuleEl) {
      hudCapsuleEl = document.getElementById('voice-hud-capsule');
      if (hudCapsuleEl) {
        hudStatusEl = hudCapsuleEl.querySelector('#hud-status-text');
        hudTimerEl = hudCapsuleEl.querySelector('#hud-timer');
        hudCountdownEl = hudCapsuleEl.querySelector('#hud-countdown');
        hudWaveEl = hudCapsuleEl.querySelector('#hud-wave-visualizer');
        hudGestureHintEl = hudCapsuleEl.querySelector('#hud-gesture-hint');
        hudBars = hudWaveEl ? hudWaveEl.querySelectorAll('.hud-bar') : [];
      }
    }
    return hudCapsuleEl;
  }

  function updateWaveform(vol) {
    // Drive Floating HUD Island 16-bar wave
    ensureVoiceHud();
    if (hudBars && hudBars.length > 0) {
      const center = (hudBars.length - 1) / 2;
      hudBars.forEach((bar, idx) => {
        const factor = 1 - Math.abs(idx - center) / (center + 1);
        const jitter = 0.7 + Math.random() * 0.6;
        const scale = Math.max(0.2, Math.min(1.0, (vol * 3.0 * factor * jitter) + 0.2));
        bar.style.transform = `scaleY(${scale.toFixed(2)})`;
      });
    }
  }

  function resetWaveform() {
    // Reset Floating HUD Island bars
    ensureVoiceHud();
    if (hudBars && hudBars.length > 0) {
      hudBars.forEach((bar) => {
        bar.style.transform = 'scaleY(0.2)';
      });
    }
  }

  let composerVoiceMode = false;

  function switchToVoiceMode() {
    composerVoiceMode = true;
    const composer = document.getElementById('composer');
    if (composer) composer.classList.add('in-voice-mode');
    const overlay = ensureVoiceOverlay();
    if (el.input) el.input.style.display = 'none';
    overlay.style.display = 'flex';
    overlay.classList.remove('is-touch-down', 'is-pressing', 'is-cancelling', 'is-transcribing', 'shake-hint');
    ensureVoiceHud();
    if (hudCapsuleEl) {
      hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
      if (hudCountdownEl) hudCountdownEl.style.display = 'none';
    }
    if (el.voiceBarPrompt) {
      el.voiceBarPrompt.textContent = t('composer.voiceHoldToSpeak') || (state.lang === 'en' ? 'Hold to Speak' : '按住 说话');
    }
    if (el.voiceBtn) {
      el.voiceBtn.classList.add('mode-voice');
      el.voiceBtn.classList.remove('recording', 'voice-on', 'transcribing');
      el.voiceBtn.innerHTML = KEYBOARD_ICON_SVG;
      el.voiceBtn.title = t('composer.voiceSwitchToText') || (state.lang === 'en' ? 'Switch to keyboard input' : '切换为键盘输入');
    }
  }

  function switchToTextMode() {
    composerVoiceMode = false;
    const composer = document.getElementById('composer');
    if (composer) composer.classList.remove('in-voice-mode');
    const overlay = ensureVoiceOverlay();
    overlay.style.display = 'none';
    overlay.classList.remove('is-touch-down', 'is-pressing', 'is-cancelling', 'is-transcribing', 'shake-hint');
    ensureVoiceHud();
    if (hudCapsuleEl) {
      hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
      if (hudCountdownEl) hudCountdownEl.style.display = 'none';
    }
    clearInterval(voiceTimerInterval);
    resetWaveform();

    if (el.input) {
      el.input.style.display = '';
      el.input.focus();
    }
    if (el.voiceBtn) {
      el.voiceBtn.classList.remove('mode-voice', 'recording', 'voice-on', 'transcribing');
      el.voiceBtn.innerHTML = MIC_ICON_SVG;
      el.voiceBtn.title = t('composer.voiceSwitchToVoice') || (state.lang === 'en' ? 'Switch to push-to-talk' : '切换为按住说话');
    }
    syncSend();
  }

  function updateVoiceUI(status) {
    if (!el.voiceBtn) return;
    const overlay = ensureVoiceOverlay();
    ensureVoiceHud();

    if (status === 'listening') {
      overlay.classList.add('is-pressing');
      overlay.classList.remove('is-transcribing', 'is-cancelling');
      if (el.voiceStatus) {
        el.voiceStatus.textContent = t('composer.voiceReleaseToSend') || (state.lang === 'en' ? 'Release to Finish' : '松开 结束');
        el.voiceStatus.style.color = '';
      }

      // Activate floating HUD island
      if (hudCapsuleEl) {
        hudCapsuleEl.classList.add('active');
        hudCapsuleEl.classList.remove('cancelling', 'transcribing');
      }
      if (hudStatusEl) {
        hudStatusEl.textContent = t('composer.voiceRecording') || (state.lang === 'en' ? 'Recording' : '正在录音');
      }
      if (hudTimerEl) {
        hudTimerEl.textContent = '00:00';
      }
      if (hudCountdownEl) {
        hudCountdownEl.style.display = 'none';
      }
      if (hudGestureHintEl) {
        hudGestureHintEl.textContent = t('composer.voiceSlideToCancel') || (state.lang === 'en' ? '▲ Slide up to cancel · Release to send' : '▲ 上滑取消 · 松开发送');
      }

      if (el.send) el.send.disabled = true;

      // Prime wave bars on HUD island
      updateWaveform(0.12);

      // Start elapsed duration timer with 10s countdown alert
      secondsElapsed = 0;
      clearInterval(voiceTimerInterval);
      voiceTimerInterval = setInterval(() => {
        secondsElapsed++;
        const maxSec = 60;
        const remaining = maxSec - secondsElapsed;

        const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
        const s = String(secondsElapsed % 60).padStart(2, '0');
        const timeStr = `${m}:${s}`;
        if (hudTimerEl) hudTimerEl.textContent = timeStr;

        // Approaching 60s limit (remaining <= 10s)
        if (remaining <= 10 && remaining > 0) {
          if (hudStatusEl && (!hudCapsuleEl || !hudCapsuleEl.classList.contains('cancelling'))) {
            hudStatusEl.textContent = t('composer.voiceApproachingLimit', { remaining });
          }
          if (hudCountdownEl) {
            hudCountdownEl.style.display = 'inline-flex';
            hudCountdownEl.textContent = `${remaining}s`;
          }
        } else if (remaining <= 0) {
          clearInterval(voiceTimerInterval);
          if (hudStatusEl) hudStatusEl.textContent = t('composer.voiceLimitReached') || (state.lang === 'en' ? 'Time limit reached, transcribing...' : '已达上限，正在转录…');
          if (hudCountdownEl) hudCountdownEl.style.display = 'none';
          const rec = ensureRecorder();
          if (rec.state === 'listening') {
            rec.stop();
          }
        }
      }, 1000);

    } else if (status === 'transcribing') {
      clearInterval(voiceTimerInterval);
      overlay.classList.add('is-transcribing');
      overlay.classList.remove('is-pressing', 'is-cancelling');
      if (el.voiceStatus) {
        el.voiceStatus.textContent = t('composer.voiceTranscribing') || (state.lang === 'en' ? 'Transcribing speech...' : '正在转录文本...');
        el.voiceStatus.style.color = '';
      }
      if (hudCapsuleEl) {
        hudCapsuleEl.classList.add('active', 'transcribing');
        hudCapsuleEl.classList.remove('cancelling');
      }
      if (hudStatusEl) {
        hudStatusEl.textContent = t('composer.voiceTranscribing') || (state.lang === 'en' ? 'Transcribing speech...' : '正在转录文本...');
      }
      if (hudCountdownEl) {
        hudCountdownEl.style.display = 'none';
      }
      if (hudGestureHintEl) {
        hudGestureHintEl.textContent = '';
      }

      if (el.voiceBtn) {
        el.voiceBtn.classList.add('transcribing');
        el.voiceBtn.innerHTML = SPINNER_ICON_SVG;
      }
      if (el.send) el.send.disabled = true;

    } else {
      // Idle / Finished
      clearInterval(voiceTimerInterval);
      overlay.classList.remove('is-touch-down', 'is-pressing', 'is-transcribing', 'is-cancelling', 'shake-hint');
      if (hudCapsuleEl) {
        hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
        if (hudCountdownEl) hudCountdownEl.style.display = 'none';
      }
      if (el.voiceStatus) {
        el.voiceStatus.textContent = t('composer.voiceReleaseToSend') || (state.lang === 'en' ? 'Release to Finish' : '松开 结束');
        el.voiceStatus.style.color = '';
      }
      resetWaveform();

      if (composerVoiceMode) {
        if (el.voiceBtn) {
          el.voiceBtn.classList.remove('recording', 'voice-on', 'transcribing');
          el.voiceBtn.classList.add('mode-voice');
          el.voiceBtn.innerHTML = KEYBOARD_ICON_SVG;
          el.voiceBtn.title = t('composer.voiceSwitchToText') || (state.lang === 'en' ? 'Switch to keyboard input' : '切换为键盘输入');
        }
      } else {
        switchToTextMode();
      }
    }
  }

  function ensureRecorder() {
    if (!recorder) {
      recorder = new AudioRecorder({
        manualMode: true,
        onStateChange: (recState) => {
          updateVoiceUI(recState);
        },
        onVolume: (vol) => {
          updateWaveform(vol);
        },
        onTranscript: (text) => {
          if (el.input && text) {
            const cur = el.input.value.trim();
            el.input.value = (cur ? cur + ' ' : '') + text;
            el.input.dispatchEvent(new Event('input', { bubbles: true }));
            autoGrow();
            syncSend();
          }
          toast(t('composer.voiceCompleted') || (state.lang === 'en' ? 'Speech recognition complete' : '语音识别完成'), 'info');
          // Behavior A: Auto-revert to editor so user can immediately review/edit/send
          switchToTextMode();
        },
        onNotice: (msg) => {
          updateVoiceUI('idle');
          toast(msg, 'info');
          switchToTextMode();
        },
        onError: (err) => {
          updateVoiceUI('idle');
          toast(err, 'error');
          switchToTextMode();
        }
      });
    }
    return recorder;
  }

  // Tactile Haptic Vibration Engine
  function triggerHaptic(type = 'start') {
    // 1. W3C Vibration API (Standard Android Browsers & WebView)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      try {
        if (type === 'start') {
          navigator.vibrate(100); // 100ms balanced, crisp tactile pulse on hold
        } else if (type === 'cancel') {
          navigator.vibrate([40, 40, 40]); // Double-pulse alert for cancellation
        } else if (type === 'drag-cancel') {
          navigator.vibrate(30); // Subtle tick when sliding into cancel zone
        } else if (type === 'drag-back') {
          navigator.vibrate(20); // Reassuring tick when returning to record zone
        } else if (type === 'finish') {
          navigator.vibrate(40); // Clean confirmation tick on send
        }
      } catch (_) {}
    }
    // 2. Capacitor Native Haptics (Native Android & iOS Vibration Engine)
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
      try {
        const Haptics = window.Capacitor.Plugins.Haptics;
        if (type === 'start') {
          if (typeof Haptics.vibrate === 'function') {
            Haptics.vibrate({ duration: 110 }).catch(() => {
              Haptics.impact?.({ style: 'Heavy' }).catch(() => {});
            });
          } else {
            Haptics.impact?.({ style: 'Heavy' }).catch(() => {});
          }
        } else if (type === 'cancel') {
          Haptics.notification?.({ type: 'Warning' }).catch(() => {});
        } else if (type === 'drag-cancel') {
          Haptics.impact?.({ style: 'Medium' }).catch(() => {});
        } else if (type === 'finish' || type === 'drag-back') {
          Haptics.impact?.({ style: 'Light' }).catch(() => {});
        }
      } catch (_) {}
    }
  }

  // W3C Pointer Events Binding for Push-to-Talk (Hold-to-Speak)
  const overlay = ensureVoiceOverlay();
  const HOLD_THRESHOLD_MS = 200; // Must hold for at least 200ms to engage recording
  let isPointerDown = false;
  let hasHoldTriggered = false;
  let holdTimer = null;
  let pressStartTime = 0;
  let activePointerId = null;
  let wasInCancelZone = false;

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rec = ensureRecorder();
    if (rec.state === 'transcribing') return;

    e.preventDefault();
    isPointerDown = true;
    hasHoldTriggered = false;
    wasInCancelZone = false;
    activePointerId = e.pointerId;

    try {
      overlay.setPointerCapture(activePointerId);
    } catch (_) {}

    // Immediate visual touch feedback: button visually depresses on touch
    overlay.classList.add('is-touch-down');

    // Start hold threshold timer: user must hold for >= 200ms to trigger recording
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(async () => {
      if (!isPointerDown) return;
      hasHoldTriggered = true;
      overlay.classList.remove('is-touch-down');

      // 1. Tactile Phone Shake (Haptics)
      triggerHaptic('start');

      // 2. Start recording engine & display HUD
      pressStartTime = Date.now();
      await rec.start();
    }, HOLD_THRESHOLD_MS);
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!isPointerDown || !hasHoldTriggered) return;
    const rect = overlay.getBoundingClientRect();
    const isCancelArea = e.clientY < rect.top - 45;
    ensureVoiceHud();

    if (isCancelArea) {
      if (!wasInCancelZone) {
        triggerHaptic('drag-cancel');
        wasInCancelZone = true;
      }
      overlay.classList.add('is-cancelling');
      if (hudCapsuleEl) hudCapsuleEl.classList.add('cancelling');
      if (el.voiceStatus) {
        el.voiceStatus.textContent = t('composer.voiceReleaseToCancel') || (state.lang === 'en' ? 'Release to cancel' : '松开 取消录音');
        el.voiceStatus.style.color = '#ff6b6b';
      }
      if (hudStatusEl) {
        hudStatusEl.textContent = state.lang === 'en' ? 'Release to Cancel' : '松开 取消录音';
      }
      if (hudGestureHintEl) {
        hudGestureHintEl.textContent = t('composer.voiceReleaseToCancel') || (state.lang === 'en' ? '✕ Release to cancel' : '✕ 松开手指，取消发送');
      }
    } else {
      if (wasInCancelZone) {
        triggerHaptic('drag-back');
        wasInCancelZone = false;
      }
      overlay.classList.remove('is-cancelling');
      if (hudCapsuleEl) hudCapsuleEl.classList.remove('cancelling');
      if (el.voiceStatus) {
        el.voiceStatus.textContent = t('composer.voiceReleaseToSend') || (state.lang === 'en' ? 'Release to Finish' : '松开 结束');
        el.voiceStatus.style.color = '';
      }
      if (hudStatusEl) {
        hudStatusEl.textContent = t('composer.voiceRecording') || (state.lang === 'en' ? 'Recording' : '正在录音');
      }
      if (hudGestureHintEl) {
        hudGestureHintEl.textContent = t('composer.voiceSlideToCancel') || (state.lang === 'en' ? '▲ Slide up to cancel · Release to send' : '▲ 上滑取消 · 松开发送');
      }
    }
  });

  const handlePointerRelease = async (e) => {
    if (!isPointerDown) return;
    isPointerDown = false;

    overlay.classList.remove('is-touch-down');

    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    try {
      if (activePointerId !== null) {
        overlay.releasePointerCapture(activePointerId);
      }
    } catch (_) {}
    activePointerId = null;

    // Case 1: Released BEFORE hold threshold (i.e. click/tap only)
    if (!hasHoldTriggered) {
      overlay.classList.remove('is-pressing', 'is-cancelling');
      ensureVoiceHud();
      if (hudCapsuleEl) hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');

      // Visual shake hint to teach user to hold
      overlay.classList.add('shake-hint');
      setTimeout(() => overlay.classList.remove('shake-hint'), 350);
      toast(t('composer.voiceShortTapWarning') || (state.lang === 'en' ? 'Hold to speak, release to finish' : '按住说话，松开结束'), 'info');
      return;
    }

    // Case 2: Held down, recording was initiated
    hasHoldTriggered = false;
    overlay.classList.remove('is-pressing', 'is-cancelling');
    ensureVoiceHud();
    if (hudCapsuleEl) hudCapsuleEl.classList.remove('cancelling');

    const rec = ensureRecorder();
    if (rec.state !== 'listening') return;

    const rect = overlay.getBoundingClientRect();
    const shouldCancel = e && e.clientY < rect.top - 45;

    if (shouldCancel) {
      if (hudCapsuleEl) hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
      triggerHaptic('cancel');
      rec.cancel();
      toast(t('composer.voiceCancelled') || (state.lang === 'en' ? 'Recording cancelled' : '已取消录音'), 'info');
      return;
    }

    const duration = Date.now() - pressStartTime;
    if (duration < 350) {
      if (hudCapsuleEl) hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
      triggerHaptic('cancel');
      rec.cancel();
      toast(t('composer.voiceShortTapWarning') || (state.lang === 'en' ? 'Hold to speak, release to finish' : '按住说话，松开结束'), 'info');
      return;
    }

    triggerHaptic('finish');
    await rec.stop();
  };

  overlay.addEventListener('pointerup', handlePointerRelease);
  overlay.addEventListener('pointercancel', () => {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    overlay.classList.remove('is-touch-down', 'is-pressing', 'is-cancelling');
    ensureVoiceHud();
    if (hudCapsuleEl) hudCapsuleEl.classList.remove('active', 'cancelling', 'transcribing');
    try {
      if (activePointerId !== null) overlay.releasePointerCapture(activePointerId);
    } catch (_) {}
    activePointerId = null;

    if (hasHoldTriggered) {
      hasHoldTriggered = false;
      const rec = ensureRecorder();
      if (rec.state === 'listening') {
        rec.cancel();
      }
    }
  });

  // Mode toggle on voice button
  if (el.voiceBtn) {
    el.voiceBtn.addEventListener('click', () => {
      if (composerVoiceMode) {
        switchToTextMode();
      } else {
        switchToVoiceMode();
      }
    });
  }
}

