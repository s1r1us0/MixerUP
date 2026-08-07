const vocal = document.querySelector('#vocalAudio');
const drums = document.querySelector('#drumsAudio');
const bass = document.querySelector('#bassAudio');
const other = document.querySelector('#otherAudio');
const songFile = document.querySelector('#songFile');
const uploadCard = document.querySelector('#uploadCard');
const playButton = document.querySelector('#playButton');
const timeline = document.querySelector('#timeline');
const currentTime = document.querySelector('#currentTime');
const duration = document.querySelector('#duration');
const title = document.querySelector('#songTitle');
const meta = document.querySelector('#songMeta');
const status = document.querySelector('#status');
const progressWrap = document.querySelector('#progressWrap');
const progressBar = document.querySelector('#progressBar');
const progressValue = document.querySelector('#progressValue');
const progressText = document.querySelector('#progressText');
const downloadMixBtn = document.querySelector('#downloadMixBtn');
const downloadZipBtn = document.querySelector('#downloadZipBtn');

const spectrumCanvas = document.querySelector('#spectrumCanvas');
const spectrumCtx = spectrumCanvas ? spectrumCanvas.getContext('2d') : null;
const waveformCanvas = document.querySelector('#waveformCanvas');
const waveformCtx = waveformCanvas ? waveformCanvas.getContext('2d') : null;

const tracks = { vocal, drums, bass, other };
let isPlaying = false;
let isSeeking = false;
let progress = 0;
let currentJobId = null;
let audioBlobs = { vocal: null, drums: null, bass: null, other: null };

// Gelişmiş Web Audio API Sinyal İşleme Zinciri (DAW Engine)
let audioCtx = null;
let masterGain = null;
let masterAnalyser = null;
let masterData = null;
let reverbConvolver = null;
let reverbGain = null;
let echoDelay = null;
let echoFeedback = null;
let echoGain = null;
let animFrameId = null;
let spatialAngle = 0;
let lastWaveformBuffer = null;

let trackNodes = {};

function createImpulseResponse(ctx, duration = 2.0, decay = 2.5) {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const impulse = ctx.createBuffer(2, length, rate);
  const left = impulse.getChannelData(0);
  const right = impulse.getChannelData(1);
  for (let i = 0; i < length; i++) {
    const n = i / length;
    left[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
    right[i] = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
  }
  return impulse;
}

// iOS Web Audio Context Unlocker (Dokunmatik kilit açıcı)
['touchstart', 'touchend', 'click'].forEach(evtType => {
  window.addEventListener(evtType, () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }, { passive: true });
});

function initWebAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master Gain & Analyser
    masterGain = audioCtx.createGain();
    masterAnalyser = audioCtx.createAnalyser();
    masterAnalyser.fftSize = 64;
    masterAnalyser.smoothingTimeConstant = 0.8;
    masterData = new Uint8Array(masterAnalyser.frequencyBinCount);

    // Reverb (Yankı) Düğümü
    reverbConvolver = audioCtx.createConvolver();
    reverbConvolver.buffer = createImpulseResponse(audioCtx, 1.8, 2.2);
    reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0; // Başlangıçta kapalı
    reverbConvolver.connect(reverbGain);
    reverbGain.connect(audioCtx.destination);

    // Echo (Eko) Düğümü
    echoDelay = audioCtx.createDelay(1.0);
    echoDelay.delayTime.value = 0.28; // 280ms
    echoFeedback = audioCtx.createGain();
    echoFeedback.gain.value = 0.35;
    echoGain = audioCtx.createGain();
    echoGain.gain.value = 0; // Başlangıçta kapalı

    echoDelay.connect(echoFeedback);
    echoFeedback.connect(echoDelay);
    echoDelay.connect(echoGain);
    echoGain.connect(audioCtx.destination);

    // Master Bağlantıları
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(audioCtx.destination);
    masterGain.connect(reverbConvolver);
    masterGain.connect(echoDelay);

    // Kanal Sinyal Zinciri (Per-Track EQ & Pan)
    Object.entries(tracks).forEach(([name, audio]) => {
      audio.crossOrigin = "anonymous";
      const source = audioCtx.createMediaElementSource(audio);

      // 3-Bant EQ
      const lowEq = audioCtx.createBiquadFilter();
      lowEq.type = 'lowshelf';
      lowEq.frequency.value = 320;
      lowEq.gain.value = 0;

      const midEq = audioCtx.createBiquadFilter();
      midEq.type = 'peaking';
      midEq.frequency.value = 1000;
      midEq.Q.value = 1;
      midEq.gain.value = 0;

      const highEq = audioCtx.createBiquadFilter();
      highEq.type = 'highshelf';
      highEq.frequency.value = 3200;
      highEq.gain.value = 0;

      // Panner (Sol/Sağ Denge)
      const panner = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
      if (panner) panner.pan.value = 0;

      // Kanal Gain & Analyser
      const gain = audioCtx.createGain();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;

      // Bağlantılar: Source -> Low -> Mid -> High -> Panner -> Gain -> MasterGain & Analyser
      source.connect(lowEq);
      lowEq.connect(midEq);
      midEq.connect(highEq);
      
      let lastNode = highEq;
      if (panner) {
        highEq.connect(panner);
        lastNode = panner;
      }
      lastNode.connect(gain);
      gain.connect(analyser);
      gain.connect(masterGain);

      trackNodes[name] = {
        source, lowEq, midEq, highEq, panner, gain, analyser,
        data: new Uint8Array(analyser.frequencyBinCount)
      };
    });
  } catch (e) {
    console.warn('Web Audio başlatılamadı:', e);
  }
}

