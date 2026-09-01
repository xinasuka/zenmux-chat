// js/tts.js
// Speech synthesis engine, voice curation, text cleaner, and audio player controller.

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

export function formatAudioTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

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
let currentGlobalStopHandler = null;

export function stopGlobalAudio() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  if (typeof currentGlobalStopHandler === 'function') {
    currentGlobalStopHandler();
    currentGlobalStopHandler = null;
  }
  activeSpeechUtterance = null;
}

export function createAudioPlayerDrawer(msg, onClose, onToast) {
  stopGlobalAudio();

  const playerDrawer = document.createElement('div');
  playerDrawer.className = 'msg-tts-player';

  playerDrawer.innerHTML = `
    <div class="tts-main-row">
      <button class="tts-play-btn" title="播放 / 暂停">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
      </button>
      <div class="tts-progress-wrap">
        <span class="tts-time tts-cur-time">00:00</span>
        <input type="range" class="tts-slider" min="0" max="100" value="0" step="0.1">
        <span class="tts-time tts-dur-time">00:00</span>
      </div>
      <button class="tts-close-btn" title="关闭播放器">✕</button>
    </div>
    <div class="tts-controls-row">
      <div class="tts-ctrl-group">
        <span>音色:</span>
        <select class="tts-voice-select"><option value="">系统自然人声</option></select>
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
  let currentVoiceURI = '';
  let isSpeaking = false;
  let isPaused = false;
  let estimatedDurationSeconds = 0;
  let currentProgressSeconds = 0;
  let progressTimer = null;
  let utter = null;

  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
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
      if (!currentVoiceURI && (idx === 0 || /tingting|xiaoxiao|普通话/i.test(v.name))) {
        currentVoiceURI = v.voiceURI;
      }
      voiceSelect.appendChild(opt);
    });
    if (currentVoiceURI) voiceSelect.value = currentVoiceURI;
  }

  populateVoices();
  if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  function updatePlayIcon(isPlaying) {
    if (isPlaying) {
      playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
      playBtn.title = '暂停';
    } else {
      playBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
      playBtn.title = '播放';
    }
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    clearInterval(progressTimer);
    isSpeaking = false;
    isPaused = false;
    currentProgressSeconds = 0;
    updatePlayIcon(false);
    slider.value = 0;
    curTimeSpan.textContent = '00:00';
  }

  function startSpeech(startIndex) {
    if (!('speechSynthesis' in window)) {
      if (onToast) onToast('当前浏览器不支持 Web Speech API', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    clearInterval(progressTimer);

    const fullText = cleanTextForTTS(msg.content || '');
    if (!fullText) {
      if (onToast) onToast('回复内容为空，无法朗读', 'info');
      return;
    }

    let textToRead = fullText;
    if (startIndex && startIndex > 0 && startIndex < fullText.length) {
      textToRead = fullText.slice(startIndex);
    }

    estimatedDurationSeconds = Math.max(1, Math.round(fullText.length / (4.2 * currentSpeed)));
    durTimeSpan.textContent = formatAudioTime(estimatedDurationSeconds);

    utter = new SpeechSynthesisUtterance(textToRead);
    utter.rate = currentSpeed;
    utter.pitch = 1.0;
    activeSpeechUtterance = utter;

    const voices = window.speechSynthesis.getVoices() || [];
    if (currentVoiceURI) {
      const found = voices.find((v) => v.voiceURI === currentVoiceURI);
      if (found) utter.voice = found;
    }

    utter.onstart = () => {
      isSpeaking = true;
      isPaused = false;
      updatePlayIcon(true);
      progressTimer = setInterval(() => {
        if (isSpeaking && !isPaused) {
          currentProgressSeconds += 0.25;
          if (currentProgressSeconds > estimatedDurationSeconds) {
            currentProgressSeconds = estimatedDurationSeconds;
          }
          curTimeSpan.textContent = formatAudioTime(currentProgressSeconds);
          slider.value = (currentProgressSeconds / estimatedDurationSeconds) * 100;
        }
      }, 250);
    };

    utter.onboundary = (e) => {
      if (e.charIndex !== undefined && fullText.length) {
        const charIdx = (startIndex || 0) + e.charIndex;
        const pct = Math.min(100, Math.max(0, (charIdx / fullText.length) * 100));
        slider.value = pct;
        currentProgressSeconds = (pct / 100) * estimatedDurationSeconds;
        curTimeSpan.textContent = formatAudioTime(currentProgressSeconds);
      }
    };

    utter.onend = () => stopSpeech();
    utter.onerror = (e) => {
      if (e && e.error !== 'canceled' && e.error !== 'interrupted') {
        if (onToast) onToast('朗读已停止', 'info');
      }
      stopSpeech();
    };

    window.speechSynthesis.speak(utter);
  }

  playBtn.addEventListener('click', () => {
    if (!isSpeaking) {
      startSpeech(0);
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
  });

  slider.addEventListener('input', () => {
    const fullText = cleanTextForTTS(msg.content || '');
    const pct = parseFloat(slider.value) || 0;
    const targetCharIndex = Math.floor((pct / 100) * fullText.length);
    currentProgressSeconds = (pct / 100) * estimatedDurationSeconds;
    curTimeSpan.textContent = formatAudioTime(currentProgressSeconds);
    if (isSpeaking) {
      startSpeech(targetCharIndex);
    }
  });

  speedBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      speedBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSpeed = parseFloat(btn.getAttribute('data-speed')) || 1.0;
      if (isSpeaking) {
        const fullText = cleanTextForTTS(msg.content || '');
        const currentTargetChar = Math.floor((currentProgressSeconds / estimatedDurationSeconds) * fullText.length);
        startSpeech(currentTargetChar);
      }
    });
  });

  voiceSelect.addEventListener('change', () => {
    currentVoiceURI = voiceSelect.value;
    if (isSpeaking) {
      const fullText = cleanTextForTTS(msg.content || '');
      const currentTargetChar = Math.floor((currentProgressSeconds / estimatedDurationSeconds) * fullText.length);
      startSpeech(currentTargetChar);
    }
  });

  closeBtn.addEventListener('click', () => {
    stopSpeech();
    if (playerDrawer.parentNode) playerDrawer.parentNode.removeChild(playerDrawer);
    if (typeof onClose === 'function') onClose();
  });

  currentGlobalStopHandler = () => stopSpeech();

  // 自动开始朗读
  startSpeech(0);

  return playerDrawer;
}
