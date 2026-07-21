import { WarpEngine, hueMatrix } from '../lib/warpfx.js';

/**
 * Spectrum Bars (Classic) — the Winamp LED analyzer, full width, over a
 * MilkDrop/Geiss per-pixel feedback aura.
 *
 * Two layers:
 *   1. A WebGL warp-feedback backdrop: the spectrum is drawn as glowing ink
 *      and advected upward + outward every frame, so the bars trail off into
 *      flowing aurora/flames that keep evolving (real fluid, not stamped
 *      copies). Hue cycles; bass drives the bloom, treble the shear.
 *   2. Crisp green->red segmented LED bars with falling peak caps drawn on
 *      top, razor sharp, so the classic analyzer stays perfectly readable.
 *
 * Layout is CENTER-MIRRORED: bass in the middle mirroring out to treble at
 * both edges, so the display fills the full width edge to edge instead of
 * piling the loud lows on the left and leaving the quiet highs' side dark.
 * Falls back to plain full-width mirrored bars without WebGL.
 */
export class SpectrumBars {
  constructor() {
    this.name = 'Spectrum Bars (Classic)';
    this.half = 56;                 // frequency steps; total bars = 2*half
    this.peaks = new Float32Array(this.half * 2);
    this.engine = null;
    this.ink = null;
    this.hue = 150;
  }

  /** Log-mapped band values, bass..treble, length = half. */
  _values(audio) {
    const half = this.half;
    const usable = Math.floor(audio.freq.length * 0.62);
    const vals = new Float32Array(half);
    for (let j = 0; j < half; j++) {
      const from = Math.floor(Math.pow(j / half, 1.7) * usable);
      const to = Math.max(from + 1, Math.floor(Math.pow((j + 1) / half, 1.7) * usable));
      let sum = 0;
      for (let k = from; k < to; k++) sum += audio.freq[k];
      vals[j] = Math.min(1, sum / (to - from) / 255);
    }
    return vals;
  }

  // mirror index -> frequency step: 0 (bass) at center, half-1 (treble) at edges
  _bandFor(i, total) {
    return Math.min(this.half - 1, Math.floor(Math.abs(i - (total - 1) / 2)));
  }

  draw({ ctx, audio, w, h, dt, t }) {
    this.hue = (this.hue + dt * 12 + audio.beatPulse * dt * 60) % 360;
    const vals = this._values(audio);

    if (!this.engine) this.engine = new WarpEngine();
    if (this.engine.ok) {
      this.engine._resize(w, h);
      const W = this.engine.canvas.width;
      const H = this.engine.canvas.height;
      if (!this.ink || this.ink.width !== W || this.ink.height !== H) {
        this.ink = document.createElement('canvas');
        this.ink.width = W;
        this.ink.height = H;
        this.inkCtx = this.ink.getContext('2d');
      }
      this._drawInk(audio, vals, W, H);

      const params = {
        zoom: 1.006 + audio.bass * 0.010 + audio.beatPulse * 0.006,
        rot: 0.0016 * (1 + audio.mid * 1.4) * (Math.sin(t * 0.05) > 0 ? 1 : -1),
        swirl: 0.14 * (0.4 + audio.mid * 1.5),
        swirlFreq: 7,
        ripple: 0.35 * (0.3 + audio.bass * 1.3),
        rippleFreq: 9,
        shear: 0.5 * (0.3 + audio.treb * 1.4),
        decay: 0.948,
        time: t,
        centerX: 0.5,
        centerY: 0.5,
        advectY: -(0.006 + audio.bass * 0.012), // negative = flow up the screen
        hueMat: hueMatrix(0.45 * dt),
      };
      const out = this.engine.step(this.ink, params, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(out, 0, 0, w, h);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, w, h);
    }

    this._drawBars(ctx, vals, w, h, dt); // crisp LED analyzer on top
  }

  /** Glowing mirrored spectrum injected into the warp loop. */
  _drawInk(audio, vals, W, H) {
    const g = this.inkCtx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const bright = Math.min(0.8, 0.14 + audio.level * 1.2) * (0.12 + 0.88 * audio.presence);
    if (bright < 0.03) return;

    const total = this.half * 2;
    const barW = W / total;
    const baseline = H * 0.9;
    const maxH = H * 0.82;
    g.shadowBlur = 8;
    for (let i = 0; i < total; i++) {
      const v = vals[this._bandFor(i, total)];
      if (v < 0.02) continue;
      const bh = v * maxH;
      const hue = (this.hue + (1 - v) * 60) % 360;
      g.shadowColor = `hsla(${hue}, 100%, 60%, ${bright})`;
      g.fillStyle = `hsla(${hue}, 100%, ${52 + v * 20}%, ${bright})`;
      g.fillRect(i * barW + barW * 0.12, baseline - bh, barW * 0.76, bh);
    }
    g.shadowBlur = 0;
  }

  /** Crisp segmented LED bars + falling peak caps, full width, mirrored. */
  _drawBars(ctx, vals, w, h, dt) {
    const total = this.half * 2;
    const gap = Math.max(0.5, w * 0.0008);
    const barW = w / total - gap;
    const baseline = h * 0.94;
    const maxBarH = h * 0.82;
    const segH = Math.max(3, h * 0.013);

    for (let i = 0; i < total; i++) {
      const v = vals[this._bandFor(i, total)];
      const barH = v * maxBarH;
      const x = i * (w / total) + gap / 2;

      const segs = Math.floor(barH / segH);
      for (let s = 0; s < segs; s++) {
        const frac = (s * segH) / maxBarH;
        const hue = 120 - frac * 130; // green -> yellow -> red
        ctx.fillStyle = `hsl(${Math.max(-10, hue)}, 100%, ${48 + frac * 16}%)`;
        ctx.fillRect(x, baseline - (s + 1) * segH + 1, barW, segH - 2);
      }
      // faint reflection under the baseline for gloss
      if (segs > 0) {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = `hsl(110, 100%, 55%)`;
        ctx.fillRect(x, baseline + 2, barW, Math.min(barH, h * 0.05));
        ctx.globalAlpha = 1;
      }

      if (barH > this.peaks[i]) this.peaks[i] = barH;
      else this.peaks[i] = Math.max(0, this.peaks[i] - dt * h * 0.28);
      if (this.peaks[i] > 2) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, baseline - this.peaks[i] - 3, barW, 3);
      }
    }
  }
}
