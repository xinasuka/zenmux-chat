// js/tts.js
// 统一语音朗读 (TTS) 引擎：支持云端神经网络大模型 (OpenAI/Gemini/Qwen/Grok) 与本地原生 Web Speech API 双引擎
// 1. 自动对齐 Markdown 纯文本清洗，规避代码块与格式噪音。
// 2. 云端模型：基于 HTML5 Audio 与 Blob 会话级内存缓存，实现精准毫秒级寻轨拖拽、无损无感倍速切换与零冗余扣费。
// 3. 本地引擎：完全保留 0 费用、离线可用的浏览器原生 SpeechSynthesis 管道。

import { state, LS } from './state.js';

export const CLOUD_TTS_MODELS = [
  {
    group: '推荐云端大模型 (超自然音色 · 细腻拟真)',
    models: [
      { id: 'google/gemini-3.1-flash-tts-preview', name: 'Google Gemini 3.1 Flash TTS Preview (70+ 多语言 · 细腻情感) · 推荐', provider: 'Google' },
      { id: 'qwen/qwen-audio-3.0-tts-plus', name: '阿里通义千问 Qwen-Audio-3.0-TTS-Plus (顶级中文与方言)', provider: 'Qwen' },
      { id: 'x-ai/grok-voice-tts-1.0', name: 'xAI Grok Voice TTS 1.0 (拟真语调 · 动态表达)', provider: 'xAI' }
    ]
  },
  {
    group: '本地设备原生引擎 (零网络消耗 · 离线可用)',
    models: [
      { id: 'browser', name: '浏览器本地原生语音 (Web Speech API)', provider: 'Local' }
    ]
  }
];

