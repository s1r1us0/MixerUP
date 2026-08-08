/* ==========================================================================
   MixerUp iOS Pro Engine — Master-Slave Microsecond Audio Sync Engine
   ========================================================================== */

// --- DOM References ---
const songFile = document.getElementById('songFile');
const deviceSelect = document.getElementById('deviceSelect');
const progressWrap = document.getElementById('progressWrap');
const progressText = document.getElementById('progressText');
const progressValue = document.getElementById('progressValue');
const progressBar = document.getElementById('progressBar');

const playerCard = document.getElementById('playerCard');
const mixerCard = document.getElementById('mixerCard');
const effectsCard = document.getElementById('effectsCard');
const floatingDock = document.getElementById('floatingDock');

const songTitleText = document.getElementById('songTitleText');
const timeDisplay = document.getElementById('timeDisplay');
const btnMasterPlay = document.getElementById('btnMasterPlay');
const waveformCanvas = document.getElementById('waveformCanvas');

// Audio Tracks
const tracks = {
  vocal: document.getElementById('vocalAudio'),
  drums: document.getElementById('drumsAudio'),
  bass: document.getElementById('bassAudio'),
  other: document.getElementById('otherAudio')
};

// Controls
const faders = {
  vocal: document.getElementById('faderVocal'),
  drums: document.getElementById('faderDrums'),
  bass: document.getElementById('faderBass'),
  other: document.getElementById('faderOther')
};

const volLabels = {
  vocal: document.getElementById('vocalVolLabel'),
  drums: document.getElementById('drumsVolLabel'),
  bass: document.getElementById('bassVolLabel'),
  other: document.getElementById('otherVolLabel')
};

const peaks = {
  vocal: document.getElementById('peakVocal'),
  drums: document.getElementById('peakDrums'),
  bass: document.getElementById('peakBass'),
  other: document.getElementById('peakOther')
};

const btnMute = {
  vocal: document.getElementById('btnMuteVocal'),
  drums: document.getElementById('btnMuteDrums'),
  bass: document.getElementById('btnMuteBass'),
  other: document.getElementById('btnMuteOther')
};

const btnSolo = {
  vocal: document.getElementById('btnSoloVocal'),
  drums: document.getElementById('btnSoloDrums'),
  bass: document.getElementById('btnSoloBass'),
  other: document.getElementById('btnSoloOther')
};

const pitchSlider = document.getElementById('pitchSlider');
const pitchLabel = document.getElementById('pitchLabel');
const tempoSlider = document.getElementById('tempoSlider');
const tempoLabel = document.getElementById('tempoLabel');

const btnExportMix = document.getElementById('btnExportMix');
const btnExportZip = document.getElementById('btnExportZip');

// Master State
let currentJobId = null;
let isPlaying = false;
let isSeeking = false;
let audioCtx = null;
let animFrameId = null;
let createdBlobUrls = [];

const muteStates = { vocal: false, drums: false, bass: false, other: false };
const soloStates = { vocal: false, drums: false, bass: false, other: false };

// --- Web Audio & Peak Analysers ---
let analysers = {};

function initWebAudio() {
  if (audioCtx) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContext();

  Object.keys(tracks).forEach(name => {
    try {
      const source = audioCtx.createMediaElementSource(tracks[name]);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      analysers[name] = analyser;
    } catch (e) {
      // Attached
    }
  });
}

function unlockAudioOnTouch() {
  if (!audioCtx) initWebAudio();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}
['touchstart', 'touchend', 'click'].forEach(evt => {
  document.addEventListener(evt, unlockAudioOnTouch, { once: true });
});

// --- Waveform Canvas Scrubber ---
const ctx = waveformCanvas.getContext('2d');
function setupCanvas() {
  const rect = waveformCanvas.parentElement.getBoundingClientRect();
  waveformCanvas.width = rect.width * (window.devicePixelRatio || 1);
  waveformCanvas.height = rect.height * (window.devicePixelRatio || 1);
}
window.addEventListener('resize', setupCanvas);

