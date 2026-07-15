/**
 * AudioEngine: captures microphone (or a built-in demo synth), runs an
 * AnalyserNode, and derives per-frame features the visualizations consume:
 *
 *   freq          Uint8Array   frequency bins (0-255)
 *   wave          Uint8Array   time-domain waveform (0-255, 128 = silence)
 *   bass/mid/treb number 0..1  smoothed band energies
 *   level         number 0..1  smoothed overall loudness
 *   beat          boolean      true on the frame a beat fires
 *   beatPulse     number 0..1  spikes to 1 on a beat, decays quickly
 *   beatPhase     number 0..1  position within the current beat interval
 *   beatInterval  number sec   estimated time between beats (tempo)
 *   bpm           number       tempo estimate (0 until confident)
 *   bpmConfidence number 0..1  strength of the tempo estimate
 *   musicActive   boolean      false when the sound has stopped
 *
 * Tempo strategy: rather than relying on catching individual beat events
 * (fragile with real microphones, where room acoustics smear transients),
 * a continuous ONSET-STRENGTH ENVELOPE (spectral flux per frame) is recorded
 * and periodically AUTOCORRELATED to find the dominant periodicity — the
 * tempo emerges from all 8 seconds of evidence at once. Once locked, a
 * phase-aligned metronome predicts beats on that grid (re-aligned against
 * the envelope every 2s), so visuals get perfectly regular beats even when
 * individual kicks are barely detectable. Before lock (or if lock is lost),
 * a discrete spectral-flux detector provides beats directly.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.input = null; // gain stage in front of the analyser (AGC lives here)
    this.freq = new Uint8Array(1024);
    this.wave = new Uint8Array(2048);
    this.sensitivity = 1;
    this.autoGain = 1;
    this.rms = 0;

    this.bass = 0;
    this.mid = 0;
    this.treb = 0;
    this.level = 0;

    this.beat = false;
    this.beatPulse = 0;
    this.beatPhase = 0;
    this.beatInterval = 0.5; // 120 BPM default until measured
    this.bpm = 0;
    this.bpmConfidence = 0;
    this.tempoLocked = false;
    this.musicActive = false;

    this._lastBeatTime = 0;
    this._nextBeat = 0;
    this._lastTempoRun = 0;
    this._lastAudible = 0;
    this._badWindows = 0;
    this._prevSpec = null;
    this._fluxHistory = [];
    this._envT = []; // onset-strength envelope: times…
    this._envV = []; // …and values, spanning the last ~8s
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
    source.connect(this.input);
    this.mode = 'mic';
  }

  /** Synthesized four-on-the-floor beat so the app works without a mic. */
  initDemo() {
    this._createContext();
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.input);
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
    this.analyser.smoothingTimeConstant = 0.65; // low enough that attacks stay sharp
    this.input = this.ctx.createGain();
    this.input.connect(this.analyser);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.fftSize);
  }

  /** iOS suspends the context when the tab loses focus; call on user gestures. */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Call once per animation frame. */
  update(now) {
    if (!this.analyser) return;
    const dt = this._lastFrameTime ? Math.min(0.1, now - this._lastFrameTime) : 0.016;
    this._lastFrameTime = now;

    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.wave);
    this._autoGain(dt);

    this.bass = this._smooth(this.bass, this._bandLevel(0, 0.04), dt);
    this.mid = this._smooth(this.mid, this._bandLevel(0.04, 0.25), dt);
    this.treb = this._smooth(this.treb, this._bandLevel(0.25, 0.8), dt);
    this.level = this._smooth(this.level, this._bandLevel(0, 0.8), dt);

    // Onset-strength envelope sample for this frame
    const flux = this._spectralFlux();
    this._envT.push(now);
    this._envV.push(flux.full);
    while (this._envT.length && now - this._envT[0] > 8) {
      this._envT.shift();
      this._envV.shift();
    }
    this._updateMusicActive(now);

    if (this.tempoLocked && this.musicActive) {
      this._metronome(now, dt);
    } else {
      this._detectBeat(now, dt, flux.low);
    }

    if (now - this._lastTempoRun > 2) {
      this._lastTempoRun = now;
      this._analyzeTempo(now);
    }
  }

  /**
   * Automatic gain control: real microphones (especially on phones) deliver a
   * far quieter signal than line-level audio, so we amplify BEFORE the
   * analyser and keep adapting until the waveform sits at a healthy level.
   * The sensitivity slider steers the target loudness, not a raw multiplier.
   */
  _autoGain(dt) {
    const wave = this.wave;
    let sum = 0;
    for (let i = 0; i < wave.length; i += 4) {
      const d = (wave[i] - 128) / 128;
      sum += d * d;
    }
    this.rms = Math.sqrt(sum / (wave.length / 4));

    const target = 0.2 * this.sensitivity;
    const noiseFloor = 0.006; // don't amplify silence into a light show
    if (this.rms > noiseFloor) {
      const desired = Math.min(64, Math.max(0.25, this.autoGain * (target / this.rms)));
      // ramp up gently, back off fast when the signal gets hot (avoids pumping)
      const rate = desired > this.autoGain ? 0.5 : 4.0;
      this.autoGain += (desired - this.autoGain) * Math.min(1, rate * dt);
      this.input.gain.setTargetAtTime(this.autoGain, this.ctx.currentTime, 0.1);
    }
    // below the floor: freeze the gain so returning music is picked up instantly
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
   * Spectral flux = per-bin frame-to-frame INCREASE in energy. Sustained
   * tones contribute nothing; attacks spike it. `low` covers the kick range
   * (for the discrete detector); `full` covers 0-6kHz (for the envelope, so
   * beats carried by snares/hats through small speakers still count).
   */
  _spectralFlux() {
    const n = Math.floor(this.freq.length * 0.25);
    const lowN = Math.floor(this.freq.length * 0.1);
    let full = 0;
    let low = 0;
    if (this._prevSpec) {
      for (let i = 0; i < n; i++) {
        const d = this.freq[i] - this._prevSpec[i];
        if (d > 0) {
          full += d;
          if (i < lowN) low += d;
        }
      }
      full /= n * 255;
      low /= lowN * 255;
    } else {
      this._prevSpec = new Uint8Array(n);
    }
    this._prevSpec.set(this.freq.subarray(0, n));
    return { full, low };
  }

  /**
   * Music is "active" when the recent envelope shows real onsets AND level.
   * Sticky with ~1.8s of hysteresis: a borderline frame or a quiet bar must
   * not flap this flag (a flap halts the metronome and pauses the dancers) —
   * only sustained silence deactivates it.
   */
  _updateMusicActive(now) {
    let sum = 0;
    let count = 0;
    for (let i = this._envT.length - 1; i >= 0 && now - this._envT[i] < 0.8; i--) {
      sum += this._envV[i];
      count++;
    }
    const recent = count ? sum / count : 0;
    if (recent > 0.002 && this.rms > 0.04) this._lastAudible = now;
    this.musicActive = now - this._lastAudible < 1.2;
  }

  /**
   * Discrete beat detection (used before tempo lock): fires when low-band
   * flux exceeds its rolling average, with a refractory period.
   */
  _detectBeat(now, dt, flux) {
    this._fluxHistory.push(flux);
    if (this._fluxHistory.length > 43) this._fluxHistory.shift(); // ~0.7s at 60fps

    const avg = this._fluxHistory.reduce((a, b) => a + b, 0) / this._fluxHistory.length;
    const minGap = Math.max(0.22, this.beatInterval * 0.45);

    this.beat = false;
    if (
      flux > 0.008 &&
      flux > avg * 1.5 + 0.004 &&
      now - this._lastBeatTime > minGap
    ) {
      this.beat = true;
      this.beatPulse = 1;
      // Rough tempo from beat gaps until the autocorrelation lock takes over
      const gap = now - this._lastBeatTime;
      if (!this.tempoLocked && gap > 0.3 && gap < 1.5) {
        this.beatInterval = this.beatInterval * 0.7 + gap * 0.3;
      }
      this._lastBeatTime = now;
    }

    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.5);
    this.beatPhase = Math.min(1, (now - this._lastBeatTime) / this.beatInterval);
  }

  /**
   * Phase-locked metronome (used once tempo is locked): beats fire on the
   * predicted grid, giving visuals a rock-steady pulse even when individual
   * kicks are inaudible. _analyzeTempo re-aligns the grid every 2s.
   */
  _metronome(now, dt) {
    this.beat = false;
    if (now >= this._nextBeat) {
      this.beat = true;
      this.beatPulse = 1;
      this._lastBeatTime = now;
      this._nextBeat += this.beatInterval;
      // catch up after tab sleep / long frame gaps
      while (this._nextBeat <= now) this._nextBeat += this.beatInterval;
    }
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.5);
    this.beatPhase = Math.min(1, Math.max(0, 1 - (this._nextBeat - now) / this.beatInterval));
  }

  /**
   * Tempo induction by autocorrelating the onset-strength envelope.
   * The envelope is resampled onto a uniform 50Hz grid; autocorrelation over
   * lags spanning 70-180 BPM (scored with a 2x-lag harmonic bonus to resolve
   * octave errors, refined by parabolic interpolation) yields the period.
   * Beat PHASE comes from comb-matching a pulse train at that period against
   * the recent envelope. No discrete beat needs to be detected for this to
   * work — the tempo emerges from all ~8s of evidence at once.
   */
  _analyzeTempo(now) {
    const RATE = 50;
    const span = this._envT.length ? now - this._envT[0] : 0;
    if (this._envT.length < 100 || span < 4 || !this.musicActive) {
      this._degradeLock();
      return;
    }

    const N = Math.min(Math.floor(span * RATE), 8 * RATE);
    const tStart = now - N / RATE;
    const e = new Float32Array(N);
    for (let i = 0; i < this._envT.length; i++) {
      const idx = Math.floor((this._envT[i] - tStart) * RATE);
      if (idx >= 0 && idx < N && this._envV[i] > e[idx]) e[idx] = this._envV[i];
    }
    let mean = 0;
    for (let i = 0; i < N; i++) mean += e[i];
    mean /= N;
    for (let i = 0; i < N; i++) e[i] -= mean;

    let energy = 0;
    for (let i = 0; i < N; i++) energy += e[i] * e[i];
    energy /= N;
    if (energy < 1e-8) {
      this._degradeLock();
      return;
    }

    const minLag = Math.round((RATE * 60) / 180);
    const maxLag = Math.round((RATE * 60) / 70);
    const acMax = Math.min(2 * maxLag + 1, N - 1);
    const ac = new Float32Array(acMax + 1);
    for (let lag = minLag; lag <= acMax; lag++) {
      let s = 0;
      for (let i = lag; i < N; i++) s += e[i] * e[i - lag];
      ac[lag] = s / (N - lag) / energy; // normalized: 1 = perfectly periodic
    }

    const score = (lag) => {
      if (lag < minLag || lag > maxLag) return -1;
      const harmonic = 2 * lag <= acMax ? ac[2 * lag] : 0;
      return ac[lag] + 0.5 * harmonic;
    };
    let bestLag = 0;
    let bestScore = -1;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const s = score(lag);
      if (s > bestScore) {
        bestScore = s;
        bestLag = lag;
      }
    }

    const conf = Math.min(1, Math.max(0, bestScore * 0.8));
    if (conf < 0.2) {
      // One noisy window (a fill, a breakdown) must not drop an established
      // lock while music is playing — require consecutive failures.
      this._badWindows++;
      if (!this.musicActive || this._badWindows >= 2 || !this.tempoLocked) this._degradeLock();
      return;
    }
    this._badWindows = 0;

    // Parabolic refinement for sub-sample (sub-BPM) precision
    const s1 = score(bestLag - 1);
    const s2 = bestScore;
    const s3 = score(bestLag + 1);
    let delta = 0;
    const denom = s1 - 2 * s2 + s3;
    if (s1 >= 0 && s3 >= 0 && Math.abs(denom) > 1e-9) {
      delta = Math.max(-0.5, Math.min(0.5, (0.5 * (s1 - s3)) / denom));
    }
    const period = (bestLag + delta) / RATE;

    // Tempo continuity: small drift blends smoothly, a real change snaps
    if (Math.abs(period - this.beatInterval) / this.beatInterval < 0.08) {
      this.beatInterval = this.beatInterval * 0.6 + period * 0.4;
    } else {
      this.beatInterval = period;
    }
    this.bpm = 60 / this.beatInterval;
    this.bpmConfidence = conf;

    // ---- phase: comb-match a pulse train at the found period ----
    const periodSamples = this.beatInterval * RATE;
    const combSpan = Math.min(N, 4 * RATE);
    const nPulses = Math.max(1, Math.floor(combSpan / periodSamples) - 1);
    const steps = Math.max(1, Math.round(periodSamples));
    let bestOff = 0;
    let bestSum = -Infinity;
    for (let o = 0; o < steps; o++) {
      let sum = 0;
      for (let k = 0; k <= nPulses; k++) {
        const idx = N - 1 - o - Math.round(k * periodSamples);
        if (idx >= 0) sum += e[idx];
      }
      if (sum > bestSum) {
        bestSum = sum;
        bestOff = o;
      }
    }
    let aligned = now - bestOff / RATE; // most recent beat location
    while (aligned + this.beatInterval < now) aligned += this.beatInterval;
    const predicted = aligned + this.beatInterval; // first beat after `now`

    if (this.tempoLocked) {
      // nudge rather than jump, so visuals don't stutter
      let diff = predicted - this._nextBeat;
      const T = this.beatInterval;
      diff = ((diff % T) + 1.5 * T) % T - 0.5 * T; // center into [-T/2, T/2)
      this._nextBeat += Math.max(-0.2 * T, Math.min(0.2 * T, diff));
      while (this._nextBeat <= now) this._nextBeat += T;
    } else {
      this._nextBeat = predicted;
      this.tempoLocked = true;
    }
  }

  _degradeLock() {
    this.bpmConfidence *= 0.6;
    if (this.bpmConfidence < 0.12) {
      this.tempoLocked = false;
      if (this.bpmConfidence < 0.03) {
        this.bpmConfidence = 0;
        this.bpm = 0;
      }
    }
  }
}