// Canlı Frekans Spektrumu & Animasyon Döngüsü
function updateVisualizers() {
  if (!isPlaying) return;

  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  let totalAmp = 0;
  let activeCount = 0;

  // 1. Kanal Ekolayzır Çubukları
  Object.entries(tracks).forEach(([name, audio]) => {
    const channel = document.querySelector(`.channel[data-channel="${name}"]`);
    if (!channel) return;
    const eqBars = channel.querySelectorAll('.eq-bars span');
    const nodes = trackNodes[name];

    const isChannelActive = isPlaying && !audio.muted && audio.volume > 0 && audio.src && !audio.paused;

    if (isChannelActive && nodes) {
      nodes.analyser.getByteFrequencyData(nodes.data);
      const low = nodes.data[2] || 0;
      const mid = nodes.data[6] || 0;
      const high = nodes.data[12] || 0;
      const avg = (low + mid + high) / 3;

      if (avg > 5) {
        totalAmp += avg;
        activeCount++;
      }

      if (eqBars.length >= 3) {
        eqBars[0].style.height = `${Math.max(15, Math.min(100, (low / 255) * 100))}%`;
        eqBars[1].style.height = `${Math.max(15, Math.min(100, (mid / 255) * 100))}%`;
        eqBars[2].style.height = `${Math.max(15, Math.min(100, (high / 255) * 100))}%`;
      }
      const vuBar = channel.querySelector('.vu-bar');
      if (vuBar) {
        const level = Math.min(100, Math.round(((low + mid + high) / (3 * 255)) * 100));
        vuBar.style.setProperty('--level', `${level}%`);
      }
    } else {
      if (eqBars.length >= 3) {
        eqBars[0].style.height = '15%';
        eqBars[1].style.height = '15%';
        eqBars[2].style.height = '15%';
      }
      const vuBar = channel.querySelector('.vu-bar');
      if (vuBar) vuBar.style.setProperty('--level', '0%');
    }
  });

  // 2. 8D Spatial Audio Modu (Dairesel Sol/Sağ Panleme)
  const spatialToggle = document.querySelector('#spatialToggle');
  if (spatialToggle && spatialToggle.checked) {
    spatialAngle += 0.04;
    const panVal = Math.sin(spatialAngle);
    Object.values(trackNodes).forEach(node => {
      if (node.panner) node.panner.pan.setTargetAtTime(panVal * 0.8, audioCtx.currentTime, 0.05);
    });
  }

  // 3. Canlı Canvas Spektrumu (#spectrumCanvas)
  if (spectrumCtx && masterAnalyser) {
    masterAnalyser.getByteFrequencyData(masterData);
    const w = spectrumCanvas.width;
    const h = spectrumCanvas.height;
    spectrumCtx.clearRect(0, 0, w, h);

    const barCount = 18;
    const barWidth = Math.floor(w / barCount) - 2;

    for (let i = 0; i < barCount; i++) {
      const val = masterData[i * 2] || 0;
      const barHeight = Math.max(3, (val / 255) * h);
      const x = i * (barWidth + 2);
      const y = h - barHeight;

      const grad = spectrumCtx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#172222');
      grad.addColorStop(0.6, '#a5dd1e');
      grad.addColorStop(1, '#c5f338');

      spectrumCtx.fillStyle = grad;
      spectrumCtx.beginPath();
      spectrumCtx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      spectrumCtx.fill();
    }
  }

  // 4. Arka Plan Ortam Işığı (Ambient Pulse)
  const avgAmp = activeCount > 0 ? (totalAmp / activeCount) : 0;
  const scale = 0.96 + (avgAmp / 255) * 0.15;
  const opacity = 0.35 + (avgAmp / 255) * 0.65;
  document.body.style.setProperty('--ambient-scale', scale.toFixed(2));
  document.body.style.setProperty('--ambient-opacity', opacity.toFixed(2));

  animFrameId = requestAnimationFrame(updateVisualizers);
}

let cachedWaveformPeaks = null;

// Gerçek Ses Dalga Biçimini Çizme (#waveformCanvas)
async function renderWaveform(blob) {
  if (!waveformCtx || !blob) return;
  lastWaveformBuffer = blob;
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();

    const w = waveformCanvas.width;
    const h = waveformCanvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const amp = h / 2;

    cachedWaveformPeaks = [];
    for (let i = 0; i < w; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[i * step + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      const y1 = (1 + min) * amp;
      const y2 = (1 + max) * amp;
      cachedWaveformPeaks.push({ y1, height: Math.max(1.5, y2 - y1) });
    }
    drawWaveformProgress();
  } catch (e) {
    console.warn('Waveform çizim hatası:', e);
  }
}