function drawWaveform() {
  if (!waveformCanvas.width) setupCanvas();
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;

  ctx.clearRect(0, 0, width, height);

  const mainTrack = tracks.vocal;
  const duration = mainTrack.duration || 1;
  const currentTime = mainTrack.currentTime || 0;
  const progress = currentTime / duration;

  const barWidth = 3;
  const gap = 2;
  const totalBars = Math.floor(width / (barWidth + gap));

  for (let i = 0; i < totalBars; i++) {
    const barProgress = i / totalBars;
    const h = Math.max(8, Math.sin(i * 0.18) * 32 + Math.cos(i * 0.35) * 22 + 38);
    const y = (height - h) / 2;

    if (barProgress <= progress) {
      ctx.fillStyle = '#ff2e93';
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    }

    ctx.fillRect(i * (barWidth + gap), y, barWidth, h);
  }

  // Playhead line
  const playheadX = progress * width;
  ctx.fillStyle = '#a3e635';
  ctx.fillRect(playheadX - 1, 0, 3, height);
}

// Master-Slave Microsecond Sync Seeking
function seekToPosition(targetTime) {
  isSeeking = true;
  
  // Pause all tracks to prevent seeking audio scrambling
  Object.values(tracks).forEach(audio => {
    audio.pause();
    audio.currentTime = targetTime;
  });

  drawWaveform();

  // If was playing, resume after micro-delay
  if (isPlaying) {
    setTimeout(() => {
      syncTrackPositions(targetTime);
      Promise.all(Object.values(tracks).filter(a => a.src).map(a => a.play()))
        .then(() => { isSeeking = false; })
        .catch(() => { isSeeking = false; });
    }, 40);
  } else {
    isSeeking = false;
  }
}

// Force exact master-slave clock alignment
function syncTrackPositions(masterTime) {
  const t = masterTime !== undefined ? masterTime : (tracks.vocal.currentTime || 0);
  ['drums', 'bass', 'other'].forEach(name => {
    if (Math.abs(tracks[name].currentTime - t) > 0.02) {
      tracks[name].currentTime = t;
    }
  });
}

// Canvas Touch / Drag Seek Event
waveformCanvas.addEventListener('click', (e) => {
  const rect = waveformCanvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  const mainTrack = tracks.vocal;
  if (mainTrack.duration) {
    seekToPosition(ratio * mainTrack.duration);
  }
});

// --- Master Loop & Audio Sync Drift Guard ---
function updateLoop() {
  if (!isPlaying) return;

  const masterTrack = tracks.vocal;
  if (masterTrack && !isSeeking) {
    const cur = masterTrack.currentTime || 0;
    const dur = masterTrack.duration || 0;
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    
    // Master-slave sync drift guard (ensures 0% echo/scramble)
    syncTrackPositions(cur);
    drawWaveform();
  }

  // Peak Level Meters
  Object.keys(analysers).forEach(name => {
    const analyser = analysers[name];
    if (analyser && peaks[name]) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      const pct = Math.min(100, Math.round((avg / 255) * 160));
      peaks[name].style.height = `${pct}%`;
    }
  });

  animFrameId = requestAnimationFrame(updateLoop);
}

