import { WarpEngine, hueMatrix } from '../lib/warpfx.js';

/**
 * Oscilloscope — MilkDrop/Geiss-style per-pixel feedback warp.
 *
 * The live waveform is drawn as glowing "ink" and injected into a WebGL
 * feedback loop where every pixel of the previous frame is re-sampled
 * through a warp field (zoom, rotation, radial swirl, ripple, shear),
 * decayed and hue-rotated. The trail of every wave that ever played keeps
 * flowing, folding and dissolving — real fluid, not stamped copies.
 *
 * A "preset" (warp parameters + ink style: linear wave, circular wave, or
 * crossed waves) mutates every 16 beats and morphs smoothly, the way
 * MilkDrop blends presets. Audio drives everything live: bass pushes the
 * zoom, mids stir the swirl, treble shears the fluid, beats splash ink.
 */
export class Oscilloscope {
  constructor() {
    this.name = 'Oscilloscope';
    this.engine = null;
    this.ink = null;
    this.hue = 180;
    this.wavePhase = 0;
    this.beatsSince = 0;
    this.lastMut = -99;
    this.cur = this._randomPreset();
    this.target = this._randomPreset();
  }

  _randomPreset() {
    const R = (a, b) => a + Math.random() * (b - a);
    const sign = Math.random() < 0.5 ? -1 : 1;
    return {
      zoomBase: Math.random() < 0.3 ? R(0.994, 0.999) : R(1.002, 1.011),
      rotBase: sign * R(0.0008, 0.0038),
      swirl: (Math.random() < 0.5 ? -1 : 1) * R(0.08, 0.42),
      swirlFreq: R(4, 13),
      ripple: R(0, 0.9),
      rippleFreq: R(6, 18),
      shear: R(0, 1),
      decay: R(0.963, 0.986),
      hueSpeed: sign * R(0.25, 1.1), // radians/sec of continuous hue cycling
      centerAmp: R(0.02, 0.1),
      style: (Math.random() * 3) | 0,
    };
  }

