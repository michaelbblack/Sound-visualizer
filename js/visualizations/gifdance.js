import { loadGif } from '../lib/gif.js';

/**
 * Two-Step Meme: plays the user-supplied dancing GIF with its playback
 * scrubbed to the detected beat, so the crew steps in time with the music.
 *
 * How the sync works: the GIF loop is assigned a whole (even) number of
 * beats k — chosen so k * beatInterval best matches the GIF's natural
 * duration, re-evaluated continuously against the tempo estimator — then the
 * current frame is picked from (beatPos + beatPhase)/k. Every detected beat
 * advances the loop by exactly 1/k, so footfalls land on the beat even as
 * tempo changes (when k switches, playback position is re-based so there's
 * no visual jump). When the beats stop, the crew freezes mid-step until the
 * music comes back.
 */
export class GifTwoStep {
  constructor(url = 'assets/two-step.gif') {
    this.name = 'Two-Step Meme';
    this.frames = null;
    this.error = null;
    this.beatPos = 0; // beats elapsed within the dance (float-rebased on k changes)
    this.k = 4;       // beats per GIF loop
    this.lastFrac = 0;
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

    // ---- pick the frame; three states so the dance never stutters ----
    // 1. fresh beats     -> scrub locked to the beat grid
    // 2. music, no beats -> free-run at the estimated tempo (a missed beat or
    //                       a momentary tempo-lock loss must NOT stop the dance)
    // 3. silence         -> freeze mid-step until the music returns
    if (audio.beat) {
      if (this.sinceBeat > 1.2) {
        // resuming after a gap: re-base so the dance continues from the
        // exact frame it free-ran/froze at (a beat means phase ~ 0)
        this.beatPos = this.lastFrac * this.k;
      } else {
        this.beatPos++;
      }
      this.sinceBeat = 0;
    }
    this.sinceBeat += dt;

    const k = this._beatsPerLoop(audio.beatInterval);
    if (k !== this.k) {
      // tempo shifted enough to change beats-per-loop: re-base the beat
      // position so the visible frame doesn't jump
      this.beatPos = this.lastFrac * k - Math.min(1, audio.beatPhase);
      this.k = k;
    }

    if (this.sinceBeat < 1.2) {
      const phase = Math.min(1, audio.beatPhase);
      this.lastFrac = (((((this.beatPos % k) + k) % k) + phase) / k) % 1;
    } else if (audio.musicActive && audio.tempoLocked) {
      // no beat event lately but the tempo lock is holding: keep dancing at
      // the estimated tempo rather than stuttering to a halt
      this.lastFrac = (this.lastFrac + dt / (k * audio.beatInterval)) % 1;
    }
    // else: silence — lastFrac stays put, paused mid-step
    const frame = this._frameAt(this.lastFrac);

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
