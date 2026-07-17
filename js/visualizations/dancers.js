/**
 * Silhouette Rave: a jet-black crowd of dancers against blazing color walls —
 * the classic silhouette-ad look. Lasers sweep in tempo, the walls pump with
 * the beat phase, downbeats strobe, and every dancer bounces / fist-pumps /
 * jumps on the grid. Silhouettes carry all the motion with none of the
 * geometry showing, so the crowd reads as style, not budget.
 */
export class SilhouetteRave {
  constructor() {
    this.name = 'Silhouette Rave';
    this.beatCount = 0;
    this.confetti = [];
    this.dancers = [];
    const rows = [
      { n: 8, scale: 0.52, y: 0.78, alpha: 0.72 },
      { n: 6, scale: 0.74, y: 0.88, alpha: 0.88 },
      { n: 4, scale: 1.0, y: 0.995, alpha: 1 },
    ];
    rows.forEach((row, ri) => {
      for (let i = 0; i < row.n; i++) {
        this.dancers.push({
          rx: (i + 0.5) / row.n + (Math.random() - 0.5) * 0.05,
          scale: row.scale * (0.92 + Math.random() * 0.16),
          y: row.y,
          alpha: row.alpha,
          row: ri,
          style: Math.floor(Math.random() * 3), // 0 fist-pump, 1 arms-wave, 2 jumper
          side: Math.random() < 0.5 ? -1 : 1,
          phaseOff: Math.random() * 0.12,
          wob: Math.random() * Math.PI * 2,
        });
      }
    });
  }

