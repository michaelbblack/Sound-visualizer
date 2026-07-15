/**
 * Milkdrop-style feedback tunnel: each frame the previous frame is redrawn
 * slightly zoomed and rotated, then a fresh waveform ring is painted on top.
 * The recursion produces the classic flowing psychedelic trails.
 */
export class PsychedelicFeedback {
  constructor() {
    this.name = 'Psychedelic Feedback';
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d');
    this.hue = 0;
    this.spin = 0.004;
  }

  resize(w, h) {
    this.buffer.width = w;
    this.buffer.height = h;
  }

  draw({ ctx, audio, w, h, dt, t }) {
    if (this.buffer.width !== w || this.buffer.height !== h) this.resize(w, h);
    const b = this.bctx;

    // Feedback pass: copy last frame into itself, zoomed + rotated.
    // The zoom breathes with the beat PHASE, so the tunnel pumps at the
    // actual tempo — surging on each beat and relaxing until the next.
    const pump = Math.pow(1 - Math.min(1, audio.beatPhase), 2);
    const zoom = 1.010 + pump * 0.028 + audio.bass * 0.008;
    if (audio.beat && Math.random() < 0.25) this.spin = -this.spin; // occasional direction flip
    const rot = this.spin * (1 + audio.mid * 3);

    b.save();
    b.globalAlpha = 0.965; // slow fade keeps trails from saturating
    b.translate(w / 2, h / 2);
    b.rotate(rot);
    b.scale(zoom, zoom);
    b.drawImage(this.buffer, -w / 2, -h / 2);
    b.restore();

    // Dim slightly so it never blows out to white
    b.fillStyle = 'rgba(0,0,0,0.045)';
    b.fillRect(0, 0, w, h);

    // Fresh ink: waveform drawn as a ring
    this.hue = (this.hue + dt * 30 + audio.beatPulse * 2) % 360;
    const cx = w / 2 + Math.cos(t * 0.7) * w * 0.06;
    const cy = h / 2 + Math.sin(t * 0.9) * h * 0.06;
    const baseR = Math.min(w, h) * (0.14 + audio.level * 0.18);

    b.strokeStyle = `hsla(${this.hue}, 100%, 60%, 0.9)`;
    b.lineWidth = 2.5 + audio.beatPulse * 4;
    b.shadowColor = `hsl(${this.hue}, 100%, 60%)`;
    b.shadowBlur = 15;
    b.beginPath();
    const wl = audio.wave.length;
    for (let i = 0; i <= wl; i += 6) {
      const ang = (i / wl) * Math.PI * 2 + t * 0.4;
      const r = baseR * (1 + ((audio.wave[i % wl] - 128) / 128) * 0.6);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    b.closePath();
    b.stroke();
    b.shadowBlur = 0;

    ctx.drawImage(this.buffer, 0, 0);
  }
}
