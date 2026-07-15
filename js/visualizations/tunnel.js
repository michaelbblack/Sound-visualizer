/** Starfield warp: fly through stars whose speed is driven by the music; beats fire hyperspace streaks. */
export class StarfieldWarp {
  constructor() {
    this.name = 'Starfield Warp';
    this.stars = [];
    for (let i = 0; i < 500; i++) this.stars.push(this._newStar(true));
  }

  _newStar(anyDepth) {
    return {
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: anyDepth ? Math.random() : 1,
      hue: 180 + Math.random() * 120,
    };
  }

  draw({ ctx, audio, w, h, dt }) {
    ctx.fillStyle = `rgba(0, 0, ${Math.floor(8 + audio.bass * 25)}, 0.4)`;
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const speed = 0.12 + audio.level * 1.2 + audio.beatPulse * 2.2;
    const focal = Math.min(w, h) * 0.9;

    for (const s of this.stars) {
      const zPrev = s.z;
      s.z -= speed * dt * 0.35;
      if (s.z <= 0.02) {
        Object.assign(s, this._newStar(false));
        continue;
      }
      const px = cx + (s.x / s.z) * focal * 0.5;
      const py = cy + (s.y / s.z) * focal * 0.5;
      const pxPrev = cx + (s.x / zPrev) * focal * 0.5;
      const pyPrev = cy + (s.y / zPrev) * focal * 0.5;

      const bright = Math.min(1, (1 - s.z) * 1.4);
      const size = (1 - s.z) * (2 + audio.beatPulse * 2);

      // At low speed draw dots, at high speed draw streaks
      ctx.strokeStyle = `hsla(${s.hue}, ${40 + audio.treb * 60}%, ${55 + bright * 35}%, ${bright})`;
      ctx.lineWidth = Math.max(0.5, size);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pxPrev, pyPrev);
      ctx.lineTo(px, py);
      ctx.stroke();
    }

    // Vignette pulse on beats
    if (audio.beatPulse > 0.01) {
      const grad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.2, cx, cy, Math.max(w, h) * 0.75);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(1, `hsla(${200 + audio.bass * 100}, 100%, 55%, ${audio.beatPulse * 0.22})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }
}
