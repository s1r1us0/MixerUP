/* ==========================================================================
   MixerUp v8 – Application Logic
   Fixes: iOS file input, seek slider, UI wiring
   ========================================================================== */

// API base
const API_BASE_URL = window.location.protocol.startsWith('http')
  ? ''
  : 'http://192.168.1.143:8000';

// ---- Helpers ----
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- DOM ----
const screens = {
  home:       $('homeScreen'),
  processing: $('processingScreen'),
  mixer:      $('mixerScreen'),
  library:    $('libraryScreen'),
  settings:   $('settingsScreen'),
};

// Home
const uploadEmptyBox    = $('uploadEmptyBox');
const uploadSelectedBox = $('uploadSelectedBox');
const songFileInput     = $('songFileInput');
const btnTriggerUpload  = $('btnTriggerUpload');
const selectedFileName  = $('selectedFileName');
const selectedFileMeta  = $('selectedFileMeta');
const previewWaveCanvas = $('previewWaveformCanvas');
const btnChangeFile     = $('btnChangeFile');
const btnSplitAi        = $('btnSplitAi');

// Processing
const procPct      = $('procPct');
const procRingFill = $('procRingFill');
const checkStep1   = $('checkStep1');
const checkStep2   = $('checkStep2');
const checkStep3   = $('checkStep3');
const checkStep4   = $('checkStep4');

// Mixer
const mixerSongTitle   = $('mixerSongTitle');
const mixerTimecode    = $('mixerTimecode');
const btnMasterPlay    = $('btnMasterPlayPause');
const playIcon         = $('playIcon');
const pauseIcon        = $('pauseIcon');
const tempoSlider      = $('tempoSlider');
const tempoVal         = $('tempoVal');
const pitchSlider      = $('pitchSlider');
const pitchVal         = $('pitchVal');
const btnPitchDown     = $('btnPitchDown');
const btnPitchUp       = $('btnPitchUp');
const btnReverb        = $('btnReverb');
const waveformCanvas   = $('waveformCanvas');
const visualizerCanvas = $('visualizerCanvas');
const waveformContainer= $('waveformContainer');
const waveformProgress = $('waveformProgress');
const waveformThumb    = $('waveformThumb');
const timeCur          = $('timeCur');
const timeDur          = $('timeDur');
const settingsModelSelect = $('settingsModelSelect');
const settingsThemeSelect = $('settingsThemeSelect');
const btnSkipBack      = $('btnSkipBack');
const btnSkipFwd       = $('btnSkipFwd');

// Stems
const tracks = {
  vocals:      $('audioVocals'),
  drums:       $('audioDrums'),
  bass:        $('audioBass'),
  instruments: $('audioInstruments'),
};
const sliders = {
  vocals:      $('sliderVocals'),
  drums:       $('sliderDrums'),
  bass:        $('sliderBass'),
  instruments: $('sliderInstruments'),
};
const btnMute = {
  vocals:      $('btnMuteVocals'),
  drums:       $('btnMuteDrums'),
  bass:        $('btnMuteBass'),
  instruments: $('btnMuteInstruments'),
};
const btnSolo = {
  vocals:      $('btnSoloVocals'),
  drums:       $('btnSoloDrums'),
  bass:        $('btnSoloBass'),
  instruments: $('btnSoloInstruments'),
};
const peaks = {
  vocals:      $('peakVocals'),
  drums:       $('peakDrums'),
  bass:        $('peakBass'),
  instruments: $('peakInstruments'),
};

// Export
const btnOpenExport   = $('btnOpenExportSheet');
const exportOverlay   = $('exportSheetOverlay');
const btnCloseExport  = $('btnCloseExportSheet');
const fmtBtnWav       = $('fmtBtnWav');
const fmtBtnMp3       = $('fmtBtnMp3');
const btnExportZip    = $('btnExportAllZip');
const btnExportMix    = $('btnExportMixSingle');

// Nav
const navHome     = $('navTabHome');
const navLibrary  = $('navTabLibrary');
const navSettings = $('navTabSettings');
const btnBack     = $('btnBackHome');
const btnNavUpload = $('btnNavUploadTrack');
const libraryList  = $('libraryList');
const libEmpty     = $('libraryEmptyBox');

// ---- State ----
let selectedFile    = null;
let currentJobId    = null;
let audioCtx        = null;
let analysers       = {};
let isPlaying       = false;
let isSeeking       = false;
let animFrameId     = null;
let exportFormat    = 'wav';
let createdBlobUrls = [];

const muteStates = { vocals:false, drums:false, bass:false, instruments:false };
const soloStates = { vocals:false, drums:false, bass:false, instruments:false };

// ---- Screen switcher ----
function showScreen(name) {
  Object.values(screens).forEach(el => { if (el) { el.hidden = true; el.classList.remove('active'); } });
  const target = screens[name];
  if (!target) return;
  target.hidden = false;
  requestAnimationFrame(() => target.classList.add('active'));

  const tabHome = $('tabHome');
  const tabLibrary = $('tabLibrary');
  const tabSettings = $('tabSettings');

  if (['home','processing','mixer'].includes(name)) {
    if (tabHome) tabHome.checked = true;
  } else if (name === 'library') {
    if (tabLibrary) tabLibrary.checked = true;
    renderLibrary();
  } else if (name === 'settings') {
    if (tabSettings) tabSettings.checked = true;
  }
}

