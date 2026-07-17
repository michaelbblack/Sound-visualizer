import { AudioEngine } from './audio.js';
import { SpectrumBars } from './visualizations/bars.js';
import { Oscilloscope } from './visualizations/oscilloscope.js';
import { RadialBurst } from './visualizations/radial.js';
import { PsychedelicFeedback } from './visualizations/plasma.js';
import { BeatParticles } from './visualizations/particles.js';
import { StarfieldWarp } from './visualizations/tunnel.js';
import { SilhouetteRave } from './visualizations/dancers.js';
import { MemeCycle } from './visualizations/gifdance.js';
import { PulseRings } from './visualizations/pulserings.js';

const canvas = document.getElementById('viz-canvas');
const ctx = canvas.getContext('2d');
const audio = new AudioEngine();

const visualizations = [
  new SpectrumBars(),
  new Oscilloscope(),
  new RadialBurst(),
  new PsychedelicFeedback(),
  new BeatParticles(),
  new StarfieldWarp(),
  new PulseRings(),
  new MemeCycle(),
  new SilhouetteRave(),
];
let current = 0;

// ---------- canvas sizing ----------
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// ---------- UI elements ----------
const startOverlay = document.getElementById('start-overlay');
const startError = document.getElementById('start-error');
const controls = document.getElementById('controls');
const vizSelect = document.getElementById('viz-select');
const vizTitle = document.getElementById('viz-title');
const sensitivity = document.getElementById('sensitivity');
const levelFill = document.getElementById('level-fill');
const bpmDisplay = document.getElementById('bpm-display');
const bpmValue = document.getElementById('bpm-value');

let bpmVisible = false;
function toggleBpm() {
  bpmVisible = !bpmVisible;
  bpmDisplay.classList.toggle('hidden', !bpmVisible);
}

visualizations.forEach((v, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = v.name;
  vizSelect.appendChild(opt);
});

// ---- shuffle mode: hop to a random visualization every 16 bars ----
let shuffle = false;
let shuffleBeats = 0;
let shuffleClock = 0;
function toggleShuffle() {
  shuffle = !shuffle;
  document.getElementById('shuffle-btn').classList.toggle('active', shuffle);
  shuffleBeats = 0;
  shuffleClock = 0;
}
function shuffleTick(dt) {
  if (!shuffle) return;
  if (audio.beat) shuffleBeats++;
  shuffleClock += dt;
  // 64 beats = 16 bars (~30s at 128 BPM); clock is the no-beats fallback
  if (shuffleBeats >= 64 || shuffleClock > 40) {
    let next = current;
    while (next === current && visualizations.length > 1) {
      next = Math.floor(Math.random() * visualizations.length);
    }
    setVisualization(next);
  }
}

let titleTimer = null;
function setVisualization(i) {
  shuffleBeats = 0;
  shuffleClock = 0;
  current = (i + visualizations.length) % visualizations.length;
  vizSelect.value = current;
  // Clear any residual frame state when switching
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  vizTitle.textContent = visualizations[current].name;
  vizTitle.classList.remove('hidden');
  vizTitle.classList.add('show');
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => vizTitle.classList.remove('show'), 1800);
}

vizSelect.addEventListener('change', () => setVisualization(Number(vizSelect.value)));
document.getElementById('prev-viz').addEventListener('click', () => setVisualization(current - 1));
document.getElementById('next-viz').addEventListener('click', () => setVisualization(current + 1));
sensitivity.addEventListener('input', () => (audio.sensitivity = Number(sensitivity.value)));

// ---------- fullscreen ----------
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
document.getElementById('bpm-btn').addEventListener('click', toggleBpm);
document.getElementById('shuffle-btn').addEventListener('click', toggleShuffle);
canvas.addEventListener('dblclick', toggleFullscreen);

// ---------- keyboard ----------
let controlsHidden = false;
document.addEventListener('keydown', (e) => {
  if (startOverlay && !startOverlay.classList.contains('hidden')) return;
  switch (e.key) {
    case 'ArrowRight': setVisualization(current + 1); break;
    case 'ArrowLeft': setVisualization(current - 1); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'b': case 'B': toggleBpm(); break;
    case 's': case 'S': toggleShuffle(); break;
    case 'h': case 'H':
      controlsHidden = !controlsHidden;
      controls.classList.toggle('hidden', controlsHidden);
      break;
    default: {
      // Number keys jump straight to a visualization
      const n = Number(e.key);
      if (n >= 1 && n <= visualizations.length) setVisualization(n - 1);
    }
  }
});

// ---------- auto-hide controls & cursor when idle ----------
let idleTimer = null;
function wake() {
  controls.classList.remove('faded');
  canvas.style.cursor = 'default';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    controls.classList.add('faded');
    canvas.style.cursor = 'none';
  }, 3000);
}
['mousemove', 'touchstart', 'click'].forEach((ev) => document.addEventListener(ev, wake));

// iOS Safari suspends the AudioContext when the tab is backgrounded and won't
// always resume it on its own — kick it on any interaction / return to tab.
['touchend', 'click'].forEach((ev) => document.addEventListener(ev, () => audio.resume()));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) audio.resume();
});

// ---------- start flow ----------
async function start(mode) {
  startError.classList.add('hidden');
  try {
    if (mode === 'mic') await audio.initMic();
    else audio.initDemo();
  } catch (err) {
    startError.textContent =
      'Could not access the microphone: ' + (err.message || err.name) +
      '. Check browser permissions, or try Demo Mode.';
    startError.classList.remove('hidden');
    return;
  }
  startOverlay.classList.add('hidden');
  controls.classList.remove('hidden');
  wake();
  setVisualization(0);
}
document.getElementById('start-mic').addEventListener('click', () => start('mic'));
document.getElementById('start-demo').addEventListener('click', () => start('demo'));

// ---------- render loop ----------
let lastT = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - lastT);
  lastT = now;

  if (audio.analyser) {
    audio.update(now);
    shuffleTick(dt);
    levelFill.style.height = `${Math.min(100, audio.rms * 320)}%`;
    if (bpmVisible) {
      bpmValue.textContent =
        audio.bpm > 0 && audio.bpmConfidence > 0.15 ? String(Math.round(audio.bpm)) : '--';
      // subtle pulse on the beat so you can eyeball the lock
      bpmDisplay.style.transform = `scale(${1 + audio.beatPulse * 0.12})`;
      bpmDisplay.style.opacity = String(0.55 + Math.min(0.45, audio.bpmConfidence));
    }
    visualizations[current].draw({
      ctx,
      audio,
      w: canvas.width,
      h: canvas.height,
      dt,
      t: now,
    });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug handle (e.g. check __viz.audio.autoGain / .rms from the console)
window.__viz = { audio, visualizations };
