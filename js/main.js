import { AudioEngine } from './audio.js';
import { SpectrumBars } from './visualizations/bars.js';
import { Oscilloscope } from './visualizations/oscilloscope.js';
import { RadialBurst } from './visualizations/radial.js';
import { PsychedelicFeedback } from './visualizations/plasma.js';
import { BeatParticles } from './visualizations/particles.js';
import { StarfieldWarp } from './visualizations/tunnel.js';
import { ToonTwoStep } from './visualizations/dancers.js';
import { GifTwoStep } from './visualizations/gifdance.js';

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
  new GifTwoStep(),
  new ToonTwoStep(),
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

visualizations.forEach((v, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = v.name;
  vizSelect.appendChild(opt);
});

let titleTimer = null;
function setVisualization(i) {
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
canvas.addEventListener('dblclick', toggleFullscreen);

// ---------- keyboard ----------
let controlsHidden = false;
document.addEventListener('keydown', (e) => {
  if (startOverlay && !startOverlay.classList.contains('hidden')) return;
  switch (e.key) {
    case 'ArrowRight': setVisualization(current + 1); break;
    case 'ArrowLeft': setVisualization(current - 1); break;
    case 'f': case 'F': toggleFullscreen(); break;
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
    levelFill.style.height = `${Math.min(100, audio.rms * 320)}%`;
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