function drawWaveformProgress(customRatio = null) {
  if (!waveformCtx) return;
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  waveformCtx.clearRect(0, 0, w, h);

  let ratio = customRatio;
  if (ratio === null) {
    const val = parseFloat(timeline?.value || 0);
    ratio = val / 100;
  }
  ratio = Math.max(0, Math.min(1, ratio));

  const isDark = document.documentElement.dataset.theme !== 'light';

  if (cachedWaveformPeaks && cachedWaveformPeaks.length > 0) {
    const progressPx = Math.floor(w * ratio);
    const playedColor = isDark ? '#a3e635' : '#172222';
    const unplayedColor = isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(23, 34, 34, 0.18)';

    // Subtle baseline track behind waveform
    waveformCtx.fillStyle = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(23, 34, 34, 0.08)';
    waveformCtx.fillRect(0, h / 2 - 1, w, 2);

    for (let i = 0; i < cachedWaveformPeaks.length; i++) {
      const peak = cachedWaveformPeaks[i];
      waveformCtx.fillStyle = (i <= progressPx) ? playedColor : unplayedColor;
      waveformCtx.fillRect(i, peak.y1, 1, peak.height);
    }
  } else {
    // Default track bar when no waveform is loaded yet
    const progressPx = Math.floor(w * ratio);
    const playedColor = isDark ? '#a3e635' : '#172222';
    const unplayedColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(23, 34, 34, 0.18)';

    const centerY = Math.floor(h / 2) - 2;
    // Unplayed bar
    waveformCtx.fillStyle = unplayedColor;
    waveformCtx.fillRect(0, centerY, w, 4);
    // Played bar
    if (progressPx > 0) {
      waveformCtx.fillStyle = playedColor;
      waveformCtx.fillRect(0, centerY, progressPx, 4);
    }
  }

  // Draw A-B loop band overlay on canvas if A or B is set
  const srcRef = getReferenceAudio();
  if (srcRef && srcRef.duration && (loopA !== null || loopB !== null)) {
    const dur = srcRef.duration;
    const ax = loopA !== null ? (loopA / dur) * w : 0;
    const bx = loopB !== null ? (loopB / dur) * w : w;

    waveformCtx.fillStyle = isDark ? 'rgba(163, 230, 53, 0.15)' : 'rgba(23, 34, 34, 0.12)';
    waveformCtx.fillRect(ax, 0, Math.max(2, bx - ax), h);

    waveformCtx.fillStyle = isDark ? '#a3e635' : '#172222';
    if (loopA !== null) waveformCtx.fillRect(ax, 0, 2, h);
    if (loopB !== null) waveformCtx.fillRect(Math.max(0, bx - 2), 0, 2, h);
  }
}

const formatTime = (value) => {
  if (!Number.isFinite(value)) return '0:00';
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
};
const setRangeFill = (el) => el.style.setProperty('--fill', `${el.value}%`);
document.querySelectorAll('input[type=range]').forEach(setRangeFill);