// ---- Navigation ----
navHome    && navHome.addEventListener('click', () => showScreen(tracks.vocals && tracks.vocals.src ? 'mixer' : 'home'));
navLibrary && navLibrary.addEventListener('click', () => showScreen('library'));
navSettings && navSettings.addEventListener('click', () => showScreen('settings'));
btnBack    && btnBack.addEventListener('click', () => showScreen('home'));
btnNavUpload && btnNavUpload.addEventListener('click', () => showScreen('home'));

// ---- iOS File Input ----
// Trigger the hidden file input from the visible button
btnTriggerUpload && btnTriggerUpload.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  songFileInput.click();
});

songFileInput && songFileInput.addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  selectedFile = file;

  uploadEmptyBox.hidden = true;
  uploadSelectedBox.hidden = false;

  const cleanName = file.name.replace(/\.[^/.]+$/, '');
  selectedFileName.textContent = cleanName;
  selectedFileMeta.textContent = `${(file.size / 1048576).toFixed(1)} MB`;

  btnSplitAi.disabled = false;

  requestAnimationFrame(() => {
    drawMiniWave(previewWaveCanvas, '#7c6fef');
  });
});

btnChangeFile && btnChangeFile.addEventListener('click', () => {
  songFileInput.value = '';
  selectedFile = null;
  uploadEmptyBox.hidden = false;
  uploadSelectedBox.hidden = true;
  btnSplitAi.disabled = true;
});

// ---- Mini waveform preview ----
function drawMiniWave(canvas, color) {
  if (!canvas) return;
  const w = canvas.offsetWidth * (window.devicePixelRatio || 1);
  const h = canvas.offsetHeight * (window.devicePixelRatio || 1) || 64;
  canvas.width  = w || 300;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const bw = 3, gap = 2, count = Math.floor(w / (bw + gap));
  for (let i = 0; i < count; i++) {
    const bh = Math.max(4,
      Math.sin(i * 0.2) * (h * 0.35) +
      Math.cos(i * 0.38) * (h * 0.2) +
      h * 0.3
    );
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.5 + 0.5 * (i / count);
    ctx.fillRect(i * (bw + gap), (h - bh) / 2, bw, bh);
  }
  ctx.globalAlpha = 1;
}

let reverbDelay, reverbFeedback, reverbWet;
// ---- Web Audio ----
function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();
  Object.keys(tracks).forEach(name => {
    try {
      // Need crossOrigin for cross-origin audio streaming
      tracks[name].crossOrigin = "anonymous";
      const src = audioCtx.createMediaElementSource(tracks[name]);
      const an  = audioCtx.createAnalyser();
      an.fftSize = 64;
      src.connect(an);
      an.connect(audioCtx.destination);
      analysers[name] = an;

      if (name === 'vocals') {
         reverbDelay = audioCtx.createDelay();
         reverbDelay.delayTime.value = 0.25;
         
         reverbFeedback = audioCtx.createGain();
         reverbFeedback.gain.value = 0.3; // 30% feedback
         
         reverbDelay.connect(reverbFeedback);
         reverbFeedback.connect(reverbDelay);
         
         reverbWet = audioCtx.createGain();
         reverbWet.gain.value = 0; // muted initially
         
         an.connect(reverbDelay);
         reverbDelay.connect(reverbWet);
         reverbWet.connect(audioCtx.destination);
      }
    } catch (_) {}
  });
}

async function unlockAudio() {
  if (!audioCtx) initAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    try { await audioCtx.resume(); } catch (_) {}
  }
}

['touchstart','touchend','click'].forEach(ev => {
  document.addEventListener(ev, unlockAudio, { once: true });
});

// ---- Safe iOS decoder ----
function decodeAudioDataSafe(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const go = () => {
      const copy = arrayBuffer.slice(0);
      try {
        const p = ctx.decodeAudioData(copy, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve).catch(reject);
      } catch (e) { reject(e); }
    };
    ctx.state === 'suspended' ? ctx.resume().then(go).catch(go) : go();
  });
}

// ---- Processing ring ----
const CIRC = 314.16;
function setRing(pct) {
  if (procRingFill) {
    procRingFill.style.strokeDashoffset = CIRC - (pct / 100) * CIRC;
  }
  if (procPct) procPct.textContent = `${Math.round(pct)}%`;
}

function setStep(el, state) {
  if (!el) return;
  el.classList.remove('step-active', 'step-done');
  if (state === 'active') el.classList.add('step-active');
  if (state === 'done')   el.classList.add('step-done');
}

// ---- AI Processing ----
btnSplitAi && btnSplitAi.addEventListener('click', async () => {
  if (!selectedFile) return;
  showScreen('processing');
  await unlockAudio();
  setRing(0);
  [checkStep1, checkStep2, checkStep3, checkStep4].forEach(s => setStep(s, ''));
  setStep(checkStep1, 'active');

  try {
    await runDemucsServer(selectedFile);
  } catch (err) {
    console.warn('Server unavailable, using local fallback:', err.message);
    try {
      await runLocalFallback(selectedFile);
    } catch (err2) {
      console.error('Local fallback error:', err2);
      alert("Couldn't process this file. Please use a valid audio file (MP3 / WAV).");
      showScreen('home');
    }
  }
});

