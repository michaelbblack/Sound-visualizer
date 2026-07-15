import { loadGif } from '../lib/gif.js';

/**
 * Two-Step Meme: plays the user-supplied dancing GIF with its playback
 * scrubbed to the detected beat, so the crew steps in time with the music.
 *
 * How the sync works: the GIF loop is assigned a whole (even) number of
 * beats k — chosen so k * beatInterval best matches the GIF's natural
 * duration — then the current frame is picked from (beatCount + beatPhase)/k.
 * Every detected beat advances the loop by exactly 1/k, so footfalls land on
 * the beat even when the tempo drifts. With no recent beats (quiet room) it
 * falls back to natural-speed playback.
 */
export class GifTwoStep {
  constructor(url = 'assets/two-step.gif') {
    this.name = 'Two-Step Meme';
    this.frames = null;
    this.error = null;
    this.beatCount = 0;
    this.sinceBeat = 999;

    loadGif(url)
      .then((gif) => {
        this.gifW = gif.width;
        this.gifH = gif.height;
        this.duration = gif.frames.reduce((a, f) => a + f.delay, 0) / 1000;
        let acc = 0;
        this.frames = gif.frames.map((f) => {
          const canvas = document.createElement('canvas');
          canvas.width = gif.width;
          canvas.height = gif.height;
          canvas.getContext('2d').putImageData(new ImageData(f.rgba, gif.width, gif.height), 0, 0);
          const startFrac = acc / (this.duration * 1000);
          acc += f.delay;
          return { canvas, startFrac };
        });
      })
      .catch((e) => {
        this.error = e.message || String(e);
      });
  }

  /** Even number of beats per GIF loop that best matches its natural speed. */
  _beatsPerLoop(beatInterval) {
    let best = 2;
    let bestErr = Infinity;
    for (const k of [2, 4, 6, 8]) {
      const err = Math.abs(this.duration - k * beatInterval);
      if (err < bestErr) {
        bestErr = err;
        best = k;
      }
    }
    return best;
  }

  _frameAt(frac) {
    const f = ((frac % 1) + 1) % 1;
    // frames are ordered by startFrac; walk back from the end
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].startFrac <= f) return this.frames[i].canvas;
    }
    return this.frames[0].canvas;
  }

  draw({ ctx, audio, w, h, dt, t }) {
    // ---- background: dark club wash + faint spectrum skyline ----
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `hsl(${(t * 18) % 360}, 50%, ${5 + audio.beatPulse * 10}%)`);
    bg.addColorStop(1, '#020108');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    this._drawSpectrumSkyline(ctx, audio, w, h, t);

    if (this.error) {
      ctx.fillStyle = '#ff5c7a';
      ctx.font = '16px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`Could not load GIF: ${this.error}`, w / 2, h / 2);
      return;
    }
    if (!this.frames) {
      ctx.fillStyle = '#889';
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Loading the crew…', w / 2, h / 2);
      return;
    }

    // ---- pick the frame: beat-locked when the music has a pulse ----
    if (audio.beat) {
      this.beatCount++;
      this.sinceBeat = 0;
    }
    this.sinceBeat += dt;

    let frac;
    if (this.sinceBeat < 2.5) {
      const k = this._beatsPerLoop(audio.beatInterval);
      frac = ((this.beatCount % k) + Math.min(1, audio.beatPhase)) / k;
    } else {
      frac = (t % this.duration) / this.duration; // idle: natural speed
    }
    const frame = this._frameAt(frac);

    // ---- layout: fit to ~80% of the viewport, with beat squash & bounce ----
    const fit = Math.min((w * 0.85) / this.gifW, (h * 0.8) / this.gifH);
    const bounce = Math.abs(Math.sin(Math.min(1, audio.beatPhase) * Math.PI));
    const sx = fit * (1 - audio.beatPulse * 0.03);
    const sy = fit * (1 + audio.beatPulse * 0.05);
    const dw = this.gifW * sx;
    const dh = this.gifH * sy;
    const shake = (Math.random() - 0.5) * audio.beatPulse * w * 0.006;
    const x = (w - dw) / 2 + shake;
    const y = (h - dh) / 2 - bounce * h * 0.012 + h * 0.02;

    // Ghost echoes flanking the image on beats — cheap RGB-split feel
    if (audio.beatPulse > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = audio.beatPulse * 0.35;
      const split = audio.beatPulse * w * 0.012;
      ctx.drawImage(frame, x - split, y, dw, dh);
      ctx.drawImage(frame, x + split, y, dw, dh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Glow frame that pumps with the bass
    ctx.shadowColor = `hsla(${(t * 40) % 360}, 100%, 60%, ${0.5 + audio.bass * 0.5})`;
    ctx.shadowBlur = 20 + audio.beatPulse * 50;
    ctx.drawImage(frame, x, y, dw, dh);
    ctx.shadowBlur = 0;

    // Beat vignette flash
    if (audio.beatPulse > 0.01) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, `hsla(${(t * 60) % 360}, 100%, 55%, ${audio.beatPulse * 0.25})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  _drawSpectrumSkyline(ctx, audio, w, h, t) {
    const bars = 48;
    const usable = Math.floor(audio.freq.length * 0.6);
    const barW = w / bars;
    for (let i = 0; i < bars; i++) {
      const bin = Math.floor(Math.pow(i / bars, 1.5) * usable);
      const v = Math.min(1, audio.freq[bin] / 255);
      const bh = v * h * 0.35;
      ctx.fillStyle = `hsla(${(i * 8 + t * 30) % 360}, 80%, 50%, 0.28)`;
      ctx.fillRect(i * barW + 1, h - bh, barW - 2, bh);
    }
  }
}