  draw({ ctx, audio, w, h, dt, t }) {
    if (!this.engine) this.engine = new WarpEngine();
    if (!this.engine.ok) {
      this._fallback(ctx, audio, w, h);
      return;
    }
    this.engine._resize(w, h);
    const W = this.engine.canvas.width;
    const H = this.engine.canvas.height;
    if (!this.ink || this.ink.width !== W || this.ink.height !== H) {
      this.ink = document.createElement('canvas');
      this.ink.width = W;
      this.ink.height = H;
      this.inkCtx = this.ink.getContext('2d');
    }

    // ---- preset lifecycle: mutate every 16 beats, morph continuously ----
    if (audio.beat) this.beatsSince++;
    if (this.beatsSince >= 16 || t - this.lastMut > 20) {
      this.beatsSince = 0;
      this.lastMut = t;
      this.target = this._randomPreset();
      this.cur.style = this.target.style; // ink style switches on the bar
    }
    const k = Math.min(1, 1.1 * dt);
    for (const key of Object.keys(this.target)) {
      if (key === 'style') continue;
      this.cur[key] += (this.target[key] - this.cur[key]) * k;
    }

    this.hue = (this.hue + dt * 14 + audio.beatPulse * dt * 70) % 360;
    this._drawInk(audio, W, H, t, dt);

    // ---- assemble the live warp field from preset + audio ----
    const c = this.cur;
    const zoomDir = c.zoomBase >= 1 ? 1 : -1;
    const params = {
      zoom: c.zoomBase + zoomDir * (audio.bass * 0.011 + audio.beatPulse * 0.007),
      rot: c.rotBase * (1 + audio.mid * 1.6),
      swirl: c.swirl * (0.45 + audio.mid * 1.2),
      swirlFreq: c.swirlFreq,
      ripple: c.ripple * (0.35 + audio.bass * 1.3),
      rippleFreq: c.rippleFreq,
      shear: c.shear * (0.35 + audio.treb * 1.5),
      decay: c.decay,
      time: t,
      centerX: 0.5 + Math.sin(t * 0.19) * c.centerAmp,
      centerY: 0.5 + Math.cos(t * 0.23) * c.centerAmp * 0.8,
      hueMat: hueMatrix(c.hueSpeed * dt),
    };

    const out = this.engine.step(this.ink, params, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(out, 0, 0, w, h);
  }

  /** Fresh ink for this generation: the waveform in one of three styles. */
  _drawInk(audio, W, H, t, dt) {
    const g = this.inkCtx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);

    // silence starves the loop: no ink, trails decay to black
    const bright = Math.min(1, 0.15 + audio.level * 2.2) * (0.15 + 0.85 * audio.presence);
    if (bright < 0.03) return;

    const N = 160;
    const wave = audio.wave;
    const step = wave.length / N;
    const v = (i) => (wave[((i * step) | 0) % wave.length] - 128) / 128;
    const hue = this.hue;
    const style = this.cur.style;
    this.wavePhase += dt * (0.3 + audio.mid * 1.2);

    const stroke = (build) => {
      g.shadowColor = `hsla(${hue}, 100%, 60%, ${bright})`;
      g.shadowBlur = 10;
      g.strokeStyle = `hsla(${hue}, 100%, 58%, ${0.85 * bright})`;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.beginPath();
      build();
      g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = `hsla(${(hue + 30) % 360}, 100%, 82%, ${0.9 * bright})`;
      g.lineWidth = 1.1;
      g.stroke();
    };

    if (style === 0) {
      // horizontal wave + dim inverted echo
      const amp = H * 0.24;
      stroke(() => {
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W;
          const y = H / 2 + v(i) * amp;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      });
      g.globalAlpha = 0.3;
      stroke(() => {
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * W;
          const y = H / 2 - v(i) * amp * 0.8;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      });
      g.globalAlpha = 1;
    } else if (style === 1) {
      // circular wave: the scope wrapped into a slowly turning ring
      const r0 = Math.min(W, H) * (0.26 + audio.level * 0.06);
      stroke(() => {
        for (let i = 0; i <= N; i++) {
          const ang = (i / N) * Math.PI * 2 + this.wavePhase;
          const r = r0 + v(i % N) * Math.min(W, H) * 0.14;
          const x = W / 2 + Math.cos(ang) * r;
          const y = H / 2 + Math.sin(ang) * r;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
      });
    } else {
      // two waves crossing at an angle
      for (const dir of [-1, 1]) {
        const ang = dir * (Math.PI / 7) + Math.sin(t * 0.1) * 0.1;
        const cosA = Math.cos(ang);
        const sinA = Math.sin(ang);
        const amp = H * 0.17;
        g.globalAlpha = dir === 1 ? 1 : 0.55;
        stroke(() => {
          for (let i = 0; i < N; i++) {
            const lx = (i / (N - 1) - 0.5) * W * 1.15;
            const ly = v(i) * amp;
            const x = W / 2 + lx * cosA - ly * sinA;
            const y = H / 2 + lx * sinA + ly * cosA;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
        });
      }
      g.globalAlpha = 1;
    }

    // beat splash: bright droplets the warp smears into fireworks
    if (audio.beatPulse > 0.6) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = Math.min(W, H) * (0.18 + Math.random() * 0.24);
        g.fillStyle = `hsla(${(hue + 40 + Math.random() * 60) % 360}, 100%, 72%, ${audio.beatPulse * 0.9})`;
        g.beginPath();
        g.arc(W / 2 + Math.cos(ang) * r, H / 2 + Math.sin(ang) * r, 1.5 + Math.random() * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** No WebGL: plain neon scope. */
  _fallback(ctx, audio, w, h) {
    ctx.fillStyle = 'rgba(2, 2, 8, 0.25)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `hsl(${this.hue}, 100%, 60%)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const wave = audio.wave;
    for (let i = 0; i < wave.length; i += 8) {
      const x = (i / wave.length) * w;
      const y = h / 2 + ((wave[i] - 128) / 128) * h * 0.35;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