export const CLOUD_TTS_VOICES = [
  { id: 'Kore', name: 'Kore (知性自然女声 · Google 推荐)', gender: 'female' },
  { id: 'Puck', name: 'Puck (活力生动男声 · Google)', gender: 'male' },
  { id: 'Aoede', name: 'Aoede (温和优雅女声 · Google)', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir (沉稳磁性男声 · Google)', gender: 'male' },
  { id: 'Charon', name: 'Charon (深沉专业男声 · Google)', gender: 'male' },
  { id: 'nova', name: 'Nova (自然生动女声 · 通用)', gender: 'female' },
  { id: 'shimmer', name: 'Shimmer (清澈甜美女声 · 通用)', gender: 'female' },
  { id: 'alloy', name: 'Alloy (通用平衡音色 · 通用)', gender: 'neutral' },
  { id: 'echo', name: 'Echo (温暖深沉男中音 · 通用)', gender: 'male' },
  { id: 'onyx', name: 'Onyx (低沉磁性男声 · 通用)', gender: 'male' },
  { id: 'fable', name: 'Fable (叙事感英伦男声 · 通用)', gender: 'male' }
];

const PLAY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
const PAUSE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
const SPINNER_ICON_SVG = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>';
const CLOSE_ICON_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

// 会话级音频 Blob 二进制内存缓存，避免拖拽寻轨、暂停恢复或重复播放时发起二次网络请求
const audioBlobCache = new Map();

/**
 * 清理 Markdown 标记，仅保留适合语音朗读的纯文本流
 */
export function cleanTextForTTS(md) {
  if (!md) return '';
  let s = String(md);
  s = s.replace(/```[\s\S]*?```/g, ' 代码块已忽略 ');
  s = s.replace(/`([^`]+)`/g, '$1');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  s = s.replace(/#{1,6}\s+/g, '');
  s = s.replace(/[*_~]{1,3}/g, '');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/^\s*>\s?/gm, '');
  return s.trim().slice(0, 4000);
}

/**
 * 格式化秒级时间为 MM:SS 文本
 */
export function formatAudioTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

/**
 * 筛选设备浏览器原生的高品质普通话与英语语音
 */
export function getCuratedSpeechVoices() {
  if (!('speechSynthesis' in window)) return [];
  const all = window.speechSynthesis.getVoices() || [];
  const ua = navigator.userAgent.toLowerCase();
  const isEdge = /edg\//i.test(ua);
  const isSafari = /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
  const isChrome = /chrome|crios/i.test(ua) && !isEdge;
  const isApple = /macintosh|iphone|ipad|ipod/i.test(ua);

  const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|pipe organ|trinoids|whisper|zarvox|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley|ralph|junior|kathy|fred|jester|organ|flo \(chinese|eddy \(chinese|grandma \(chinese|grandpa \(chinese|reed \(chinese|rocko \(chinese|sandy \(chinese|shelley \(chinese/i;

  const filtered = all.filter((v) => {
    if (!v.name || !v.lang) return false;
    if (NOVELTY.test(v.name)) return false;
    const lang = v.lang.toLowerCase();
    return lang.startsWith('zh') || lang.startsWith('cmn') || lang.startsWith('yue') || lang.startsWith('en');
  });

  function getVoiceScore(v) {
    const n = v.name.toLowerCase();
    const l = v.lang.toLowerCase();
    let score = 0;
    const isZh = l.startsWith('zh') || l.startsWith('cmn') || l.startsWith('yue');

    if (isZh) score += 50;
    if (isEdge && /online \(natural\)/i.test(v.name)) score += 40;
    if (isEdge && /xiaoxiao|yunxi|yunjian/i.test(n)) score += 30;
    if ((isSafari || isApple) && /tingting|ting-ting/i.test(n)) score += 35;
    if ((isSafari || isApple) && /siri|enhanced|premium/i.test(n)) score += 40;
    if ((isSafari || isApple) && /meijia|sinji/i.test(n)) score += 20;
    if (isChrome && /google/i.test(n)) score += 35;
    if (v.default) score += 5;
    return score;
  }

  filtered.sort((a, b) => getVoiceScore(b) - getVoiceScore(a));

  function formatVoiceLabel(v) {
    const n = v.name.toLowerCase();
    if (/tingting/i.test(n)) return '婷婷 (标准普通话 · 女声)';
    if (/xiaoxiao/i.test(n)) return '晓晓 (自然普通话 · 女声)';
    if (/yunxi/i.test(n)) return '云希 (沉稳普通话 · 男声)';
    if (/yunjian/i.test(n)) return '云健 (影视解说 · 男声)';
    if (/meijia|mei-jia/i.test(n)) return '美佳 (台湾普通话 · 女声)';
    if (/sin-ji|sinji/i.test(n)) return 'Sin-ji (标准粤语 · 女声)';
    if (/google 普通话|google.*chinese/i.test(n)) return 'Google 普通话 (自然女声)';
    if (/samantha/i.test(n)) return 'Samantha (标准美音 · 女声)';
    if (/jenny/i.test(n)) return 'Jenny (自然美音 · 女声)';
    if (/guy/i.test(n)) return 'Guy (自然美音 · 男声)';
    if (/daniel/i.test(n)) return 'Daniel (标准英音 · 男声)';
    if (/karen/i.test(n)) return 'Karen (澳大利亚音 · 女声)';
    const clean = v.name.replace(/Microsoft|Google|Apple|Desktop|Online \(Natural\)/gi, '').trim();
    return (clean || v.name) + ' (' + v.lang + ')';
  }

  const zhVoices = [];
  const enVoices = [];
  filtered.forEach((v) => {
    const l = v.lang.toLowerCase();
    if (l.startsWith('zh') || l.startsWith('cmn') || l.startsWith('yue')) {
      zhVoices.push(v);
    } else if (l.startsWith('en')) {
      enVoices.push(v);
    }
  });

  const finalVoices = zhVoices.slice(0, 4).concat(enVoices.slice(0, 3));
  return finalVoices.map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    label: formatVoiceLabel(v),
    raw: v,
  }));
}

let activeSpeechUtterance = null;
let activeHtmlAudio = null;
let currentGlobalStopHandler = null;

/**
 * 全局停止任何正在播放的语音朗读（无论来自 Web Speech 还是云端 HTML5 Audio）
 */
export function stopGlobalAudio() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (activeHtmlAudio) {
    try {
      activeHtmlAudio.pause();
      activeHtmlAudio.currentTime = 0;
    } catch (_) {}
    activeHtmlAudio = null;
  }
  if (typeof currentGlobalStopHandler === 'function') {
    currentGlobalStopHandler();
    currentGlobalStopHandler = null;
  }
  activeSpeechUtterance = null;
}

/**
 * 调用 /api/tts 边缘网关获取高保真云端语音合成音频流
 */
export async function fetchCloudTTSAudio(text, model = 'google/gemini-3.1-flash-tts-preview', voice = 'Kore', speed = 1.0) {
  const gateToken = state.token || localStorage.getItem(LS.token) || localStorage.getItem('zm.token') || '';
  const headers = {
    'Content-Type': 'application/json'
  };
  if (gateToken) {
    headers['X-Access-Token'] = gateToken;
    headers['Authorization'] = `Bearer ${gateToken}`;
  }

  const response = await fetch('/api/tts', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: text,
      voice,
      speed,
      response_format: 'pcm'
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

  return await response.blob();
}

/**
 * 构造并挂载消息下方的交互式语音播放抽屉面板
 */
export function createAudioPlayerDrawer(msg, onClose, onToast) {
  stopGlobalAudio();

  const activeModel = state.ttsModel || localStorage.getItem(LS.ttsModel) || 'browser';
  const isCloudTTS = activeModel !== 'browser';

  const playerDrawer = document.createElement('div');
  playerDrawer.className = 'msg-tts-player';

  const engineLabel = isCloudTTS ? '云端拟真' : '本地原生';

  playerDrawer.innerHTML = `
    <div class="tts-main-row">
      <button class="tts-play-btn" title="播放 / 暂停">
        ${PLAY_ICON_SVG}
      </button>
      <div class="tts-progress-wrap">
        <span class="tts-time tts-cur-time">00:00</span>
        <input type="range" class="tts-slider" min="0" max="100" value="0" step="0.1">
        <span class="tts-time tts-dur-time">00:00</span>
      </div>
      <span class="tts-engine-badge" title="当前发音引擎">${engineLabel}</span>
      <button class="tts-close-btn" title="关闭播放器">${CLOSE_ICON_SVG}</button>
    </div>
    <div class="tts-controls-row">
      <div class="tts-ctrl-group">
        <span>音色:</span>
        <select class="tts-voice-select"><option value="">载入音色中…</option></select>
      </div>
      <div class="tts-ctrl-group">
        <span>倍速:</span>
        <button class="tts-speed-btn" data-speed="0.75">0.75x</button>
        <button class="tts-speed-btn active" data-speed="1.0">1.0x</button>
        <button class="tts-speed-btn" data-speed="1.25">1.25x</button>
        <button class="tts-speed-btn" data-speed="1.5">1.5x</button>
      </div>
    </div>
  `;

  const playBtn = playerDrawer.querySelector('.tts-play-btn');
  const closeBtn = playerDrawer.querySelector('.tts-close-btn');
  const slider = playerDrawer.querySelector('.tts-slider');
  const curTimeSpan = playerDrawer.querySelector('.tts-cur-time');
  const durTimeSpan = playerDrawer.querySelector('.tts-dur-time');
  const voiceSelect = playerDrawer.querySelector('.tts-voice-select');
  const speedBtns = playerDrawer.querySelectorAll('.tts-speed-btn');

  let currentSpeed = 1.0;
  let isPlaying = false;
  let isPaused = false;
  let isBuffering = false;

  // 云端 HTML5 Audio 实例与对象缓存
  let htmlAudio = null;
  let currentAudioBlobUrl = null;

  // 本地 SpeechSynthesis 变量
  let localUtterance = null;
  let localProgressTimer = null;
  let localEstimatedDurationSeconds = 0;
  let localCurrentProgressSeconds = 0;
  let localCurrentVoiceURI = '';

  const fullText = cleanTextForTTS(msg.content || '');

  function updatePlayIcon(playing) {
    if (isBuffering) {
      playBtn.innerHTML = SPINNER_ICON_SVG;
      playBtn.title = '正在加载音频…';
      playBtn.classList.add('loading');
    } else if (playing) {
      playBtn.innerHTML = PAUSE_ICON_SVG;
      playBtn.title = '暂停';
      playBtn.classList.remove('loading');
    } else {
      playBtn.innerHTML = PLAY_ICON_SVG;
      playBtn.title = '播放';
      playBtn.classList.remove('loading');
    }
  }

  /* -------------------------------------------------------------
     A. 云端神经网络语音播放逻辑 (HTML5 Audio + 会话级 Blob 内存缓存)
  ------------------------------------------------------------- */
  let selectedCloudVoice = state.ttsVoice || localStorage.getItem(LS.ttsVoice) || 'Kore';

  function populateCloudVoices() {
    voiceSelect.innerHTML = '';
    CLOUD_TTS_VOICES.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      if (v.id === selectedCloudVoice) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });
    if (!voiceSelect.value && CLOUD_TTS_VOICES.length) {
      voiceSelect.value = CLOUD_TTS_VOICES[0].id;
      selectedCloudVoice = CLOUD_TTS_VOICES[0].id;
    }
  }

  function stopCloudSpeech() {
    if (htmlAudio) {
      try {
        htmlAudio.pause();
        htmlAudio.currentTime = 0;
      } catch (_) {}
    }
    isPlaying = false;
    isPaused = false;
    isBuffering = false;
    updatePlayIcon(false);
    slider.value = 0;
    curTimeSpan.textContent = '00:00';
  }

  async function startCloudSpeech() {
    if (!fullText) {
      if (onToast) onToast('回复内容为空，无法朗读', 'info');
      return;
    }

    if (htmlAudio && !htmlAudio.ended) {
      try {
        htmlAudio.playbackRate = currentSpeed;
        await htmlAudio.play();
        isPlaying = true;
        isPaused = false;
        updatePlayIcon(true);
      } catch (err) {
        console.warn('[TTS] Audio resume failed:', err);
      }
      return;
    }

    isBuffering = true;
    updatePlayIcon(false);

    const cacheKey = `${activeModel}:${selectedCloudVoice}:${fullText}`;

    try {
      let blob = audioBlobCache.get(cacheKey);
      if (!blob) {
        blob = await fetchCloudTTSAudio(fullText, activeModel, selectedCloudVoice, 1.0);
        audioBlobCache.set(cacheKey, blob);
      }

      if (currentAudioBlobUrl) {
        URL.revokeObjectURL(currentAudioBlobUrl);
      }
      currentAudioBlobUrl = URL.createObjectURL(blob);

      htmlAudio = new Audio(currentAudioBlobUrl);
      activeHtmlAudio = htmlAudio;
      htmlAudio.playbackRate = currentSpeed;

      htmlAudio.addEventListener('loadedmetadata', () => {
        if (htmlAudio.duration && !isNaN(htmlAudio.duration)) {
          durTimeSpan.textContent = formatAudioTime(htmlAudio.duration);
        }
      });

      htmlAudio.addEventListener('timeupdate', () => {
        if (htmlAudio && htmlAudio.duration && !isNaN(htmlAudio.duration)) {
          const cur = htmlAudio.currentTime;
          const dur = htmlAudio.duration;
          curTimeSpan.textContent = formatAudioTime(cur);
          durTimeSpan.textContent = formatAudioTime(dur);
          slider.value = Math.min(100, Math.max(0, (cur / dur) * 100));
        }
      });

      htmlAudio.addEventListener('ended', () => {
        stopCloudSpeech();
      });

      htmlAudio.addEventListener('error', (e) => {
        console.warn('[TTS] Audio playback error:', e);
        if (onToast) onToast('云端音频播放异常', 'error');
        stopCloudSpeech();
      });

      await htmlAudio.play();
      isBuffering = false;
      isPlaying = true;
      isPaused = false;
      updatePlayIcon(true);

    } catch (err) {
      isBuffering = false;
      updatePlayIcon(false);
      const errMsg = err.message || '语音合成请求失败';
      if (onToast) onToast(errMsg, 'error');
      console.error('[TTS] Cloud synthesis failed:', err);
    }
  }

  /* -------------------------------------------------------------
     B. 本地设备原生语音朗读逻辑 (Web Speech API)
  ------------------------------------------------------------- */
  function populateLocalVoices() {
    if (!('speechSynthesis' in window)) {
      voiceSelect.innerHTML = '<option value="">浏览器不支持本地语音</option>';
      return;
    }
    const voices = getCuratedSpeechVoices();
    voiceSelect.innerHTML = '';
    if (!voices.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '系统默认语音';
      voiceSelect.appendChild(opt);
      return;
    }
    voices.forEach((v, idx) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = v.label;
      if (!localCurrentVoiceURI && (idx === 0 || /tingting|xiaoxiao|普通话/i.test(v.name))) {
        localCurrentVoiceURI = v.voiceURI;
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });
    if (localCurrentVoiceURI) voiceSelect.value = localCurrentVoiceURI;
  }

  function stopLocalSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearInterval(localProgressTimer);
    isPlaying = false;
    isPaused = false;
    localCurrentProgressSeconds = 0;
    updatePlayIcon(false);
    slider.value = 0;
    curTimeSpan.textContent = '00:00';
  }

  function startLocalSpeech(startIndex) {
    if (!('speechSynthesis' in window)) {
      if (onToast) onToast('当前浏览器不支持 Web Speech API', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    clearInterval(localProgressTimer);

    if (!fullText) {
      if (onToast) onToast('回复内容为空，无法朗读', 'info');
      return;
    }

    let textToRead = fullText;
    if (startIndex && startIndex > 0 && startIndex < fullText.length) {
      textToRead = fullText.slice(startIndex);
    }

    localEstimatedDurationSeconds = Math.max(1, Math.round(fullText.length / (4.2 * currentSpeed)));
    durTimeSpan.textContent = formatAudioTime(localEstimatedDurationSeconds);

    localUtterance = new SpeechSynthesisUtterance(textToRead);
    localUtterance.rate = currentSpeed;
    localUtterance.pitch = 1.0;
    activeSpeechUtterance = localUtterance;

    const voices = window.speechSynthesis.getVoices() || [];
    if (localCurrentVoiceURI) {
      const found = voices.find((v) => v.voiceURI === localCurrentVoiceURI);
      if (found) localUtterance.voice = found;
    }

    localUtterance.onstart = () => {
      isPlaying = true;
      isPaused = false;
      updatePlayIcon(true);
      localProgressTimer = setInterval(() => {
        if (isPlaying && !isPaused) {
          localCurrentProgressSeconds += 0.25;
          if (localCurrentProgressSeconds > localEstimatedDurationSeconds) {
            localCurrentProgressSeconds = localEstimatedDurationSeconds;
          }
          curTimeSpan.textContent = formatAudioTime(localCurrentProgressSeconds);
          slider.value = (localCurrentProgressSeconds / localEstimatedDurationSeconds) * 100;
        }
      }, 250);
    };

    localUtterance.onboundary = (e) => {
      if (e.charIndex !== undefined && fullText.length) {
        const charIdx = (startIndex || 0) + e.charIndex;
        const pct = Math.min(100, Math.max(0, (charIdx / fullText.length) * 100));
        slider.value = pct;
        localCurrentProgressSeconds = (pct / 100) * localEstimatedDurationSeconds;
        curTimeSpan.textContent = formatAudioTime(localCurrentProgressSeconds);
      }
    };

    localUtterance.onend = () => stopLocalSpeech();
    localUtterance.onerror = (e) => {
      if (e && e.error !== 'canceled' && e.error !== 'interrupted') {
        if (onToast) onToast('朗读已停止', 'info');
      }
      stopLocalSpeech();
    };

    window.speechSynthesis.speak(localUtterance);
  }

  /* -------------------------------------------------------------
     C. 统一用户交互事件绑定
  ------------------------------------------------------------- */
  if (isCloudTTS) {
    populateCloudVoices();
  } else {
    populateLocalVoices();
    if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = populateLocalVoices;
    }
  }

  // 播放 / 暂停按钮
  playBtn.addEventListener('click', () => {
    if (isBuffering) return;

    if (isCloudTTS) {
      if (!isPlaying) {
        startCloudSpeech();
      } else if (isPaused) {
        if (htmlAudio) {
          htmlAudio.play();
          isPaused = false;
          updatePlayIcon(true);
        }
      } else {
        if (htmlAudio) {
          htmlAudio.pause();
          isPaused = true;
          updatePlayIcon(false);
        }
      }
    } else {
      if (!isPlaying) {
        startLocalSpeech(0);
      } else {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
          isPaused = false;
          updatePlayIcon(true);
        } else {
          window.speechSynthesis.pause();
          isPaused = true;
          updatePlayIcon(false);
        }
      }
    }
  });

  // 进度条拖拽寻轨
  slider.addEventListener('input', () => {
    const pct = parseFloat(slider.value) || 0;

    if (isCloudTTS) {
      if (htmlAudio && htmlAudio.duration && !isNaN(htmlAudio.duration)) {
        htmlAudio.currentTime = (pct / 100) * htmlAudio.duration;
        curTimeSpan.textContent = formatAudioTime(htmlAudio.currentTime);
      }
    } else {
      const targetCharIndex = Math.floor((pct / 100) * fullText.length);
      localCurrentProgressSeconds = (pct / 100) * localEstimatedDurationSeconds;
      curTimeSpan.textContent = formatAudioTime(localCurrentProgressSeconds);
      if (isPlaying) {
        startLocalSpeech(targetCharIndex);
      }
    }
  });

  // 倍速切换 (0.75x, 1.0x, 1.25x, 1.5x)
  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      speedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.getAttribute('data-speed')) || 1.0;

      if (isCloudTTS) {
        if (htmlAudio) {
          htmlAudio.playbackRate = currentSpeed;
        }
      } else {
        if (isPlaying) {
          const currentTargetChar = Math.floor((localCurrentProgressSeconds / localEstimatedDurationSeconds) * fullText.length);
          startLocalSpeech(currentTargetChar);
        }
      }
    });
  });

  // 音色下拉选择
  voiceSelect.addEventListener('change', () => {
    if (isCloudTTS) {
      selectedCloudVoice = voiceSelect.value;
      state.ttsVoice = selectedCloudVoice;
      localStorage.setItem(LS.ttsVoice, selectedCloudVoice);

      if (htmlAudio) {
        htmlAudio.pause();
        htmlAudio = null;
        activeHtmlAudio = null;
      }
      isPlaying = false;
      isPaused = false;
      updatePlayIcon(false);
      startCloudSpeech();
    } else {
      localCurrentVoiceURI = voiceSelect.value;
      if (isPlaying) {
        const currentTargetChar = Math.floor((localCurrentProgressSeconds / localEstimatedDurationSeconds) * fullText.length);
        startLocalSpeech(currentTargetChar);
      }
    }
  });

  // 关闭播放器
  closeBtn.addEventListener('click', () => {
    if (isCloudTTS) {
      stopCloudSpeech();
      if (currentAudioBlobUrl) {
        URL.revokeObjectURL(currentAudioBlobUrl);
        currentAudioBlobUrl = null;
      }
    } else {
      stopLocalSpeech();
    }

    if (playerDrawer.parentNode) {
      playerDrawer.parentNode.removeChild(playerDrawer);
    }
    if (typeof onClose === 'function') onClose();
  });

  currentGlobalStopHandler = () => {
    if (isCloudTTS) {
      stopCloudSpeech();
    } else {
      stopLocalSpeech();
    }
  };

  // 展开抽屉面板即自动开始播放
  if (isCloudTTS) {
    startCloudSpeech();
  } else {
    startLocalSpeech(0);
  }

  return playerDrawer;
}