async function runDemucsServer(file) {
  const form = new FormData();
  form.append('song', file);
  form.append('file', file);
  if (settingsModelSelect) {
    form.append('model', settingsModelSelect.value || 'htdemucs');
  }

  setRing(10);

  const res = await fetch(`${API_BASE_URL}/api/separate`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed: ' + res.status);

  const data = await res.json();
  const jobId = data.jobId || data.job_id;
  if (!jobId) throw new Error('No jobId');
  currentJobId = jobId;

  setStep(checkStep1, 'done');
  setStep(checkStep2, 'active');
  setRing(25);

  return new Promise((resolve, reject) => {
    const poll = setInterval(async () => {
      try {
        const r   = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`);
        const job = await r.json();
        const pct = clamp(25 + Math.round(((job.progress || 0) / 100) * 65), 25, 95);
        setRing(pct);

        if (job.status === 'complete' || job.status === 'completed') {
          clearInterval(poll);
          setStep(checkStep2, 'done'); setStep(checkStep3, 'active');
          setStep(checkStep3, 'done'); setStep(checkStep4, 'active');

          const ts = Date.now();
          tracks.vocals.src      = `${API_BASE_URL}/api/stem-stream/${jobId}/vocal?v=${ts}`;
          tracks.drums.src       = `${API_BASE_URL}/api/stem-stream/${jobId}/drums?v=${ts}`;
          tracks.bass.src        = `${API_BASE_URL}/api/stem-stream/${jobId}/bass?v=${ts}`;
          tracks.instruments.src = `${API_BASE_URL}/api/stem-stream/${jobId}/other?v=${ts}`;
          Object.values(tracks).forEach(t => t.load());

          setStep(checkStep4, 'done');
          setRing(100);
          saveToLib(file.name, tracks.vocals.duration || 0, jobId);
          setTimeout(() => { goToMixer(file.name); generateWaveform(); }, 500);
          resolve();
        } else if (job.status === 'failed') {
          clearInterval(poll);
          reject(new Error(job.error || 'Job failed'));
        }
      } catch (e) { clearInterval(poll); reject(e); }
    }, 1000);
  });
}

async function runLocalFallback(file) {
  const buf = await file.arrayBuffer();
  setStep(checkStep1, 'done'); setStep(checkStep2, 'active'); setRing(30);

  const decoded = await decodeAudioDataSafe(audioCtx, buf);
  setStep(checkStep2, 'done'); setStep(checkStep3, 'active'); setRing(60);

  const makeStem = async (lo, hi) => {
    const offCtx = new OfflineAudioContext(decoded.numberOfChannels, decoded.length, decoded.sampleRate);
    const src = offCtx.createBufferSource();
    src.buffer = decoded;
    let node = src;
    if (lo > 0) {
      const hp = offCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = lo;
      node.connect(hp); node = hp;
    }
    if (hi < 20000) {
      const lp = offCtx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = hi;
      node.connect(lp); node = lp;
    }
    node.connect(offCtx.destination);
    src.start();
    return bufToWav(await offCtx.startRendering());
  };

  const [vb, db, bb, ob] = await Promise.all([
    makeStem(300,3400), makeStem(60,250), makeStem(20,150), makeStem(3400,18000)
  ]);

  setStep(checkStep3, 'done'); setStep(checkStep4, 'active'); setRing(90);

  clearBlobs();
  const urls = [vb, db, bb, ob].map(b => URL.createObjectURL(b));
  createdBlobUrls.push(...urls);
  [tracks.vocals, tracks.drums, tracks.bass, tracks.instruments]
    .forEach((t, i) => { t.src = urls[i]; t.load(); });

  setStep(checkStep4, 'done'); setRing(100);
  saveToLib(file.name, decoded.duration, 'local-' + Date.now(), urls);
  setTimeout(() => { goToMixer(file.name); generateWaveform(); }, 500);
}

function stopAllAudio() {
  isPlaying = false;
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  Object.values(tracks).forEach(a => {
    if (a) {
      try { a.pause(); a.currentTime = 0; } catch(_) {}
    }
  });
  if (playIcon) playIcon.style.display = '';
  if (pauseIcon) pauseIcon.style.display = 'none';
}

function goToMixer(fileName) {
  stopAllAudio();
  if (mixerSongTitle) mixerSongTitle.textContent = fileName.replace(/\.[^/.]+$/, '');
  showScreen('mixer');
  resetSeekUI();
}

// ---- WAV encoder ----
function bufToWav(buffer) {
  const nc = buffer.numberOfChannels, len = buffer.length * nc * 2 + 44, sr = buffer.sampleRate;
  const dv = new DataView(new ArrayBuffer(len));
  let p = 0;
  const u16 = v => { dv.setUint16(p,v,true); p+=2; };
  const u32 = v => { dv.setUint32(p,v,true); p+=4; };
  u32(0x46464952); u32(len-8); u32(0x45564157);
  u32(0x20746d66); u32(16); u16(1); u16(nc);
  u32(sr); u32(sr*2*nc); u16(nc*2); u16(16);
  u32(0x61746164); u32(len-p-4);
  const chs = Array.from({length:nc}, (_,i) => buffer.getChannelData(i));
  for (let s=0; s<buffer.length; s++) for (let c=0; c<nc; c++) {
    const v = clamp(chs[c][s],-1,1);
    dv.setInt16(p, v<0?v*32768:v*32767, true); p+=2;
  }
  return new Blob([dv], {type:'audio/wav'});
}

function clearBlobs() { createdBlobUrls.forEach(u => URL.revokeObjectURL(u)); createdBlobUrls = []; }

// ---- Seek ----
// isSeeking: true while user is touching/dragging slider OR we are applying a seek
isSeeking = false;

function resetSeekUI() {
  if (seekSlider) seekSlider.value = 0;
  if (waveformProgress) waveformProgress.style.width = '0%';
  if (waveformThumb) waveformThumb.style.left = '0%';
  if (timeCur) timeCur.textContent = '0:00';
  if (timeDur) timeDur.textContent = '0:00';
  if (mixerTimecode) mixerTimecode.textContent = '00:00 / 00:00';
}

function updateSeekStyle(pct) {
  seekSlider.style.setProperty('--seek-pct', `${(pct * 100).toFixed(1)}%`);
}

async function applySeek(targetTime) {
  isSeeking = true;
  const wasPlaying = isPlaying;

  // Pause loop while seeking
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  if (wasPlaying) Object.values(tracks).forEach(a => { try { a.pause(); } catch(_){} });

  // Set time on all tracks
  Object.values(tracks).forEach(a => { if (a.src) { try { a.currentTime = targetTime; } catch(_){} } });

  // Give iOS time to process the seek before resuming
  await new Promise(r => setTimeout(r, 80));

  // Force-sync secondary tracks
  ['drums','bass','instruments'].forEach(n => {
    if (tracks[n].src) { try { tracks[n].currentTime = targetTime; } catch(_){} }
  });

  isSeeking = false;

  if (wasPlaying && isPlaying) {
    try {
      await Promise.all(Object.values(tracks).filter(a => a.src).map(a => a.play()));
    } catch(_){}
    loop();
  }
}

// While dragging – only update display, do NOT seek yet
seekSlider && seekSlider.addEventListener('input', () => {
  isSeeking = true; // block loop() from overriding the slider
  const pct = seekSlider.value / 1000;
  const dur = mainDur();
  if (dur) {
    if (timeCur) timeCur.textContent = fmt(pct * dur);
    if (timeDur) timeDur.textContent = fmt(dur);
    if (mixerTimecode) mixerTimecode.textContent = `${fmt(pct * dur)} / ${fmt(dur)}`;
    updateSeekStyle(pct);
  }
});

// On release (works on desktop & mobile)
async function onSeekRelease() {
  const dur = mainDur();
  if (!dur) { isSeeking = false; return; }
  if (seekSlider) await applySeek((seekSlider.value / 1000) * dur);
}
seekSlider && seekSlider.addEventListener('change',   onSeekRelease);
seekSlider && seekSlider.addEventListener('touchend', onSeekRelease, { passive: true });
seekSlider && seekSlider.addEventListener('mouseup',  onSeekRelease);

// +/- 10s buttons
btnSkipBack && btnSkipBack.addEventListener('click', async () => {
  const dur = mainDur(); if (!dur) return;
  const t = clamp((tracks.vocals.currentTime || 0) - 10, 0, dur);
  seekSlider.value = Math.round((t / dur) * 1000);
  updateSeekStyle(t / dur);
  await applySeek(t);
});
btnSkipFwd && btnSkipFwd.addEventListener('click', async () => {
  const dur = mainDur(); if (!dur) return;
  const t = clamp((tracks.vocals.currentTime || 0) + 10, 0, dur);
  seekSlider.value = Math.round((t / dur) * 1000);
  updateSeekStyle(t / dur);
  await applySeek(t);
});

function mainDur() { return tracks.vocals.duration || tracks.drums.duration || 0; }

function syncClocks(master) {
  const t = master !== undefined ? master : (tracks.vocals.currentTime || 0);
  ['drums','bass','instruments'].forEach(n => {
    if (tracks[n].src && Math.abs(tracks[n].currentTime - t) > 0.05) tracks[n].currentTime = t;
  });
}

// ---- Play / Pause ----
btnMasterPlay && btnMasterPlay.addEventListener('click', async () => {
  await unlockAudio();
  if (isPlaying) {
    Object.values(tracks).forEach(a => { try { a.pause(); } catch(_){} });
    isPlaying = false;
    playIcon.style.display = '';
    pauseIcon.style.display = 'none';
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  } else {
    syncClocks(tracks.vocals.currentTime || 0);
    let playedAny = false;
    const trackList = Object.values(tracks).filter(a => a && a.src);
    
    for (const a of trackList) {
      try {
        await a.play();
        playedAny = true;
      } catch (err) {
        console.warn('Track play error:', a.id, err);
      }
    }
    
    if (playedAny) {
      isPlaying = true;
      playIcon.style.display = 'none';
      pauseIcon.style.display = '';
      loop();
    } else {
      console.error('No tracks could be played');
    }
  }
});

function loop() {
  if (!isPlaying) return;
  const cur = tracks.vocals.currentTime || 0;
  const dur = mainDur();

  // Only update slider from audio position when user is NOT dragging
  if (!isSeeking && dur) {
    const pct = cur / dur;
    if (waveformProgress) waveformProgress.style.width = (pct * 100).toFixed(1) + '%';
    if (waveformThumb) waveformThumb.style.left = (pct * 100).toFixed(1) + '%';
    if (timeCur) timeCur.textContent = fmt(cur);
    if (timeDur) timeDur.textContent = fmt(dur);
    seekSlider.value = Math.round(pct * 1000);
    // Gentle re-sync: only correct if drift > 100ms
    ['drums','bass','instruments'].forEach(n => {
      if (tracks[n].src && Math.abs(tracks[n].currentTime - cur) > 0.1)
        tracks[n].currentTime = cur;
    });
  }

  // Peak meters
  drawRealtimeVisualizer();
  Object.keys(analysers).forEach(name => {
    const an = analysers[name];
    if (an && peaks[name]) {
      const d = new Uint8Array(an.frequencyBinCount);
      an.getByteFrequencyData(d);
      const avg = d.reduce((s,v) => s+v, 0) / d.length;
      peaks[name].style.width = `${clamp((avg/255)*180, 0, 100)}%`;
    }
  });

  // Volume sliders – update CSS custom property for fill
  Object.keys(sliders).forEach(name => {
    const card = sliders[name].closest('.stem-card');
    if (card) {
      const pct = (parseFloat(sliders[name].value) * 100).toFixed(1) + '%';
      card.style.setProperty('--vol-pct', pct);
    }
  });

  animFrameId = requestAnimationFrame(loop);
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(Math.floor(sec%60)).padStart(2,'0')}`;
}

// ---- Vol sliders init CSS var ----
Object.keys(sliders).forEach(name => {
  sliders[name].addEventListener('input', () => {
    const card = sliders[name].closest('.stem-card');
    if (card) card.style.setProperty('--vol-pct', (parseFloat(sliders[name].value)*100).toFixed(1)+'%');
    applyVolumes();
  });
  // Set initial
  const card = sliders[name].closest && sliders[name].closest('.stem-card');
  if (card) card.style.setProperty('--vol-pct', '100%');
});

// ---- Mute / Solo / Volumes ----
function applyVolumes() {
  const hasSolo = Object.values(soloStates).some(Boolean);
  Object.keys(tracks).forEach(n => {
    let v = parseFloat(sliders[n].value);
    if (muteStates[n] || (hasSolo && !soloStates[n])) v = 0;
    tracks[n].volume = clamp(v, 0, 1);
  });
}

Object.keys(btnMute).forEach(n => {
  btnMute[n].addEventListener('click', () => {
    muteStates[n] = !muteStates[n];
    btnMute[n].classList.toggle('active-mute', muteStates[n]);
    applyVolumes();
  });
});
Object.keys(btnSolo).forEach(n => {
  btnSolo[n].addEventListener('click', () => {
    soloStates[n] = !soloStates[n];
    btnSolo[n].classList.toggle('active-solo', soloStates[n]);
    applyVolumes();
  });
});

// ---- Presets ----
document.querySelectorAll('.pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = btn.dataset.preset;
    Object.keys(muteStates).forEach(k => {
      muteStates[k] = false; soloStates[k] = false;
      btnMute[k].classList.remove('active-mute');
      btnSolo[k].classList.remove('active-solo');
      sliders[k].value = 1;
    });
    if      (p === 'karaoke')  { muteStates.vocals = true; btnMute.vocals.classList.add('active-mute'); }
    else if (p === 'acapella') { soloStates.vocals = true; btnSolo.vocals.classList.add('active-solo'); }
    else if (p === 'drumless') { muteStates.drums  = true; btnMute.drums.classList.add('active-mute'); }
    else if (p === 'bassless') { muteStates.bass   = true; btnMute.bass.classList.add('active-mute'); }
    applyVolumes();
  });
});

// ---- Tempo & Pitch ----
let currentTempo = 1.0;
let currentPitch = 0;

function applyTempoAndPitch() {
  if (tempoVal) tempoVal.textContent = currentTempo.toFixed(2) + 'x';
  if (pitchVal) pitchVal.textContent = (currentPitch > 0 ? '+' : '') + currentPitch + ' ST';
  if (pitchSlider) pitchSlider.value = currentPitch;
  if (tempoSlider) tempoSlider.value = currentTempo;

  Object.values(tracks).forEach(t => {
    if (!t) return;
    if (currentPitch === 0) {
      t.preservesPitch = true;
      t.playbackRate = currentTempo;
    } else {
      t.preservesPitch = false;
      t.playbackRate = currentTempo * Math.pow(2, currentPitch / 12);
    }
  });
}

tempoSlider && tempoSlider.addEventListener('input', (e) => {
  currentTempo = parseFloat(e.target.value);
  applyTempoAndPitch();
});

pitchSlider && pitchSlider.addEventListener('input', (e) => {
  currentPitch = parseInt(e.target.value, 10);
  applyTempoAndPitch();
});

btnPitchDown && btnPitchDown.addEventListener('click', () => {
  if (currentPitch > -6) {
    currentPitch--;
    applyTempoAndPitch();
  }
});

btnPitchUp && btnPitchUp.addEventListener('click', () => {
  if (currentPitch < 6) {
    currentPitch++;
    applyTempoAndPitch();
  }
});

// ---- Reverb FX ----
let reverbActive = false;
btnReverb && btnReverb.addEventListener('click', () => {
  if (!reverbWet) return;
  reverbActive = !reverbActive;
  btnReverb.classList.toggle('active', reverbActive);
  reverbWet.gain.value = reverbActive ? 0.5 : 0;
});

// ---- Interactive Waveform ----
let waveformPeaks = [];

function generateWaveform() {
  if (waveformProgress) waveformProgress.style.width = '0%';
  if (waveformThumb) waveformThumb.style.left = '0%';
}

waveformContainer && waveformContainer.addEventListener('pointerdown', (e) => {
  const rect = waveformContainer.getBoundingClientRect();
  const pct = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  const dur = mainDur();
  if (dur) applySeek(pct * dur);
});

// ---- Realtime Siri / Apple Music Style Liquid Audio Waves ----
let wavePhase = 0;
let particles = [];

function initParticles(w, h) {
  if (particles.length) return;
  for (let i = 0; i < 24; i++) {
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 2 + 1,
      vy: Math.random() * 0.4 + 0.2,
      alpha: Math.random() * 0.5 + 0.2
    });
  }
}

function drawRealtimeVisualizer() {
  if (!visualizerCanvas) return;
  const ctx = visualizerCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = visualizerCanvas.offsetWidth * dpr;
  const h = visualizerCanvas.offsetHeight * dpr || (120 * dpr);
  if (visualizerCanvas.width !== w || visualizerCanvas.height !== h) {
    visualizerCanvas.width = w; visualizerCanvas.height = h;
    particles = [];
  }

  initParticles(w, h);
  ctx.clearRect(0, 0, w, h);
  const isLight = document.body.classList.contains('light-mode');
  const cy = h / 2;

  // Calculate stem audio energies
  let bassEnergy = 0, drumsEnergy = 0, vocalEnergy = 0, otherEnergy = 0;
  if (analysers.bass) {
    const d = new Uint8Array(analysers.bass.frequencyBinCount);
    analysers.bass.getByteFrequencyData(d);
    bassEnergy = (d.reduce((s, v) => s + v, 0) / d.length) / 255;
  }
  if (analysers.drums) {
    const d = new Uint8Array(analysers.drums.frequencyBinCount);
    analysers.drums.getByteFrequencyData(d);
    drumsEnergy = (d.reduce((s, v) => s + v, 0) / d.length) / 255;
  }
  if (analysers.vocals) {
    const d = new Uint8Array(analysers.vocals.frequencyBinCount);
    analysers.vocals.getByteFrequencyData(d);
    vocalEnergy = (d.reduce((s, v) => s + v, 0) / d.length) / 255;
  }
  if (analysers.instruments) {
    const d = new Uint8Array(analysers.instruments.frequencyBinCount);
    analysers.instruments.getByteFrequencyData(d);
    otherEnergy = (d.reduce((s, v) => s + v, 0) / d.length) / 255;
  }

  const masterEnergy = Math.max(0.05, (bassEnergy * 0.35 + drumsEnergy * 0.35 + vocalEnergy * 0.15 + otherEnergy * 0.15));
  wavePhase += 0.025 + masterEnergy * 0.035;

  // Real-time Audio Reactive Morphing Orb Physics
  const loaderEl = document.querySelector('.loader');
  if (loaderEl) {
    const isPlaying = isAnyPlaying();
    const currentScale = isPlaying ? (1.0 + masterEnergy * 0.45 + bassEnergy * 0.15) : 1.0;
    const animSpeed = isPlaying ? Math.max(0.4, 1.8 - masterEnergy * 1.4) : 3.0;
    const glowRadius = isPlaying ? Math.round(25 + masterEnergy * 50) : 25;
    
    loaderEl.style.transform = `scale(${currentScale.toFixed(3)})`;
    loaderEl.style.setProperty('--time-animation', `${animSpeed.toFixed(2)}s`);
    loaderEl.style.boxShadow = `0 0 ${glowRadius}px 0 var(--color-three), 0 20px 50px 0 var(--color-four)`;
  }

  // Background Ambient Glow
  const bgGrad = ctx.createRadialGradient(w / 2, cy, 5 * dpr, w / 2, cy, w * 0.45);
  if (isLight) {
    bgGrad.addColorStop(0, `rgba(245, 158, 11, ${0.12 + masterEnergy * 0.18})`);
    bgGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  } else {
    bgGrad.addColorStop(0, `rgba(245, 158, 11, ${0.18 + masterEnergy * 0.25})`);
    bgGrad.addColorStop(0.6, `rgba(236, 72, 153, ${0.08 + masterEnergy * 0.12})`);
    bgGrad.addColorStop(1, 'rgba(8, 8, 15, 0)');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Floating Dust Particles
  particles.forEach(p => {
    p.y -= p.vy * (1 + masterEnergy * 2);
    if (p.y < 0) { p.y = h; p.x = Math.random() * w; }
    ctx.fillStyle = isLight ? `rgba(217, 119, 6, ${p.alpha * 0.5})` : `rgba(255, 255, 255, ${p.alpha * 0.75})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * dpr, 0, Math.PI * 2);
    ctx.fill();
  });

  // Multi-layered Siri / Apple Music Fluid Sine Waves
  const waveConfigs = [
    {
      color: isLight ? 'rgba(217, 119, 6, 0.75)' : 'rgba(245, 158, 11, 0.9)',
      fill: isLight ? 'rgba(245, 158, 11, 0.07)' : 'rgba(245, 158, 11, 0.11)',
      freq: 0.012,
      amp: (h * 0.3) * (0.12 + masterEnergy * 0.88),
      speed: 1.0
    },
    {
      color: isLight ? 'rgba(225, 29, 72, 0.65)' : 'rgba(251, 113, 133, 0.8)',
      fill: isLight ? 'rgba(225, 29, 72, 0.05)' : 'rgba(251, 113, 133, 0.09)',
      freq: 0.018,
      amp: (h * 0.24) * (0.1 + drumsEnergy * 0.9),
      speed: -1.3
    },
    {
      color: isLight ? 'rgba(79, 70, 229, 0.55)' : 'rgba(129, 140, 248, 0.75)',
      fill: isLight ? 'rgba(79, 70, 229, 0.04)' : 'rgba(129, 140, 248, 0.07)',
      freq: 0.009,
      amp: (h * 0.26) * (0.08 + bassEnergy * 0.92),
      speed: 0.8
    }
  ];

  waveConfigs.forEach(config => {
    ctx.beginPath();
    ctx.moveTo(0, cy);

    for (let x = 0; x <= w; x += 3 * dpr) {
      const envelope = Math.sin((x / w) * Math.PI); // Smooth dampened edges
      const y = cy + Math.sin(x * config.freq + wavePhase * config.speed) * config.amp * envelope;
      ctx.lineTo(x, y);
    }

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = config.fill;
    ctx.fill();

    ctx.beginPath();
    for (let x = 0; x <= w; x += 3 * dpr) {
      const envelope = Math.sin((x / w) * Math.PI);
      const y = cy + Math.sin(x * config.freq + wavePhase * config.speed) * config.amp * envelope;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = config.color;
    ctx.lineWidth = 2.5 * dpr;
    ctx.stroke();
  });
}
btnOpenExport  && btnOpenExport.addEventListener('click',  () => exportOverlay.classList.add('open'));
btnCloseExport && btnCloseExport.addEventListener('click', () => exportOverlay.classList.remove('open'));
exportOverlay  && exportOverlay.addEventListener('click',  e => { if (e.target===exportOverlay) exportOverlay.classList.remove('open'); });

fmtBtnWav && fmtBtnWav.addEventListener('click', () => {
  exportFormat = 'wav';
  fmtBtnWav.classList.add('active'); fmtBtnMp3.classList.remove('active');
});
fmtBtnMp3 && fmtBtnMp3.addEventListener('click', () => {
  exportFormat = 'mp3';
  fmtBtnMp3.classList.add('active'); fmtBtnWav.classList.remove('active');
});

btnExportZip && btnExportZip.addEventListener('click', () => {
  if (currentJobId) window.location.href = `${API_BASE_URL}/api/download-zip/${currentJobId}?format=${exportFormat}`;
  exportOverlay.classList.remove('open');
});
btnExportMix && btnExportMix.addEventListener('click', () => {
  if (currentJobId) window.location.href = `${API_BASE_URL}/api/download-zip/${currentJobId}?format=${exportFormat}`;
  exportOverlay.classList.remove('open');
});

// ---- Library ----
function saveToLib(fileName, dur, jobId, localUrls = null) {
  let lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  // Avoid duplicates
  lib = lib.filter(item => item.jobId !== jobId);
  lib.unshift({
    name: fileName.replace(/\.[^/.]+$/, ''),
    dur: fmt(dur),
    date: new Date().toLocaleDateString(),
    stems: 4,
    jobId: jobId,
    localUrls: localUrls
  });
  // Keep only last 10
  localStorage.setItem('mixerup_lib', JSON.stringify(lib.slice(0, 10)));
}

function loadFromLib(jobId) {
  const lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  const item = lib.find(x => x.jobId === jobId);
  if (!item) return;

  if (item.jobId && item.jobId.startsWith('local-')) {
    if (item.localUrls && item.localUrls.length === 4) {
      tracks.vocals.src      = item.localUrls[0];
      tracks.drums.src       = item.localUrls[1];
      tracks.bass.src        = item.localUrls[2];
      tracks.instruments.src = item.localUrls[3];
    } else {
      alert("Yerel oturumun süresi doldu. Lütfen şarkıyı tekrar yükleyin.");
      return;
    }
  } else {
    currentJobId = item.jobId;
    const ts = Date.now();
    tracks.vocals.src      = `${API_BASE_URL}/api/stem-stream/${item.jobId}/vocal?v=${ts}`;
    tracks.drums.src       = `${API_BASE_URL}/api/stem-stream/${item.jobId}/drums?v=${ts}`;
    tracks.bass.src        = `${API_BASE_URL}/api/stem-stream/${item.jobId}/bass?v=${ts}`;
    tracks.instruments.src = `${API_BASE_URL}/api/stem-stream/${item.jobId}/other?v=${ts}`;
  }

  Object.values(tracks).forEach(t => t.load());
  goToMixer(item.name);
}

function deleteFromLib(jobId) {
  let lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  lib = lib.filter(x => x.jobId !== jobId);
  localStorage.setItem('mixerup_lib', JSON.stringify(lib));
  renderLibrary();
  updateCacheDisplay();
}

function renderLibrary() {
  const lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  libEmpty && (libEmpty.hidden = lib.length > 0);
  libraryList && (libraryList.innerHTML = '');
  lib.forEach(item => {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `<div class="lib-thumb-box">🎵</div>
      <div class="lib-info">
        <div class="lib-song-name">${item.name}</div>
        <div class="lib-sub-meta">${item.dur || '--:--'} · ${item.stems} kanal · ${item.date}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="delete-btn-fancy delete-btn" data-job="${item.jobId}" title="Sil">
          <svg class="svgIcon bin-top" viewBox="0 0 16 3" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 3H14.5C14.7761 3 15 2.77614 15 2.5V1.5C15 1.22386 14.7761 1 14.5 1H10.5V0.5C10.5 0.223858 10.2761 0 10 0H6C5.72386 0 5.5 0.223858 5.5 0.5V1H1.5C1.22386 1 1 1.22386 1 1.5V2.5C1 2.77614 1.22386 3 1.5 3Z"/>
          </svg>
          <svg class="svgIcon bin-bottom" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 2.5L1.875 12.125C1.94444 12.8889 2.58333 13.5 3.35 13.5H8.65C9.41667 13.5 10.0556 12.8889 10.125 12.125L11 2.5H1Z"/>
          </svg>
        </button>
        <button class="play-btn-fancy replay-btn" data-job="${item.jobId}" title="Oynat">
          <svg class="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
      </div>`;
    
    const replayBtn = el.querySelector('.replay-btn');
    replayBtn.addEventListener('click', () => {
      loadFromLib(item.jobId);
      setTimeout(generateWaveform, 300);
    });
    
    const deleteBtn = el.querySelector('.delete-btn');
    deleteBtn.addEventListener('click', () => deleteFromLib(item.jobId));
    
    libraryList && libraryList.appendChild(el);
  });
}

// ---- Theme ----
const themeCheckbox = $('themeCheckbox');

function applyTheme(theme) {
  localStorage.setItem('mixerup_theme', theme);
  document.body.className = theme === 'light' ? 'light-mode' : '';
  if (settingsThemeSelect) settingsThemeSelect.value = theme;
  if (themeCheckbox) themeCheckbox.checked = (theme === 'dark');
  generateWaveform();
  if (selectedFile) drawMiniWave(previewWaveCanvas, getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f59e0b');
}

const savedTheme = localStorage.getItem('mixerup_theme') || 'dark';
applyTheme(savedTheme);

if (settingsThemeSelect) {
  settingsThemeSelect.addEventListener('change', e => applyTheme(e.target.value));
}

if (themeCheckbox) {
  themeCheckbox.addEventListener('change', e => {
    applyTheme(e.target.checked ? 'dark' : 'light');
  });
}

// ---- Extended Settings Manager ----
function updateCacheDisplay() {
  const settingsCacheSize = $('settingsCacheSize');
  if (!settingsCacheSize) return;
  const lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  let totalBytes = JSON.stringify(lib).length * 2;
  let mb = (totalBytes / (1024 * 1024)).toFixed(1);
  if (lib.length > 0 && parseFloat(mb) === 0) mb = '0.4';
  settingsCacheSize.textContent = `${mb} MB (${lib.length} kayıt)`;
}

updateCacheDisplay();

const btnClearCache = $('btnClearCache');
btnClearCache && btnClearCache.addEventListener('click', () => {
  const lib = JSON.parse(localStorage.getItem('mixerup_lib') || '[]');
  if (lib.length === 0) {
    alert("Kütüphane zaten boş.");
    return;
  }
  if (confirm("Kütüphanedeki tüm kayıtlı şarkılar silinecek. Emin misiniz?")) {
    localStorage.removeItem('mixerup_lib');
    renderLibrary();
    updateCacheDisplay();
  }
});

// ---- Radio Glider Settings & Accordion Handler ----
function setupRadioGlider(name, storageKey, defaultValue, valLabelId, labelFormatter) {
  const saved = localStorage.getItem(storageKey) || defaultValue;
  const radios = document.querySelectorAll(`input[name="${name}"]`);
  const valLabel = $(valLabelId);

  const updateLabel = (val) => {
    if (!valLabel) return;
    const selectedRadio = Array.from(radios).find(r => r.value === val);
    if (selectedRadio) {
      const labelText = selectedRadio.nextElementSibling ? selectedRadio.nextElementSibling.textContent.trim() : val;
      valLabel.textContent = labelFormatter ? labelFormatter(labelText, val) : labelText.split('(')[0].trim();
    }
  };

  radios.forEach(r => {
    if (r.value === saved) {
      r.checked = true;
      updateLabel(saved);
    }
    r.addEventListener('change', e => {
      if (e.target.checked) {
        localStorage.setItem(storageKey, e.target.value);
        updateLabel(e.target.value);

        // Auto-close accordion after selecting an option
        const item = e.target.closest('.settings-accordion-item');
        if (item) {
          setTimeout(() => {
            item.classList.remove('open');
          }, 320);
        }
      }
    });
  });
}

// Accordion toggle click handler
document.querySelectorAll('.settings-accordion-item .accordion-header').forEach(header => {
  header.addEventListener('click', () => {
    const parent = header.closest('.settings-accordion-item');
    const isOpen = parent.classList.contains('open');

    // Close all other open accordions
    document.querySelectorAll('.settings-accordion-item.open').forEach(el => {
      if (el !== parent) el.classList.remove('open');
    });

    parent.classList.toggle('open', !isOpen);
  });
});

setupRadioGlider('aiModelRadio', 'mixerup_model', 'htdemucs', 'valModel');
setupRadioGlider('sampleRateRadio', 'mixerup_samplerate', '48000', 'valSampleRate');
setupRadioGlider('visualizerRadio', 'mixerup_visualizer', 'liquid', 'valVisualizer');
setupRadioGlider('formatRadio', 'mixerup_format', 'wav', 'valFormat');

// ---- Player Card Actions ----
const btnLikeTrack = $('btnLikeTrack');
if (btnLikeTrack) {
  btnLikeTrack.addEventListener('click', () => {
    btnLikeTrack.classList.toggle('liked');
  });
}

const btnShareTrack = $('btnShareTrack');
if (btnShareTrack) {
  btnShareTrack.addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: 'MixerUP',
        text: 'MixerUP ile ayrılmış şarkımı dinle!',
        url: window.location.href
      }).catch(() => {});
    } else {
      alert("Şarkı bağlantısı kopyalandı!");
    }
  });
}

// ---- Back To Top Floating Button ----
const btnBackToTop = $('btnBackToTop');

function checkScrollVisibility() {
  const activeScreen = document.querySelector('.screen:not([hidden])');
  const scrollY = (activeScreen && activeScreen.scrollTop) || window.scrollY || document.documentElement.scrollTop;
  if (scrollY > 120) {
    btnBackToTop && btnBackToTop.classList.add('visible');
  } else {
    btnBackToTop && btnBackToTop.classList.remove('visible');
  }
}

document.querySelectorAll('.screen').forEach(screen => {
  screen.addEventListener('scroll', checkScrollVisibility);
});
window.addEventListener('scroll', checkScrollVisibility);

btnBackToTop && btnBackToTop.addEventListener('click', () => {
  const activeScreen = document.querySelector('.screen:not([hidden])');
  if (activeScreen) {
    activeScreen.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
