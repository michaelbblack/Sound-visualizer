/**
 * AudioEngine: captures microphone (or a built-in demo synth), runs an
 * AnalyserNode, and derives per-frame features the visualizations consume:
 *
 *   freq          Uint8Array   frequency bins (0-255)
 *   wave          Uint8Array   time-domain waveform (0-255, 128 = silence)
 *   bass/mid/treb number 0..1  smoothed band energies
 *   level         number 0..1  smoothed overall loudness
 *   beat          boolean      true on the frame a beat is detected
 *   beatPulse     number 0..1  spikes to 1 on a beat, decays quickly
 *   beatPhase     number 0..1  position within the current beat interval
 *   beatInterval  number sec   estimated time between beats (tempo)
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.freq = new Uint8Array(1024);
    this.wave = new Uint8Array(2048);
    this.sensitivity = 1;

    this.bass = 0;
    this.mid = 0;
    this.treb = 0;
    this.level = 0;

    this.beat = false;
    this.beatPulse = 0;
    this.beatPhase = 0;
    this.beatInterval = 0.5; // 120 BPM default until we've measured
    this._lastBeatTime = 0;
    this._energyHistory = [];
    this._lastFrameTime = 0;

    this.mode = null; // 'mic' | 'demo'
    this._demoNodes = [];
  }

  async initMic() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this._createContext();
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.analyser);
    this.mode = 'mic';
  }

  /** Synthesized four-on-the-floor beat so the app works without a mic. */
  initDemo() {
    this._createContext();
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.analyser);
    master.connect(ctx.destination);

    const bpm = 124;
    const beatSec = 60 / bpm;
    const scale = [130.81, 155.56, 174.61, 196.0, 233.08]; // C minor pentatonic-ish

    // Continuous bass drone that wobbles
    const bassOsc = ctx.createOscillator();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.value = 65.4;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.12;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.25;
    const wobbleGain = ctx.createGain();
    wobbleGain.gain.value = 30;
    wobble.connect(wobbleGain).connect(bassOsc.frequency);
    bassOsc.connect(bassGain).connect(master);
    bassOsc.start();
    wobble.start();
    this._demoNodes.push(bassOsc, wobble);

    // Scheduler: kick every beat, hat on offbeats, melody notes
    let step = 0;
    const scheduleAhead = () => {
      if (!this._demoNodes.length) return; // stopped
      const t = ctx.currentTime + 0.05;

      // Kick: short pitch-swept sine burst
      const kick = ctx.createOscillator();
      const kGain = ctx.createGain();
      kick.frequency.setValueAtTime(150, t);
      kick.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      kGain.gain.setValueAtTime(1.0, t);
      kGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      kick.connect(kGain).connect(master);
      kick.start(t);
      kick.stop(t + 0.3);

      // Hi-hat: filtered noise on the offbeat
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(0.25, t + beatSec / 2);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + beatSec / 2 + 0.05);
      noise.connect(hp).connect(nGain).connect(master);
      noise.start(t + beatSec / 2);

      // Melody pluck every other beat
      if (step % 2 === 0) {
        const note = ctx.createOscillator();
        note.type = 'square';
        note.frequency.value = scale[Math.floor(Math.random() * scale.length)] * 2;
        const mGain = ctx.createGain();
        mGain.gain.setValueAtTime(0.12, t);
        mGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        note.connect(mGain).connect(master);
        note.start(t);
        note.stop(t + 0.45);
      }
      step++;
    };
    scheduleAhead();
    const timer = setInterval(scheduleAhead, beatSec * 1000);
    this._demoNodes.push({ stop: () => clearInterval(timer) });
    this.mode = 'demo';
  }

  _createContext() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.fftSize);
  }

  /** Call once per animation frame. */
  update(now) {
    if (!this.analyser) return;
    const dt = this._lastFrameTime ? Math.min(0.1, now - this._lastFrameTime) : 0.016;
    this._lastFrameTime = now;

    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);

    const s = this.sensitivity;
    this.bass = this._smooth(this.bass, this._bandLevel(0, 0.04) * s, dt);
    this.mid = this._smooth(this.mid, this._bandLevel(0.04, 0.25) * s, dt);
    this.treb = this._smooth(this.treb, this._bandLevel(0.25, 0.8) * s, dt);
    this.level = this._smooth(this.level, this._bandLevel(0, 0.8) * s, dt);

    this._detectBeat(now, dt);
  }

  _bandLevel(fromFrac, toFrac) {
    const n = this.freq.length;
    const from = Math.floor(n * fromFrac);
    const to = Math.max(from + 1, Math.floor(n * toFrac));
    let sum = 0;
    for (let i = from; i < to; i++) sum += this.freq[i];
    return Math.min(1, sum / (to - from) / 255);
  }

  _smooth(prev, target, dt) {
    // Fast attack, slower release — feels punchy without flickering
    const rate = target > prev ? 18 : 6;
    return prev + (target - prev) * Math.min(1, rate * dt);
  }

  /**
   * Energy-flux beat detection: a beat fires when instantaneous bass energy
   * exceeds the recent average by a threshold, with a refractory period.
   * Beat times feed a rolling tempo estimate used for beatPhase.
   */
  _detectBeat(now, dt) {
    const energy = this._bandLevel(0, 0.05) * this.sensitivity;
    this._energyHistory.push(energy);
    if (this._energyHistory.length > 43) this._energyHistory.shift(); // ~0.7s at 60fps

    const avg = this._energyHistory.reduce((a, b) => a + b, 0) / this._energyHistory.length;
    const minGap = Math.max(0.22, this.beatInterval * 0.5);

    this.beat = false;
    if (
      energy > 0.06 &&
      energy > avg * 1.35 &&
      now - this._lastBeatTime > minGap
    ) {
      this.beat = true;
      this.beatPulse = 1;
      const gap = now - this._lastBeatTime;
      // Accept plausible musical tempos (40-200 BPM) into the estimate
      if (gap > 0.3 && gap < 1.5) {
        this.beatInterval = this.beatInterval * 0.7 + gap * 0.3;
      }
      this._lastBeatTime = now;
    }

    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.5);
    this.beatPhase = Math.min(1, (now - this._lastBeatTime) / this.beatInterval);
  }
}