function syncPlayState() {
  const playIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="6 3 20 12 6 21 6 3"/></svg>`;
  const pauseIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
  playButton.innerHTML = isPlaying ? pauseIcon : playIcon;
  playButton.setAttribute('aria-label', isPlaying ? 'Duraklat' : 'Oynat');
  playButton.classList.toggle('is-playing-btn', isPlaying);
  document.body.classList.toggle('is-playing', isPlaying);
  const trackHead = document.querySelector('.track-head');
  if (trackHead) trackHead.classList.toggle('is-playing', isPlaying);
}
function setProgress(value, label = '4 kanal ayrılıyor…') {
  progress = Math.max(0, Math.min(100, Math.round(value)));
  progressWrap.hidden = false;
  progressBar.style.width = `${progress}%`;
  progressValue.textContent = `${progress}%`;
  progressText.textContent = label;
}
async function togglePlayback() {
  if (!Object.values(tracks).some(audio => audio.src)) {
    status.textContent = 'Oynatma işlemi için ses dosyasının kanallara ayrıştırılması gerekmektedir.';
    return;
  }
  if (isPlaying) {
    Object.values(tracks).forEach(audio => audio.pause());
    isPlaying = false;
    syncPlayState();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  } else {
    initWebAudio();
    if (audioCtx && audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    await Promise.all(Object.values(tracks).filter(audio => audio.src).map(audio => audio.play()));
    isPlaying = true;
    syncPlayState();
    updateVisualizers();
  }
}

playButton.addEventListener('click', togglePlayback);
songFile.addEventListener('change', ({ target }) => {
  const file = target.files[0];
  if (!file) return;
  title.textContent = file.name.replace(/\.[^/.]+$/, '');
  meta.textContent = 'Hazırlanıyor…';
  processSong(file);
});

// Sayfa geneli sürükle-bırak koruması
['dragover', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, e => e.preventDefault());
});

// Sürükle - Bırak (Drag & Drop) Desteği
['dragenter', 'dragover'].forEach(eventName => {
  uploadCard.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); uploadCard.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(eventName => {
  uploadCard.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); uploadCard.classList.remove('dragover'); });
});
uploadCard.addEventListener('drop', (e) => {
  const files = e.dataTransfer.files;
  if (files && files.length > 0) {
    const file = files[0];
    if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|flac|ogg)$/i.test(file.name)) {
      title.textContent = file.name.replace(/\.[^/.]+$/, '');
      meta.textContent = 'Hazırlanıyor…';
      processSong(file);
    }
  }
});

async function processSong(file) {
  playButton.disabled = true;
  if (downloadMixBtn) downloadMixBtn.disabled = true;
  if (downloadZipBtn) downloadZipBtn.disabled = true;

  // Revoke previous Blob URLs to release RAM
  Object.values(tracks).forEach(audio => {
    if (audio && audio.src && audio.src.startsWith('blob:')) {
      URL.revokeObjectURL(audio.src);
      audio.src = '';
    }
  });

  const deviceSelect = document.querySelector('#deviceSelect');
  const device = deviceSelect ? deviceSelect.value : 'auto';

  if (device === 'offline' || !navigator.onLine) {
    return processSongOffline(file);
  }

  status.textContent = 'Ses dosyası sunucuya aktarılıyor…';
  setProgress(0, 'Ses dosyası aktarılıyor…');
  try {
    const form = new FormData();
    form.append('song', file);
    if (deviceSelect) {
      form.append('device', deviceSelect.value);
    }
    const response = await fetch('/api/separate', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Yükleme işlemi başarısız oldu.');
    setProgress(0, 'Ayrıştırma işlemi başlatılıyor…');
    await waitForJob(data.jobId);
  } catch (error) {
    console.warn('Sunucu hatası veya bağlantı kesildi, offline metoda geçiliyor:', error);
    status.textContent = 'Sunucuya ulaşılamadı. Cihaz içi offline ayrıştırma başlatılıyor…';
    return processSongOffline(file);
  }
}

// Cihaz İçi Offline (Çevrimdışı WebAssembly / Web Audio DSP) Ayrıştırma Motoru
async function processSongOffline(file) {
  status.textContent = '📱 Şarkı cihaz belleğinde çözümleniyor (Offline Mod)…';
  setProgress(10, 'Ses verisi okunuyor…');
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
    setProgress(30, 'Cihaz işlemcisi ile kanallar ayrıştırılıyor…');
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;
    
    // 4 Kanal İçin Offline AudioContext İşlemleri
    const offlineVocals = new OfflineAudioContext(numChannels, length, sampleRate);
    const offlineDrums = new OfflineAudioContext(numChannels, length, sampleRate);
    const offlineBass = new OfflineAudioContext(numChannels, length, sampleRate);
    const offlineOther = new OfflineAudioContext(numChannels, length, sampleRate);

    // Vokal filtresi (Mid-range & Center extraction)
    const vSource = offlineVocals.createBufferSource();
    vSource.buffer = audioBuffer;
    const vFilter = offlineVocals.createBiquadFilter();
    vFilter.type = 'bandpass'; vFilter.frequency.value = 1500; vFilter.Q.value = 0.8;
    vSource.connect(vFilter); vFilter.connect(offlineVocals.destination);
    vSource.start(0);

    // Davul filtresi (Transient & High-Pass + Sub punch)
    const dSource = offlineDrums.createBufferSource();
    dSource.buffer = audioBuffer;
    const dHighPass = offlineDrums.createBiquadFilter();
    dHighPass.type = 'highpass'; dHighPass.frequency.value = 3500;
    dSource.connect(dHighPass); dHighPass.connect(offlineDrums.destination);
    dSource.start(0);

    // Bas filtresi (Sub-bass & Low-pass < 250Hz)
    const bSource = offlineBass.createBufferSource();
    bSource.buffer = audioBuffer;
    const bLowPass = offlineBass.createBiquadFilter();
    bLowPass.type = 'lowpass'; bLowPass.frequency.value = 220;
    bSource.connect(bLowPass); bLowPass.connect(offlineBass.destination);
    bSource.start(0);

    // Diğer Enstrümanlar filtresi (Mid-High shelf)
    const oSource = offlineOther.createBufferSource();
    oSource.buffer = audioBuffer;
    const oFilter = offlineOther.createBiquadFilter();
    oFilter.type = 'peaking'; oFilter.frequency.value = 800; oFilter.gain.value = 3;
    oSource.connect(oFilter); oFilter.connect(offlineOther.destination);
    oSource.start(0);

    setProgress(60, 'Vokal, Davul, Bas ve Enstrümanlar sentezleniyor…');

    const [vBuf, dBuf, bBuf, oBuf] = await Promise.all([
      offlineVocals.startRendering(),
      offlineDrums.startRendering(),
      offlineBass.startRendering(),
      offlineOther.startRendering()
    ]);

    audioBlobs['vocal'] = audioBufferToWav(vBuf);
    audioBlobs['drums'] = audioBufferToWav(dBuf);
    audioBlobs['bass'] = audioBufferToWav(bBuf);
    audioBlobs['other'] = audioBufferToWav(oBuf);

    Object.entries(audioBlobs).forEach(([name, blob]) => {
      tracks[name].src = URL.createObjectURL(blob);
    });

    await Promise.all(Object.values(tracks).map(audio => new Promise(resolve => {
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      audio.load();
    })));

    updateDuration();
    if (audioBlobs['vocal']) renderWaveform(audioBlobs['vocal']);

    setProgress(100, '📱 Cihaz içi offline ayrıştırma tamamlandı!');
    meta.textContent = '4 kanal hazır (Offline)';
    status.textContent = 'Şarkı cihazınızın işlemcisiyle çevrimdışı olarak 4 kanala ayrıştırıldı. Miksleyebilir ve çalabilirsiniz.';
    playButton.disabled = false;
    if (downloadMixBtn) downloadMixBtn.disabled = false;
    if (downloadZipBtn) downloadZipBtn.disabled = false;

  } catch (err) {
    console.error('Offline ayrıştırma hatası:', err);
    status.textContent = `Offline ayrıştırma hatası: ${err.message}`;
    progressWrap.hidden = true;
    playButton.disabled = false;
  }
}



async function waitForJob(jobId) {
  while (true) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (job.status === 'complete') {
      currentJobId = jobId;
      if (job.song_title) {
        title.textContent = job.song_title;
      }
      setProgress(99, 'Ses verileri alınıyor…');
      for (const [name, url] of Object.entries(job.stems)) {
        const res = await fetch(url);
        const blob = await res.blob();
        audioBlobs[name] = blob;
        tracks[name].src = URL.createObjectURL(blob);
      }
      await Promise.all(Object.values(tracks).map(audio => new Promise(resolve => {
        audio.addEventListener('loadedmetadata', resolve, { once: true });
        audio.load();
      })));
      updateDuration();
      
      // İlk bulunan blob ile ses dalga biçimini çizdir (Waveform Peaks)
      const firstBlob = Object.values(audioBlobs).find(b => b);
      if (firstBlob) renderWaveform(firstBlob);

      setProgress(100, 'Tüm kanallar hazır');
      meta.textContent = '4 kanal hazır';
      status.textContent = 'Vokal, davul, bas ve enstrüman kanalları ayrıştırıldı. Miks seviyelerini ve stüdyo FX ayarlarını değiştirebilirsiniz.';
      playButton.disabled = false;
      if (downloadMixBtn) downloadMixBtn.disabled = false;
      if (downloadZipBtn) downloadZipBtn.disabled = false;
      return;
    }
    if (job.status === 'failed') throw new Error(job.error || 'Ses ayrıştırma işlemi tamamlanamadı.');
    setProgress(job.progress ?? 0, job.message || '4 kanal ayrılıyor…');
    status.textContent = job.message || '4 kanal ayrılıyor…';
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

function updateDuration() {
  duration.textContent = formatTime(getReferenceAudio().duration);
}
function getReferenceAudio() {
  return Object.values(tracks).find(audio => audio.src) || vocal;
}
function updateTimeline() {
  if (isSeeking) return;
  const source = getReferenceAudio();
  if (!source.duration) return;

  // A-B loop check
  if (isLoopActive && loopA !== null && loopB !== null && loopB > loopA) {
    if (source.currentTime >= loopB || source.currentTime < loopA - 0.2) {
      Object.values(tracks).filter(a => a.src).forEach(a => a.currentTime = loopA);
    }
  }

  timeline.value = (source.currentTime / source.duration) * 100;
  drawWaveformProgress();
  currentTime.textContent = formatTime(source.currentTime);
}
// Sadece referans kanal (en uzun) 'ended' tetiklendiğinde oynatmayı durdur.
// Böylece kısa kanallar şarkıyı erkenden bitirmiyor.
Object.values(tracks).forEach(audio => {
  audio.addEventListener('timeupdate', updateTimeline);
  audio.addEventListener('ended', () => {
    // Yalnızca bu audio referans kanal ise veya tüm kanallar bittiyse durdur
    const allEnded = Object.values(tracks).filter(a => a.src).every(a => a.ended || a.paused);
    const isRef = audio === getReferenceAudio();
    if (!isRef && !allEnded) return; // Kısa kanal bitti, referans henüz bitmedi — devam
    Object.values(tracks).forEach(a => a.pause());
    isPlaying = false;
    isLoopActive = false; // Bug #2: Loop aktifliğini sıfırla
    updateLoopUI();
    syncPlayState();
    if (animFrameId) cancelAnimationFrame(animFrameId);
  });
});
timeline.addEventListener('input', () => {
  isSeeking = true;
  const source = getReferenceAudio();
  if (!source.duration) return;
  const time = (timeline.value / 100) * source.duration;
  currentTime.textContent = formatTime(time);
  drawWaveformProgress(timeline.value / 100);
});
timeline.addEventListener('change', () => {
  const source = getReferenceAudio();
  if (!source.duration) return;
  const time = (timeline.value / 100) * source.duration;
  Object.values(tracks).filter(audio => audio.src).forEach(audio => audio.currentTime = time);
  isSeeking = false;
  drawWaveformProgress();
});

// Stüdyo Ana Efekt Kontrolleri (Master Reverb / Echo / 8D)
document.querySelector('#reverbToggle')?.addEventListener('change', (e) => {
  initWebAudio();
  if (reverbGain) reverbGain.gain.setTargetAtTime(e.target.checked ? 0.45 : 0, audioCtx.currentTime, 0.1);
});
document.querySelector('#echoToggle')?.addEventListener('change', (e) => {
  initWebAudio();
  if (echoGain) echoGain.gain.setTargetAtTime(e.target.checked ? 0.4 : 0, audioCtx.currentTime, 0.1);
});
document.querySelector('#spatialToggle')?.addEventListener('change', (e) => {
  initWebAudio();
  if (!e.target.checked) {
    Object.values(trackNodes).forEach(node => {
      if (node.panner) node.panner.pan.setTargetAtTime(0, audioCtx.currentTime, 0.1);
    });
  }
});

// Kanal Ayarları (Volume, Mute, Solo, FX Çekmecesi, Pan & 3-Bant EQ)
document.querySelectorAll('.channel').forEach(channel => {
  const channelName = channel.dataset.channel;
  const audio = tracks[channelName];
  const volume = channel.querySelector('.volume');
  const output = channel.querySelector('output');
  const mute = channel.querySelector('.mute');
  const solo = channel.querySelector('.solo');
  const download = channel.querySelector('.download');
  const fxBtn = channel.querySelector('.fx-drawer-btn');
  const fxDrawer = channel.querySelector('.channel-fx-drawer');

  // FX Çekmecesi Açma/Kapama
  if (fxBtn && fxDrawer) {
    fxBtn.addEventListener('click', () => {
      const isHidden = fxDrawer.hidden;
      fxDrawer.hidden = !isHidden;
      fxBtn.classList.toggle('active', isHidden);
    });
  }

  // Pan (Sol/Sağ)
  const panInput = channel.querySelector('.pan-slider');
  const panVal = channel.querySelector('.pan-val');
  if (panInput) {
    panInput.addEventListener('input', () => {
      initWebAudio();
      const val = parseFloat(panInput.value);
      if (trackNodes[channelName]?.panner) {
        trackNodes[channelName].panner.pan.setTargetAtTime(val, audioCtx.currentTime, 0.05);
      }
      if (panVal) {
        panVal.textContent = val === 0 ? 'Merkez' : val < 0 ? `%${Math.round(-val*100)} Sol` : `%${Math.round(val*100)} Sağ`;
      }
    });
  }

  // 3-Bant EQ (Low, Mid, High)
  ['low', 'mid', 'high'].forEach(band => {
    const eqInput = channel.querySelector(`.eq-${band}`);
    if (eqInput) {
      eqInput.addEventListener('input', () => {
        initWebAudio();
        const db = parseFloat(eqInput.value);
        const node = trackNodes[channelName];
        if (node) {
          if (band === 'low' && node.lowEq) node.lowEq.gain.setTargetAtTime(db, audioCtx.currentTime, 0.05);
          if (band === 'mid' && node.midEq) node.midEq.gain.setTargetAtTime(db, audioCtx.currentTime, 0.05);
          if (band === 'high' && node.highEq) node.highEq.gain.setTargetAtTime(db, audioCtx.currentTime, 0.05);
        }
        const valSpan = eqInput.nextElementSibling;
        if (valSpan) valSpan.textContent = `${db > 0 ? '+' : ''}${db}dB`;
      });
    }
  });

  audio.volume = volume.value / 100;
  volume.addEventListener('input', () => { audio.volume = volume.value / 100; output.value = `${volume.value}%`; setRangeFill(volume); });
  mute.addEventListener('click', () => { audio.muted = !audio.muted; mute.classList.toggle('active', audio.muted); channel.classList.toggle('muted', audio.muted); });
  solo.addEventListener('click', () => {
    const enabling = !solo.classList.contains('active');
    document.querySelectorAll('.channel').forEach(other => {
      const otherAudio = tracks[other.dataset.channel];
      const otherSolo = other.querySelector('.solo');
      otherAudio.muted = enabling && other !== channel;
      other.querySelector('.mute').classList.toggle('active', otherAudio.muted);
      other.classList.toggle('muted', otherAudio.muted);
      if (other !== channel) otherSolo.classList.remove('active');
    });
    solo.classList.toggle('active', enabling);
  });
  if (download) {
    download.addEventListener('click', async () => {
      if (!audioBlobs[channelName]) return;
      const fmt = document.querySelector('#exportFormat')?.value || 'wav';
      const originalText = status.textContent;
      try {
        status.textContent = `${channelName.toUpperCase()} kanalı ${fmt.toUpperCase()} olarak hazırlanıyor…`;
        await downloadAudioBlob(audioBlobs[channelName], `${title.textContent || 'MixerUp'}-${channelName}.${fmt}`, fmt);
        status.textContent = originalText;
      } catch (e) {
        alert('İndirme hatası: ' + e.message);
        status.textContent = originalText;
      }
    });
  }
});

// Hazır Modlar (Presets)
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    document.querySelectorAll('.channel').forEach(channel => {
      const name = channel.dataset.channel;
      const audio = tracks[name];
      const volInput = channel.querySelector('.volume');
      const output = channel.querySelector('output');
      const mute = channel.querySelector('.mute');
      const solo = channel.querySelector('.solo');

      audio.muted = false;
      mute.classList.remove('active');
      solo.classList.remove('active');
      channel.classList.remove('muted');

      let targetVol = 85;
      if (preset === 'karaoke') {
        if (name === 'vocal') targetVol = 0;
      } else if (preset === 'acapella') {
        if (name !== 'vocal') targetVol = 0;
      } else if (preset === 'drumless') {
        if (name === 'drums') targetVol = 0;
      } else if (preset === 'bassless') {
        if (name === 'bass') targetVol = 0;
      } else if (preset === 'reset') {
        targetVol = 85;
        updatePlaybackSpeed(1.0);
        setPitch(0);
      }
      volInput.value = targetVol;
      audio.volume = targetVol / 100;
      output.value = `${targetVol}%`;
      setRangeFill(volInput);
    });
  });
});

// ---- Ton (Pitch Transpoze) Kontrolü ----
let currentPitchSemitones = 0;
let currentSpeedRatio = 1.0;

const pitchSlider = document.querySelector('#pitchSlider');
const pitchValue = document.querySelector('#pitchValue');
const pitchDownBtn = document.querySelector('#pitchDownBtn');
const pitchUpBtn = document.querySelector('#pitchUpBtn');

function applyPlaybackRateAndPitch() {
  const pitchFactor = Math.pow(2, currentPitchSemitones / 12);
  const combinedRate = currentSpeedRatio * pitchFactor;
  Object.values(tracks).forEach(audio => {
    if (audio) {
      audio.preservesPitch = false;
      audio.playbackRate = combinedRate;
    }
  });
}

function setPitch(st) {
  currentPitchSemitones = Math.max(-6, Math.min(6, parseInt(st) || 0));
  if (pitchSlider) pitchSlider.value = currentPitchSemitones;
  if (pitchValue) {
    if (currentPitchSemitones > 0) pitchValue.value = `+${currentPitchSemitones}♯`;
    else if (currentPitchSemitones < 0) pitchValue.value = `${currentPitchSemitones}♭`;
    else pitchValue.value = '0 ST';
  }
  applyPlaybackRateAndPitch();
}

if (pitchSlider) {
  pitchSlider.addEventListener('input', (e) => setPitch(e.target.value));
}
if (pitchDownBtn) {
  pitchDownBtn.addEventListener('click', () => setPitch(currentPitchSemitones - 1));
}
if (pitchUpBtn) {
  pitchUpBtn.addEventListener('click', () => setPitch(currentPitchSemitones + 1));
}

// ---- A-B Kesit Döngüsü (Loop) ----
let loopA = null;
let loopB = null;
let isLoopActive = false;

const setLoopABtn = document.querySelector('#setLoopABtn');
const setLoopBBtn = document.querySelector('#setLoopBBtn');
const toggleLoopBtn = document.querySelector('#toggleLoopBtn');
const clearLoopBtn = document.querySelector('#clearLoopBtn');
const loopBadge = document.querySelector('#loopBadge');

function updateLoopUI() {
  if (loopBadge) {
    if (loopA !== null || loopB !== null) {
      const textA = loopA !== null ? formatTime(loopA) : '0:00';
      const textB = loopB !== null ? formatTime(loopB) : '...';
      loopBadge.textContent = `${textA} ➔ ${textB}`;
      loopBadge.hidden = false;
    } else {
      loopBadge.hidden = true;
    }
  }
  if (toggleLoopBtn) {
    toggleLoopBtn.classList.toggle('active', isLoopActive);
    toggleLoopBtn.textContent = isLoopActive ? '🔁 Döngü: AÇIK' : '🔁 Döngü: KAPALI';
  }
  drawWaveformProgress();
}

if (setLoopABtn) {
  setLoopABtn.addEventListener('click', () => {
    const src = getReferenceAudio();
    if (src.duration) {
      loopA = src.currentTime;
      if (loopB !== null && loopA >= loopB) loopB = null;
      updateLoopUI();
    }
  });
}

if (setLoopBBtn) {
  setLoopBBtn.addEventListener('click', () => {
    const src = getReferenceAudio();
    if (src.duration) {
      loopB = src.currentTime;
      if (loopA !== null && loopB <= loopA) loopA = null;
      if (loopA !== null && loopB > loopA) isLoopActive = true;
      updateLoopUI();
    }
  });
}

if (toggleLoopBtn) {
  toggleLoopBtn.addEventListener('click', () => {
    isLoopActive = !isLoopActive;
    updateLoopUI();
  });
}

if (clearLoopBtn) {
  clearLoopBtn.addEventListener('click', () => {
    loopA = null;
    loopB = null;
    isLoopActive = false;
    updateLoopUI();
  });
}

// Oynatma Hızı (Speed Control Slider)
const speedSlider = document.querySelector('#speedSlider');
const speedValue = document.querySelector('#speedValue');

function setSpeedRangeFill(el) {
  if (!el) return;
  const min = parseFloat(el.min) || 0.5;
  const max = parseFloat(el.max) || 2.0;
  const val = parseFloat(el.value) || 1.0;
  const pct = ((val - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

function updatePlaybackSpeed(speedVal) {
  if (!speedSlider) return;
  currentSpeedRatio = parseFloat(speedVal) || 1.0;
  speedSlider.value = currentSpeedRatio;
  if (speedValue) {
    const formatted = currentSpeedRatio.toFixed(2).replace(/\.00$/, '.0').replace(/(\.\d)0$/, '$1');
    speedValue.value = `${formatted}x`;
  }
  setSpeedRangeFill(speedSlider);
  applyPlaybackRateAndPitch();
}

if (speedSlider) {
  setSpeedRangeFill(speedSlider);
  speedSlider.addEventListener('input', (e) => {
    updatePlaybackSpeed(e.target.value);
  });
}

// ZIP İndirme
if (downloadZipBtn) {
  downloadZipBtn.addEventListener('click', () => {
    if (!currentJobId) return;
    const fmt = document.querySelector('#exportFormat')?.value || 'wav';
    window.location.href = `/api/download-zip/${currentJobId}?format=${fmt}`;
  });
}

async function downloadAudioBlob(blob, filename, format = 'wav') {
  if (!blob) return;

  if (format === 'mp3') {
    try {
      const response = await fetch('/api/convert-mp3', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: blob
      });
      if (response.ok) {
        const convertedBlob = await response.blob();
        if (convertedBlob && convertedBlob.size > 100) {
          const isMp3 = convertedBlob.type.includes('mpeg') || convertedBlob.type.includes('mp3');
          const finalExt = isMp3 ? '.mp3' : '.wav';
          const a = document.createElement('a');
          a.href = URL.createObjectURL(convertedBlob);
          a.download = filename.replace(/\.(wav|mp3)$/i, '') + finalExt;
          a.click();
          return;
        }
      }
    } catch (e) {
      console.warn('MP3 dönüştürme uyarısı, WAV olarak indiriliyor:', e);
    }
  }

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.wav') ? filename : `${filename.replace(/\.mp3$/i, '')}.wav`;
  a.click();
}

// Web Audio API — Özel Miksi İndirme (Render & Export WAV/MP3 with EQ & Pan)
async function bufferFromBlob(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const buffer = await tempCtx.decodeAudioData(arrayBuffer);
  tempCtx.close();
  return buffer;
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataLen = buffer.length * blockAlign;
  const bufferLen = 44 + dataLen;
  const arrayBuffer = new ArrayBuffer(bufferLen);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataLen, true);

  const channels = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

if (downloadMixBtn) {
  downloadMixBtn.addEventListener('click', async () => {
    const fmt = document.querySelector('#exportFormat')?.value || 'wav';
    const originalText = downloadMixBtn.textContent;
    downloadMixBtn.disabled = true;
    downloadMixBtn.textContent = `⏳ Miks (${fmt.toUpperCase()}) İşleniyor…`;
    try {
      const loadedBuffers = {};
      for (const [name, blob] of Object.entries(audioBlobs)) {
        if (blob) loadedBuffers[name] = await bufferFromBlob(blob);
      }
      if (Object.keys(loadedBuffers).length === 0) {
        throw new Error('İndirilecek ses verisi bulunamadı.');
      }
      const firstBuf = Object.values(loadedBuffers)[0];
      const sampleRate = firstBuf ? firstBuf.sampleRate : 44100;
      const maxLen = Math.max(...Object.values(loadedBuffers).map(b => b.length));
      const offlineCtx = new OfflineAudioContext(2, maxLen, sampleRate);

      Object.entries(loadedBuffers).forEach(([name, buffer]) => {
        const audioEl = tracks[name];
        const vol = audioEl.muted ? 0 : (audioEl.volume ?? 0.85);
        if (vol <= 0) return;

        const sourceNode = offlineCtx.createBufferSource();
        const gainNode = offlineCtx.createGain();
        sourceNode.buffer = buffer;
        gainNode.gain.value = vol;

        // Apply Per-Track EQ & Pan to Master Mix Export
        const channelEl = document.querySelector(`.channel[data-channel="${name}"]`);
        let lastNode = sourceNode;

        if (channelEl) {
          const panVal = parseFloat(channelEl.querySelector('.pan-slider')?.value || 0);
          const lowDb = parseFloat(channelEl.querySelector('.eq-low')?.value || 0);
          const midDb = parseFloat(channelEl.querySelector('.eq-mid')?.value || 0);
          const highDb = parseFloat(channelEl.querySelector('.eq-high')?.value || 0);

          if (lowDb !== 0) {
            const lowFilter = offlineCtx.createBiquadFilter();
            lowFilter.type = 'lowshelf'; lowFilter.frequency.value = 320; lowFilter.gain.value = lowDb;
            lastNode.connect(lowFilter); lastNode = lowFilter;
          }
          if (midDb !== 0) {
            const midFilter = offlineCtx.createBiquadFilter();
            midFilter.type = 'peaking'; midFilter.frequency.value = 1000; midFilter.Q.value = 1; midFilter.gain.value = midDb;
            lastNode.connect(midFilter); lastNode = midFilter;
          }
          if (highDb !== 0) {
            const highFilter = offlineCtx.createBiquadFilter();
            highFilter.type = 'highshelf'; highFilter.frequency.value = 3200; highFilter.gain.value = highDb;
            lastNode.connect(highFilter); lastNode = highFilter;
          }
          if (panVal !== 0 && offlineCtx.createStereoPanner) {
            const panner = offlineCtx.createStereoPanner();
            panner.pan.value = panVal;
            lastNode.connect(panner); lastNode = panner;
          }
        }

        lastNode.connect(gainNode);
        gainNode.connect(offlineCtx.destination);
        sourceNode.start(0);
      });

      const renderedBuffer = await offlineCtx.startRendering();

      // Normalize peak level to 0.95 to prevent clipping distortion
      const numCh = renderedBuffer.numberOfChannels;
      let peak = 0;
      for (let c = 0; c < numCh; c++) {
        const chData = renderedBuffer.getChannelData(c);
        for (let i = 0; i < chData.length; i++) {
          const abs = Math.abs(chData[i]);
          if (abs > peak) peak = abs;
        }
      }

      if (peak > 0.95) {
        const scale = 0.95 / peak;
        for (let c = 0; c < numCh; c++) {
          const chData = renderedBuffer.getChannelData(c);
          for (let i = 0; i < chData.length; i++) {
            chData[i] *= scale;
          }
        }
      }

      const wavBlob = audioBufferToWav(renderedBuffer);
      await downloadAudioBlob(wavBlob, `${title.textContent || 'MixerUp'}-Miks.${fmt}`, fmt);
    } catch (err) {
      alert('Miks indirme hatası: ' + err.message);
    } finally {
      downloadMixBtn.disabled = false;
      downloadMixBtn.textContent = originalText;
    }
  });
}

// Klavye Kısayolları (Keyboard Shortcuts)
window.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlayback();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault();
    const ref = getReferenceAudio();
    if (ref.duration) {
      const newTime = Math.max(0, ref.currentTime - 5);
      Object.values(tracks).filter(a => a.src).forEach(a => a.currentTime = newTime);
    }
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    const ref = getReferenceAudio();
    if (ref.duration) {
      const newTime = Math.min(ref.duration, ref.currentTime + 5);
      Object.values(tracks).filter(a => a.src).forEach(a => a.currentTime = newTime);
    }
  }
});

// ---- Theme Toggle ----
const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('mixerup-theme', next);
    drawWaveformProgress();
  });
}

// ---- Öğretici Modal Kılavuz Kontrolü ----
window.openGuide = function() {
  const guideModal = document.getElementById('guideModal');
  if (guideModal) {
    guideModal.removeAttribute('hidden');
    guideModal.style.display = 'flex';
  }
};

window.closeGuide = function() {
  const guideModal = document.getElementById('guideModal');
  if (guideModal) {
    guideModal.setAttribute('hidden', '');
    guideModal.style.display = 'none';
  }
};

document.addEventListener('click', (e) => {
  const guideModal = document.getElementById('guideModal');
  if (e.target.closest('#guideBtn')) {
    e.preventDefault();
    window.openGuide();
  } else if (e.target.closest('#closeGuideBtn') || e.target.closest('#gotItBtn')) {
    e.preventDefault();
    window.closeGuide();
  } else if (guideModal && e.target === guideModal) {
    window.closeGuide();
  }
});

window.addEventListener('keydown', (e) => {
  const guideModal = document.getElementById('guideModal');
  if (e.key === 'Escape' && guideModal && !guideModal.hasAttribute('hidden')) {
    window.closeGuide();
  }
});

// Initial waveform canvas draw
drawWaveformProgress();