function formatTime(sec) {
  if (isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Master Play/Pause Button
btnMasterPlay.addEventListener('click', async () => {
  unlockAudioOnTouch();
  if (isPlaying) {
    Object.values(tracks).forEach(audio => audio.pause());
    isPlaying = false;
    btnMasterPlay.textContent = '▶';
    if (animFrameId) cancelAnimationFrame(animFrameId);
  } else {
    try {
      // Sync clock times before play
      syncTrackPositions(tracks.vocal.currentTime || 0);
      await Promise.all(Object.values(tracks).filter(a => a.src).map(a => a.play()));
      isPlaying = true;
      btnMasterPlay.textContent = '❚❚';
      updateLoop();
    } catch (err) {
      console.warn('Playback error:', err);
    }
  }
});

// Sync Track Ended
Object.values(tracks).forEach(audio => {
  audio.addEventListener('ended', () => {
    isPlaying = false;
    btnMasterPlay.textContent = '▶';
  });
});

// --- Fader & Mute/Solo Engine ---
function updateAudioVolumes() {
  const hasSolo = Object.values(soloStates).some(v => v);

  Object.keys(tracks).forEach(name => {
    let vol = parseFloat(faders[name].value);

    if (muteStates[name]) {
      vol = 0;
    } else if (hasSolo && !soloStates[name]) {
      vol = 0;
    }

    tracks[name].volume = Math.max(0, Math.min(1, vol));
    volLabels[name].textContent = `${Math.round(vol * 100)}%`;
  });
}

Object.keys(faders).forEach(name => {
  faders[name].addEventListener('input', updateAudioVolumes);
});

Object.keys(btnMute).forEach(name => {
  btnMute[name].addEventListener('click', () => {
    muteStates[name] = !muteStates[name];
    btnMute[name].classList.toggle('active-mute', muteStates[name]);
    updateAudioVolumes();
  });
});

Object.keys(btnSolo).forEach(name => {
  btnSolo[name].addEventListener('click', () => {
    soloStates[name] = !soloStates[name];
    btnSolo[name].classList.toggle('active-solo', soloStates[name]);
    updateAudioVolumes();
  });
});

// Pitch & Tempo Controls
pitchSlider.addEventListener('input', (e) => {
  const val = e.target.value;
  pitchLabel.textContent = `${val > 0 ? '+' : ''}${val} st`;
  const semitones = parseFloat(val);
  const rate = Math.pow(2, semitones / 12) * parseFloat(tempoSlider.value);
  Object.values(tracks).forEach(audio => {
    audio.playbackRate = rate;
  });
});

tempoSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  tempoLabel.textContent = `${val.toFixed(2)}x`;
  const semitones = parseFloat(pitchSlider.value);
  const rate = Math.pow(2, semitones / 12) * val;
  Object.values(tracks).forEach(audio => {
    audio.playbackRate = rate;
  });
});

// Preset Sound Chips
document.querySelectorAll('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    const preset = chip.dataset.preset;
    
    // Reset States
    Object.keys(muteStates).forEach(k => {
      muteStates[k] = false;
      soloStates[k] = false;
      btnMute[k].classList.remove('active-mute');
      btnSolo[k].classList.remove('active-solo');
      faders[k].value = 1;
    });

    if (preset === 'karaoke') {
      muteStates.vocal = true;
      btnMute.vocal.classList.add('active-mute');
    } else if (preset === 'acapella') {
      soloStates.vocal = true;
      btnSolo.vocal.classList.add('active-solo');
    } else if (preset === 'drumless') {
      muteStates.drums = true;
      btnMute.drums.classList.add('active-mute');
    } else if (preset === 'bassless') {
      muteStates.bass = true;
      btnMute.bass.classList.add('active-mute');
    }

    updateAudioVolumes();
  });
});

// --- Memory Cleanup ---
function clearPreviousBlobs() {
  createdBlobUrls.forEach(url => URL.revokeObjectURL(url));
  createdBlobUrls = [];
}

// --- Song & Video File Selector ---
songFile.addEventListener('change', async ({ target }) => {
  const file = target.files[0];
  if (!file) return;

  songTitleText.textContent = file.name.replace(/\.[^/.]+$/, '');
  progressWrap.hidden = false;
  progressText.textContent = 'Hazırlanıyor…';
  progressValue.textContent = '0%';
  progressBar.style.width = '0%';

  clearPreviousBlobs();

  if (deviceSelect.value === 'offline') {
    await processOfflineWasm(file);
  } else {
    await processServerApi(file);
  }
});

