import { loadGif } from '../lib/gif.js';

/**
 * Meme Cycle: one visualizer that rotates through a playlist of memes
 * (assets/memes/playlist.json), keeping everything locked to the beat.
 *
 * - Each GIF is decoded to independent frames and SCRUBBED to the beat
 *   grid: each loop is pinned to an even number of beats k (matched to the
 *   GIF's natural speed and the live tempo estimate), each detected beat
 *   advances the loop by exactly 1/k, and when beat events lapse but the
 *   tempo lock holds, playback free-runs at the estimated tempo instead of
 *   stuttering. When the music stops, the meme freezes until it returns.
 * - After a meme has held the floor for its `beats` count, the next beat
 *   hard-cuts to the next meme in the playlist with a flash — so cuts land
 *   on the rhythm too.
 * - Animated GIFs only: files that decode to a single frame (static images,
 *   thumbnails) are skipped with a console warning rather than shown frozen.
 *
 * Add your own: drop an animated GIF into assets/memes/ and list it in
 * playlist.json.
 */
export class MemeCycle {
  constructor() {
    this.name = 'Meme Cycle';
    this.memes = null;
    this.error = null;
    this.idx = 0;
    this.beatPos = 0; // beats elapsed within the current meme's dance
    this.k = 4;       // beats per GIF loop for the current meme
    this.lastFrac = 0;
    this.sinceBeat = 999;
    this.beatsOnMeme = 0;
    this.switchFlash = 0;
    this._load();
  }

  async _load() {
    try {
      let entries;
      try {
        const res = await fetch('assets/memes/playlist.json');
        if (!res.ok) throw new Error(String(res.status));
        entries = await res.json();
      } catch {
        entries = [{ file: 'two-step.gif', beats: 32 }]; // playlist missing: signature meme only
      }
      const results = await Promise.allSettled(entries.map((e) => this._loadMeme(e)));
      const memes = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) console.warn('some memes failed to load:', failed.map((f) => f.reason?.message));
      if (!memes.length) throw new Error('no memes could be loaded');
      this.memes = memes;
    } catch (e) {
      this.error = e.message || String(e);
    }
  }

  async _loadMeme(entry) {
    const url = 'assets/memes/' + entry.file;
    const gif = await loadGif(url);
    if (gif.frames.length < 2) {
      throw new Error(`${entry.file} has no animation (single frame) — skipped`);
    }
    const durationMs = gif.frames.reduce((a, f) => a + f.delay, 0);
    let acc = 0;
    const frames = gif.frames.map((f) => {
      const canvas = document.createElement('canvas');
      canvas.width = gif.width;
      canvas.height = gif.height;
      canvas.getContext('2d').putImageData(new ImageData(f.rgba, gif.width, gif.height), 0, 0);
      const startFrac = acc / durationMs;
      acc += f.delay;
      return { canvas, startFrac };
    });
    return { frames, w: gif.width, h: gif.height, duration: durationMs / 1000, beats: entry.beats || 32 };
  }

  /** Even number of beats per GIF loop that best matches its natural speed. */
  _beatsPerLoop(meme, beatInterval) {
    let best = 2;
    let bestErr = Infinity;
    for (const k of [2, 4, 6, 8]) {
      const err = Math.abs(meme.duration - k * beatInterval);
      if (err < bestErr) {
        bestErr = err;
        best = k;
      }
    }
    return best;
  }

  _frameAt(meme, frac) {
    const f = ((frac % 1) + 1) % 1;
    for (let i = meme.frames.length - 1; i >= 0; i--) {
      if (meme.frames[i].startFrac <= f) return meme.frames[i].canvas;
    }
    return meme.frames[0].canvas;
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
      ctx.fillText(`Could not load memes: ${this.error}`, w / 2, h / 2);
      return;
    }
    if (!this.memes) {
      ctx.fillStyle = '#889';
      ctx.font = '18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Loading the crew…', w / 2, h / 2);
      return;
    }

    // ---- beat bookkeeping: advance the dance, count toward the next cut ----
    if (audio.beat) {
      if (this.sinceBeat > 1.2) {
        // resuming after a gap: re-base so the dance continues from the
        // exact frame it free-ran/froze at (a beat means phase ~ 0)
        this.beatPos = this.lastFrac * this.k;
      } else {
        this.beatPos++;
      }
      this.sinceBeat = 0;
      this.beatsOnMeme++;
      if (this.memes.length > 1 && this.beatsOnMeme >= this.memes[this.idx].beats) {
        this.idx = (this.idx + 1) % this.memes.length;
        this.beatsOnMeme = 0;
        this.beatPos = 0;
        this.lastFrac = 0;
        this.switchFlash = 1;
      }
    }
    this.sinceBeat += dt;

    const meme = this.memes[this.idx];
    const phase = Math.min(1, audio.beatPhase);

    // ---- playback position; three states, never stutters ----
    const k = this._beatsPerLoop(meme, audio.beatInterval);
    if (k !== this.k) {
      // tempo shifted enough to change beats-per-loop: re-base the beat
      // position so the visible frame doesn't jump
      this.beatPos = this.lastFrac * k - phase;
      this.k = k;
    }
    if (this.sinceBeat < 1.2) {
      this.lastFrac = (((((this.beatPos % k) + k) % k) + phase) / k) % 1;
    } else if (audio.musicActive && audio.tempoLocked) {
      // no beat event lately but the tempo lock is holding: keep dancing
      this.lastFrac = (this.lastFrac + dt / (k * audio.beatInterval)) % 1;
    }
    // else: silence — lastFrac stays put, paused mid-step
    const frame = this._frameAt(meme, this.lastFrac);

    // ---- layout: fit to ~80% of the viewport, with beat squash & bounce ----
    const fit = Math.min((w * 0.85) / meme.w, (h * 0.8) / meme.h);
    const bounce = Math.abs(Math.sin(phase * Math.PI));
    const sx = fit * (1 - audio.beatPulse * 0.03);
    const sy = fit * (1 + audio.beatPulse * 0.05);
    const dw = meme.w * sx;
    const dh = meme.h * sy;
    const shake = (Math.random() - 0.5) * audio.beatPulse * w * 0.006;
    const cx = w / 2 + shake;
    const cy = h / 2 - bounce * h * 0.012 + h * 0.02;

    ctx.save();
    ctx.translate(cx, cy);

    // Ghost echoes flanking the image on beats — cheap RGB-split feel
    if (audio.beatPulse > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = audio.beatPulse * 0.35;
      const split = audio.beatPulse * w * 0.012;
      ctx.drawImage(frame, -dw / 2 - split, -dh / 2, dw, dh);
      ctx.drawImage(frame, -dw / 2 + split, -dh / 2, dw, dh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // Glow frame that pumps with the bass
    ctx.shadowColor = `hsla(${(t * 40) % 360}, 100%, 60%, ${0.5 + audio.bass * 0.5})`;
    ctx.shadowBlur = 20 + audio.beatPulse * 50;
    ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Meme-switch flash: the cut lands on a beat and announces itself
    if (this.switchFlash > 0.01) {
      ctx.fillStyle = `hsla(${(t * 90) % 360}, 100%, 80%, ${this.switchFlash * 0.3})`;
      ctx.fillRect(0, 0, w, h);
      this.switchFlash = Math.max(0, this.switchFlash - dt * 3);
    }

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
