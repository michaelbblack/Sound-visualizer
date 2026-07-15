/** Beat fireworks: particles erupt from the center on every detected beat. */
export class BeatParticles {
  constructor() {
    this.name = 'Beat Fireworks';
    this.particles = [];
  }

  _spawnBurst(w, h, intensity, hueBase) {
    const count = Math.floor(60 + intensity * 140);
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = (0.15 + Math.random() * 0.5) * Math.min(w, h) * (0.6 + intensity);
      this.particles.push({
        x: w / 2,
        y: h / 2,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 1,
        decay: 0.4 + Math.random() * 0.6,
        size: 1.5 + Math.random() * 3.5,
        hue: hueBase + Math.random() * 60,
      });
    }
  }

  draw({ ctx, audio, w, h, dt, t }) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, w, h);

    if (audio.beat) this._spawnBurst(w, h, audio.beatPulse * audio.level * 2, (t * 50) % 360);

    // Constant gentle sparkle stream so quiet passages aren't empty
    if (audio.level > 0.03 && this.particles.length < 2000 && Math.random() < audio.level * 2) {
      this._spawnBurst(w, h, audio.level * 0.15, (t * 50 + 180) % 360);
    }

    ctx.globalCompositeOperation = 'lighter';
    const swirl = audio.mid * 3;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      // Slight swirl force driven by mids
      const dx = p.x - w / 2;
      const dy = p.y - h / 2;
      p.vx += -dy * swirl * dt * 0.3;
      p.vy += dx * swirl * dt * 0.3;
      p.vx *= 1 - 0.6 * dt;
      p.vy *= 1 - 0.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      ctx.fillStyle = `hsla(${p.hue}, 100%, ${50 + p.life * 30}%, ${p.life * 0.9})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Central glow that breathes with overall level
    const r = Math.min(w, h) * (0.04 + audio.level * 0.12 + audio.beatPulse * 0.05);
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r * 3);
    grad.addColorStop(0, `hsla(${(t * 50) % 360}, 100%, 70%, ${0.25 + audio.beatPulse * 0.4})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(w / 2 - r * 3, h / 2 - r * 3, r * 6, r * 6);
  }
}