  draw({ ctx, audio, w, h, dt, t }) {
    if (audio.beat) this.beatCount++;
    const phase = Math.min(1, audio.beatPhase);
    const swell = Math.pow(1 - phase, 2); // 1 at the beat, relaxing toward 0
    const downbeat = this.beatCount % 4 === 1;

    // ---- blazing wall: hue drifts, brightness pumps with the beat ----
    const hue = (t * 10 + this.beatCount * 9) % 360;
    const lTop = 30 + swell * 22 + audio.level * 18;
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, `hsl(${hue}, 95%, ${Math.min(68, lTop)}%)`);
    bg.addColorStop(0.75, `hsl(${(hue + 40) % 360}, 90%, ${Math.min(52, lTop * 0.62)}%)`);
    bg.addColorStop(1, `hsl(${(hue + 70) % 360}, 85%, 12%)`);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // stage glow behind the crowd
    const glow = ctx.createRadialGradient(w / 2, h * 0.8, 0, w / 2, h * 0.8, Math.max(w, h) * 0.65);
    glow.addColorStop(0, `hsla(${(hue + 180) % 360}, 100%, ${60 + swell * 25}%, ${0.3 + audio.bass * 0.3})`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    this._drawLasers(ctx, audio, w, h, t, hue, swell);
    this._drawConfetti(ctx, audio, w, h, dt, hue);

    // downbeat strobe
    if (downbeat && swell > 0.55) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(swell - 0.55) * 0.7})`;
      ctx.fillRect(0, 0, w, h);
    }

    // ---- the crowd ----
    for (const d of this.dancers) {
      this._drawDancer(ctx, d, w, h, phase, t, audio);
    }

    // floor shadow band grounds the front row
    const floor = ctx.createLinearGradient(0, h * 0.94, 0, h);
    floor.addColorStop(0, 'rgba(0,0,0,0)');
    floor.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.94, w, h * 0.06);
  }

  _drawLasers(ctx, audio, w, h, t, hue, swell) {
    ctx.globalCompositeOperation = 'lighter';
    const beams = 6;
    for (let i = 0; i < beams; i++) {
      const originX = (i % 2 === 0 ? 0.18 : 0.82) * w;
      // sweep is tempo-locked: one full wag every 4 beats, offset per beam
      const wag = Math.sin(((t / (audio.beatInterval * 4)) + i / beams) * Math.PI * 2);
      const ang = Math.PI / 2 + wag * 0.9 + (i % 2 === 0 ? 0.25 : -0.25);
      const len = Math.max(w, h) * 1.3;
      const bx = originX + Math.cos(ang) * len;
      const by = Math.sin(ang) * len;
      const beamHue = (hue + 120 + i * 35) % 360;
      const grad = ctx.createLinearGradient(originX, 0, bx, by);
      grad.addColorStop(0, `hsla(${beamHue}, 100%, 70%, ${0.55 + swell * 0.4})`);
      grad.addColorStop(0.7, `hsla(${beamHue}, 100%, 60%, ${0.15 + swell * 0.15})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(originX, -h * 0.02);
      ctx.lineTo(bx + w * 0.045, by);
      ctx.lineTo(bx - w * 0.045, by);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Confetti bursts from the ceiling on every beat, heavier on downbeats. */
  _drawConfetti(ctx, audio, w, h, dt, hue) {
    if (audio.beat && this.confetti.length < 500) {
      const burst = this.beatCount % 4 === 1 ? 34 : 12;
      for (let i = 0; i < burst; i++) {
        this.confetti.push({
          x: Math.random() * w,
          y: -10 - Math.random() * h * 0.05,
          vy: (0.12 + Math.random() * 0.2) * h,
          sway: Math.random() * Math.PI * 2,
          size: 4 + Math.random() * 6,
          hue: (hue + 100 + Math.random() * 160) % 360,
          spin: (Math.random() - 0.5) * 8,
          rot: Math.random() * Math.PI,
        });
      }
    }
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.y += c.vy * dt;
      c.x += Math.sin(c.sway += dt * 3) * w * 0.0006;
      c.rot += c.spin * dt;
      if (c.y > h) {
        this.confetti.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = `hsla(${c.hue}, 95%, 65%, 0.9)`;
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
      ctx.restore();
    }
  }

  _drawDancer(ctx, d, w, h, phase, t, audio) {
    const s = Math.min(w, h) * 0.17 * d.scale;
    const p = (phase + d.phaseOff) % 1;
    const bounce = Math.abs(Math.sin(p * Math.PI));
    const swell = Math.pow(1 - p, 2);
    const flip = (this.beatCount + d.row) % 2 === 0 ? d.side : -d.side;

    const jump = d.style === 2 ? swell * s * 0.45 : 0;
    const footY = d.y * h;
    const hipX = d.rx * w + Math.sin(t * 0.4 + d.wob) * s * 0.05;
    const hipY = footY - s * 0.95 - bounce * s * 0.16 - jump;
    const lean = flip * (0.1 + swell * 0.1);
    const shX = hipX + Math.sin(lean) * s * 0.5;
    const shY = hipY - Math.cos(lean) * s * 0.55;

    ctx.strokeStyle = `rgba(6, 4, 12, ${d.alpha})`;
    ctx.fillStyle = `rgba(6, 4, 12, ${d.alpha})`;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.17;

    const seg = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    // legs: planted wide when grounded, tucked when jumping
    const spread = s * (0.26 - (jump > 0 ? swell * 0.1 : 0));
    for (const side of [-1, 1]) {
      const kx = hipX + side * spread * 0.6 + flip * s * 0.05;
      const ky = (hipY + footY) / 2 - jump * 0.4;
      seg(hipX, hipY, kx, ky);
      seg(kx, ky, hipX + side * spread, footY - jump);
    }

    // torso + head (head nods into the beat)
    seg(hipX, hipY, shX, shY);
    const headR = s * 0.17;
    ctx.beginPath();
    ctx.arc(shX + flip * swell * headR * 0.5, shY - headR * 1.15 - swell * headR * 0.2, headR, 0, Math.PI * 2);
    ctx.fill();

    // arms by style
    if (d.style === 0) {
      // fist pump: one arm punches the sky on the beat, other stays cocked
      const punch = swell;
      const px = shX + flip * s * 0.35;
      const py = shY - s * (0.35 + punch * 0.5);
      seg(shX, shY, shX + flip * s * 0.4, shY - s * 0.1);
      seg(shX + flip * s * 0.4, shY - s * 0.1, px, py);
      seg(shX, shY, shX - flip * s * 0.35, shY + s * 0.15);
      seg(shX - flip * s * 0.35, shY + s * 0.15, shX - flip * s * 0.45, shY - s * 0.15);
    } else if (d.style === 1) {
      // both arms high, hands waving side to side
      for (const side of [-1, 1]) {
        const wave = Math.sin(t * 3 + d.wob + side) * s * 0.18;
        const ex = shX + side * s * 0.42;
        const ey = shY - s * 0.25;
        seg(shX, shY, ex, ey);
        seg(ex, ey, ex + wave + side * s * 0.1, ey - s * (0.4 + swell * 0.15));
      }
    } else {
      // jumper: arms in a V, wider at the top of the jump
      for (const side of [-1, 1]) {
        const vSpread = 0.35 + swell * 0.2;
        seg(shX, shY, shX + side * s * vSpread, shY - s * 0.3);
        seg(shX + side * s * vSpread, shY - s * 0.3, shX + side * s * (vSpread + 0.15), shY - s * (0.62 + swell * 0.1));
      }
    }
  }
}
