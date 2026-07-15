/** Neon oscilloscope: the raw waveform as a glowing trace, with a ghost trail. */
export class Oscilloscope {
  constructor() {
    this.name = 'Oscilloscope';
    this.hue = 160;
  }

  draw({ ctx, audio, w, h, dt }) {
    ctx.fillStyle = 'rgba(0, 0, 5, 0.18)';
    ctx.fillRect(0, 0, w, h);

    this.hue = (this.hue + dt * 12 + audio.beatPulse * dt * 120) % 360;
    const amp = h * 0.35 * Math.min(2.5, 0.6 + audio.sensitivity);
    const mid = h / 2;
    const wave = audio.wave;

    // Faint center grid line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    const drawTrace = (width, alpha, blur) => {
      ctx.strokeStyle = `hsla(${this.hue}, 100%, 60%, ${alpha})`;
      ctx.lineWidth = width;
      ctx.shadowColor = `hsl(${this.hue}, 100%, 55%)`;
      ctx.shadowBlur = blur;
      ctx.beginPath();
      for (let i = 0; i < wave.length; i++) {
        const x = (i / (wave.length - 1)) * w;
        const y = mid + ((wave[i] - 128) / 128) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    drawTrace(6 + audio.beatPulse * 8, 0.25, 24); // glow pass
    drawTrace(2, 0.95, 8);                        // core pass
  }
}