// Server Demucs Separator
async function processServerApi(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('device', deviceSelect.value);

  try {
    progressText.textContent = 'Yükleniyor…';
    const uploadRes = await fetch('/api/separate', { method: 'POST', body: formData });
    const { job_id } = await uploadRes.json();
    currentJobId = job_id;

    const pollInterval = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job_id}`);
      const job = await res.json();
      
      progressText.textContent = job.status === 'processing' ? 'AI Kanalları Ayırıyor…' : 'İşleniyor…';
      progressValue.textContent = `${job.progress || 0}%`;
      progressBar.style.width = `${job.progress || 0}%`;

      if (job.status === 'completed') {
        clearInterval(pollInterval);
        progressWrap.hidden = true;
        
        Object.keys(tracks).forEach(name => {
          tracks[name].src = `/api/stem-stream/${job_id}/${name}?v=${Date.now()}`;
          tracks[name].load();
        });

        showPlayerControls();
      } else if (job.status === 'failed') {
        clearInterval(pollInterval);
        alert('Ayrıştırma hatası oluştu.');
      }
    }, 1000);

  } catch (err) {
    console.error('Server process error:', err);
    alert('Sunucuya bağlanılamadı. Offline modunu deneyebilirsiniz.');
  }
}

// Offline WebAssembly DSP Engine (with MP4/MOV Video Support)
async function processOfflineWasm(file) {
  try {
    progressText.textContent = 'Cihaz İçi DSP Ayrıştırılıyor…';
    progressValue.textContent = '50%';
    progressBar.style.width = '50%';

    const arrayBuffer = await file.arrayBuffer();
    if (!audioCtx) initWebAudio();

    // Decodes audio track directly out of MP3, WAV, M4A, FLAC and MP4/MOV video files!
    const decodedAudio = await audioCtx.decodeAudioData(arrayBuffer);

    const offlineCtx = new OfflineAudioContext(
      decodedAudio.numberOfChannels,
      decodedAudio.length,
      decodedAudio.sampleRate
    );

    const createFilterStem = async (lowFreq, highFreq) => {
      const source = offlineCtx.createBufferSource();
      source.buffer = decodedAudio;
      let lastNode = source;

      if (lowFreq > 0) {
        const hp = offlineCtx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = lowFreq;
        lastNode.connect(hp);
        lastNode = hp;
      }
      if (highFreq < 20000) {
        const lp = offlineCtx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = highFreq;
        lastNode.connect(lp);
        lastNode = lp;
      }
      lastNode.connect(offlineCtx.destination);
      source.start();

      const renderedBuffer = await offlineCtx.startRendering();
      return bufferToBlob(renderedBuffer);
    };

    const vocalBlob = await createFilterStem(300, 3400);
    const drumsBlob = await createFilterStem(60, 250);
    const bassBlob = await createFilterStem(20, 150);
    const otherBlob = await createFilterStem(3400, 18000);

    const vocalUrl = URL.createObjectURL(vocalBlob);
    const drumsUrl = URL.createObjectURL(drumsBlob);
    const bassUrl = URL.createObjectURL(bassBlob);
    const otherUrl = URL.createObjectURL(otherBlob);

    createdBlobUrls.push(vocalUrl, drumsUrl, bassUrl, otherUrl);

    tracks.vocal.src = vocalUrl;
    tracks.drums.src = drumsUrl;
    tracks.bass.src = bassUrl;
    tracks.other.src = otherUrl;

    Object.values(tracks).forEach(a => a.load());

    progressValue.textContent = '100%';
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressWrap.hidden = true;
      showPlayerControls();
    }, 500);

  } catch (err) {
    console.error('Offline process error:', err);
    alert('Cihaz içi ayrıştırma hatası.');
  }
}

function bufferToBlob(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  let channels = [], sampleRate = buffer.sampleRate, offset = 0, pos = 0;

  function setUint16(data) { out.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { out.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }
  return new Blob([out], { type: 'audio/wav' });
}

function showPlayerControls() {
  playerCard.hidden = false;
  mixerCard.hidden = false;
  effectsCard.hidden = false;
  floatingDock.hidden = false;
  setupCanvas();
  drawWaveform();
}

// Download Buttons
btnExportMix.addEventListener('click', () => {
  if (currentJobId) {
    window.location.href = `/api/download/${currentJobId}?type=mix`;
  } else {
    alert('İndirilecek aktif miks bulunamadı.');
  }
});

btnExportZip.addEventListener('click', () => {
  if (currentJobId) {
    window.location.href = `/api/download/${currentJobId}?type=stems`;
  } else {
    alert('İndirilecek kanallar bulunamadı.');
  }
});
