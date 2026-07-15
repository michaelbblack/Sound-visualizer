/** Radial spectrum: frequency bars fan out from a pulsing core ring. */
export class RadialBurst {
  constructor() {
    this.name = 'Radial Burst';
    this.rot = 0;
  }

  draw({ ctx, audio, w, h, dt, t }) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const baseR = Math.min(w, h) * (0.16 + audio.bass * 0.08 + audio.beatPulse * 0.03);
    const spikes = 180;
    const usable = Math.floor(audio.freq.length * 0.6);

    this.rot += dt * (0.15 + audio.mid * 0.8);

    for (let i = 0; i < spikes; i++) {
      const bin = Math.floor(Math.pow(i / spikes, 1.4) * usable);
      const v = Math.min(1, audio.freq[bin] / 255);
      const ang = (i / spikes) * Math.PI * 2 + this.rot;
      const len = v * Math.min(w, h) * 0.32;

      const x0 = cx + Math.cos(ang) * baseR;
      const y0 = cy + Math.sin(ang) * baseR;
      const x1 = cx + Math.cos(ang) * (baseR + len);
      const y1 = cy + Math.sin(ang) * (baseR + len);

      const hue = (i / spikes) * 360 + t * 20;
      ctx.strokeStyle = `hsla(${hue}, 100%, ${50 + v * 30}%, ${0.4 + v * 0.6})`;
      ctx.lineWidth = 2 + v * 4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Core ring rendered from the waveform
    ctx.strokeStyle = `hsla(${t * 40 % 360}, 100%, 70%, 0.9)`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 12 + audio.beatPulse * 30;
    ctx.beginPath();
    const wl = audio.wave.length;
    for (let i = 0; i <= wl; i += 8) {
      const idx = i % wl;
      const ang = (i / wl) * Math.PI * 2 + this.rot * 0.5;
      const r = baseR * (1 + ((audio.wave[idx] - 128) / 128) * 0.35);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
