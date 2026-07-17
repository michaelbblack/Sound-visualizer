/**
 * Silhouette Rave: a packed concert crowd, waist-up against the stage light —
 * heads, shoulders and raised arms over a dark crowd mass, with glowing
 * phones held up, a DJ on a riser, layered soft laser beams, haze, confetti,
 * rim light, film grain and a slowly breathing camera. Everything moves on
 * the beat grid.
 *
 * Rendering notes (what sells it):
 * - nobody below the waist: figures rise out of wavy crowd-mass bands, so the
 *   hardest anatomy to fake is never drawn
 * - volumetric bodies: tapered torsos and two-width arms, varied head shapes
 * - rim light: each figure is drawn twice — a bright pass offset toward the
 *   stage glow, then the dark silhouette on top
 * - beams are three strokes (halo/mid/core) with along-beam gradients, not
 *   flat triangles; the wall glow carries god rays
 * - atmospheric perspective: back rows are lighter and hazier than the front
 */
export class SilhouetteRave {
  constructor() {
    this.name = 'Silhouette Rave';
    this.beatCount = 0;
    this.confetti = [];

    // ---- build the crowd: three depth rows, waist-up figures ----
    this.rows = [
      { y: 0.66, s: 0.42, light: 13, n: 12, massAmp: 0.012 },
      { y: 0.78, s: 0.62, light: 8, n: 9, massAmp: 0.016 },
      { y: 0.94, s: 0.92, light: 3.5, n: 6, massAmp: 0.022 },
    ].map((row, ri) => {
      const people = [];
      for (let i = 0; i < row.n; i++) {
        people.push({
          rx: (i + 0.5) / row.n + (Math.random() - 0.5) * 0.055,
          s: row.s * (0.9 + Math.random() * 0.2),
          bobOff: Math.random(),
          swayOff: Math.random() * Math.PI * 2,
          side: Math.random() < 0.5 ? -1 : 1,
          style: ['pump', 'phone', 'wave', 'pump', 'bob'][Math.floor(Math.random() * 5)],
          headType: Math.floor(Math.random() * 4), // 0 plain 1 cap 2 ponytail 3 fluffy
        });
      }
      // implied extra heads poking above the crowd mass
      const bumps = [];
      for (let i = 0; i < row.n * 2; i++) {
        bumps.push({ rx: Math.random(), r: row.s * (0.05 + Math.random() * 0.035), off: Math.random() });
      }
      return { ...row, ri, people, bumps };
    });

    // film-grain tile, generated once
    this.grain = document.createElement('canvas');
    this.grain.width = this.grain.height = 256;
    const g = this.grain.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 28;
    }
    g.putImageData(img, 0, 0);
  }

  draw({ ctx, audio, w, h, dt, t }) {
    if (audio.beat) this.beatCount++;
    const phase = Math.min(1, audio.beatPhase);
    const swell = Math.pow(1 - phase, 2);
    const downbeat = this.beatCount % 4 === 1;
    const hue = (t * 8 + this.beatCount * 6) % 360;
    const glowX = w / 2;
    const glowY = h * 0.34;

    // ---- handheld camera: slow drift + a zoom punch on the beat ----
    ctx.save();
    const zoom = 1.045 + swell * 0.018;
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.rotate(Math.sin(t * 0.07) * 0.004);
    ctx.translate(-w / 2 + Math.sin(t * 0.11) * w * 0.006, -h / 2 + Math.cos(t * 0.09) * h * 0.005);

    this._wall(ctx, w, h, t, hue, swell, audio, glowX, glowY);
    this._haze(ctx, w, h, t, hue);
    this._stage(ctx, w, h, t, hue, swell, audio, glowY);
    this._beams(ctx, w, h, t, hue, swell, audio, glowX, glowY);
    this._confetti(ctx, audio, w, h, dt, hue);

    if (downbeat && swell > 0.55) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(swell - 0.55) * 0.55})`;
      ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    }

    // ---- crowd, back to front; each row's mass band hides the waists ----
    for (const row of this.rows) {
      for (const p of row.people) {
        this._person(ctx, p, row, w, h, phase, t, hue, glowX, glowY);
      }
      this._mass(ctx, row, w, h, phase, t);
    }

    ctx.restore();

    // ---- vignette + grain: reads as footage, not geometry ----
    const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'transparent');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.35;
    const gx = Math.floor(Math.random() * 256);
    const gy = Math.floor(Math.random() * 256);
    for (let x = -gx; x < w; x += 256) {
      for (let y = -gy; y < h; y += 256) ctx.drawImage(this.grain, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ================= environment =================

  _wall(ctx, w, h, t, hue, swell, audio, glowX, glowY) {
    ctx.fillStyle = `hsl(${(hue + 250) % 360}, 45%, 4%)`;
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);

    // LED-wall bloom behind the stage
    const r = Math.max(w, h) * 0.75;
    const bloom = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, r);
    const lift = 12 + swell * 16 + audio.level * 14;
    bloom.addColorStop(0, `hsla(${hue}, 100%, ${45 + lift}%, 0.95)`);
    bloom.addColorStop(0.25, `hsla(${hue}, 95%, ${22 + lift * 0.6}%, 0.8)`);
    bloom.addColorStop(0.6, `hsla(${(hue + 40) % 360}, 80%, 10%, 0.5)`);
    bloom.addColorStop(1, 'transparent');
    ctx.fillStyle = bloom;
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);

    // god rays wheeling slowly around the bloom
    ctx.globalCompositeOperation = 'lighter';
    const rays = 9;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + t * 0.06;
      const spread = 0.10 + swell * 0.03;
      ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${0.035 + swell * 0.045})`;
      ctx.beginPath();
      ctx.moveTo(glowX, glowY);
      ctx.arc(glowX, glowY, Math.max(w, h), a - spread, a + spread);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _haze(ctx, w, h, t, hue) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const y = h * (0.45 + i * 0.16);
      const x = w / 2 + Math.sin(t * (0.05 + i * 0.02) + i * 2) * w * 0.2;
      const band = ctx.createRadialGradient(x, y, 0, x, y, w * 0.55);
      band.addColorStop(0, `hsla(${(hue + i * 25) % 360}, 70%, 55%, 0.045)`);
      band.addColorStop(1, 'transparent');
      ctx.fillStyle = band;
      ctx.fillRect(-w * 0.1, y - h * 0.2, w * 1.2, h * 0.4);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _stage(ctx, w, h, t, hue, swell, audio, glowY) {
    const cx = w / 2;
    const stageY = h * 0.56;
    const dark = 'hsla(255, 30%, 3%, 0.96)';

    // riser + booth + speaker stacks
    ctx.fillStyle = dark;
    ctx.fillRect(cx - w * 0.16, stageY - h * 0.005, w * 0.32, h * 0.06);
    this._round(ctx, cx - w * 0.075, stageY - h * 0.075, w * 0.15, h * 0.075, 6);
    ctx.fill();
    for (const side of [-1, 1]) {
      this._round(ctx, cx + side * w * 0.24 - w * 0.035, stageY - h * 0.16, w * 0.07, h * 0.21, 5);
      ctx.fill();
    }

    // DJ: head bob every beat, arm thrown up through each downbeat bar
    const s = h * 0.085;
    const bob = Math.abs(Math.sin((Math.min(1, audio.beatPhase)) * Math.PI)) * s * 0.12;
    const shY = stageY - h * 0.075 - s * 0.55 - bob;
    ctx.fillStyle = dark;
    ctx.beginPath(); // torso
    ctx.moveTo(cx - s * 0.34, stageY - h * 0.07);
    ctx.quadraticCurveTo(cx - s * 0.42, shY + s * 0.1, cx - s * 0.3, shY);
    ctx.lineTo(cx + s * 0.3, shY);
    ctx.quadraticCurveTo(cx + s * 0.42, shY + s * 0.1, cx + s * 0.34, stageY - h * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - s * 0.08, shY - s * 0.16, s * 0.16, s * 0.18); // neck
    ctx.beginPath(); // head
    ctx.ellipse(cx, shY - s * 0.24, s * 0.17, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineCap = 'round';
    if (this.beatCount % 8 < 4) {
      ctx.lineWidth = s * 0.13; // arm up
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.26, shY + s * 0.05);
      ctx.lineTo(cx + s * 0.48, shY - s * 0.35);
      ctx.lineTo(cx + s * 0.52, shY - s * (0.75 + swell * 0.15));
      ctx.stroke();
    }
  }

  _beams(ctx, w, h, t, hue, swell, audio, glowX, glowY) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const beams = 7;
    for (let i = 0; i < beams; i++) {
      // tempo-locked sweep: one full wag per 4 beats, phase-offset per beam
      const wag = Math.sin((t / (audio.beatInterval * 4)) * Math.PI * 2 + (i / beams) * Math.PI * 2);
      const ang = -Math.PI / 2 + wag * 1.15 + (i - (beams - 1) / 2) * 0.16;
      const len = Math.max(w, h) * 1.25;
      const x2 = glowX + Math.cos(ang) * len;
      const y2 = glowY + Math.sin(ang) * len;
      const bHue = (hue + 130 + i * 28) % 360;
      const grad = ctx.createLinearGradient(glowX, glowY, x2, y2);
      grad.addColorStop(0, `hsla(${bHue}, 100%, 72%, ${0.5 + swell * 0.4})`);
      grad.addColorStop(0.55, `hsla(${bHue}, 100%, 62%, ${0.18 + swell * 0.15})`);
      grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad;
      // halo / mid / hot core — soft volumetric beam instead of a flat triangle
      for (const [width, alpha] of [[w * 0.030, 0.30], [w * 0.011, 0.55], [w * 0.0032, 1]]) {
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(glowX, glowY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _confetti(ctx, audio, w, h, dt, hue) {
    if (audio.beat && this.confetti.length < 400) {
      const burst = this.beatCount % 4 === 1 ? 26 : 9;
      for (let i = 0; i < burst; i++) {
        const near = Math.random() < 0.15; // a few land close to the lens: soft bokeh
        this.confetti.push({
          x: Math.random() * w,
          y: -10 - Math.random() * h * 0.05,
          vy: (0.1 + Math.random() * 0.18) * h * (near ? 1.7 : 1),
          sway: Math.random() * Math.PI * 2,
          size: near ? 16 + Math.random() * 18 : 3.5 + Math.random() * 5,
          near,
          hue: (hue + 90 + Math.random() * 180) % 360,
          spin: (Math.random() - 0.5) * 7,
          rot: Math.random() * Math.PI,
        });
      }
    }
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.y += c.vy * dt;
      c.x += Math.sin(c.sway += dt * 2.6) * w * 0.0006;
      c.rot += c.spin * dt;
      if (c.y > h * 1.1) {
        this.confetti.splice(i, 1);
        continue;
      }
      if (c.near) {
        // out-of-focus foreground fleck
        const bok = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.size);
        bok.addColorStop(0, `hsla(${c.hue}, 90%, 70%, 0.14)`);
        bok.addColorStop(1, 'transparent');
        ctx.fillStyle = bok;
        ctx.fillRect(c.x - c.size, c.y - c.size, c.size * 2, c.size * 2);
      } else {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillStyle = `hsla(${c.hue}, 90%, 66%, 0.85)`;
        ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
        ctx.restore();
      }
    }
  }

  // ================= crowd =================

  /** Wavy dark band of packed bodies; hides everyone's waist-down. */
  _mass(ctx, row, w, h, phase, t) {
    const base = row.y * h;
    const amp = row.massAmp * h;
    const bob = Math.abs(Math.sin(phase * Math.PI)) * amp * 0.5;
    const bandY = (x) => base - bob
      + Math.sin(x / w * 21 + row.ri * 3 + t * 0.4) * amp
      + Math.sin(x / w * 9 - row.ri * 2) * amp * 0.7;

    ctx.fillStyle = `hsla(255, 30%, ${row.light * 0.55}%, 0.97)`;

    // implied heads first, sunk into the band so only the crown pokes above
    for (const b of row.bumps) {
      const bx = b.rx * w;
      const r = b.r * h * 0.2;
      const bBob = Math.abs(Math.sin(((phase + b.off) % 1) * Math.PI)) * amp * 0.7;
      ctx.beginPath();
      ctx.arc(bx, bandY(bx) + r * 0.35 - bBob, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(-w * 0.1, bandY(-w * 0.1));
    for (let x = -w * 0.1; x <= w * 1.1; x += w / 70) ctx.lineTo(x, bandY(x));
    ctx.lineTo(w * 1.1, h * 1.2);
    ctx.lineTo(-w * 0.1, h * 1.2);
    ctx.closePath();
    ctx.fill();
  }

  _person(ctx, p, row, w, h, phase, t, hue, glowX, glowY) {
    const s = Math.min(w, h) * 0.2 * p.s;
    const p2 = (phase + p.bobOff) % 1;
    const bounce = Math.abs(Math.sin(p2 * Math.PI));
    const swell = Math.pow(1 - p2, 2);
    const flip = (this.beatCount + row.ri) % 2 === 0 ? p.side : -p.side;

    const cx = p.rx * w + Math.sin(t * 0.3 + p.swayOff) * s * 0.05;
    const waist = row.y * h + s * 0.15; // buried in the mass band
    const shY = waist - s * 0.85 - bounce * s * 0.14;
    const lean = flip * (0.05 + swell * 0.06);
    const shX = cx + lean * s;

    // rim pass (offset toward the stage glow), then the dark body on top
    const toGlow = Math.atan2(glowY - shY, glowX - shX);
    const rimD = s * 0.045;
    const rim = `hsla(${hue}, 95%, 68%, 0.4)`;
    // fixed cool near-black: silhouettes must never drift warm/muddy as the
    // wall hue cycles — depth comes from the per-row lightness fade alone
    const dark = `hsla(255, 30%, ${row.light}%, 0.97)`;
    this._body(ctx, p, s, cx + Math.cos(toGlow) * rimD, shX + Math.cos(toGlow) * rimD,
      waist, shY + Math.sin(toGlow) * rimD, flip, swell, t, rim);
    this._body(ctx, p, s, cx, shX, waist, shY, flip, swell, t, dark);

    // glowing phone for the phone-holders
    if (p.style === 'phone') {
      const hx = shX + flip * s * 0.34;
      const hy = shY - s * (0.72 + swell * 0.05) + Math.sin(t * 1.3 + p.swayOff) * s * 0.04;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(flip * 0.15);
      ctx.shadowColor = 'rgba(190, 220, 255, 0.9)';
      ctx.shadowBlur = s * 0.25;
      ctx.fillStyle = 'rgba(210, 230, 255, 0.95)';
      ctx.fillRect(-s * 0.045, -s * 0.085, s * 0.09, s * 0.17);
      ctx.restore();
    }
  }

  /** One silhouette pass: tapered torso, neck, shaped head, two-width arms. */
  _body(ctx, p, s, cx, shX, waist, shY, flip, swell, t, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // torso: narrow at the waist, broad rounded shoulders
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.26, waist);
    ctx.quadraticCurveTo(shX - s * 0.36, shY + s * 0.28, shX - s * 0.3, shY + s * 0.02);
    ctx.quadraticCurveTo(shX - s * 0.18, shY - s * 0.12, shX, shY - s * 0.1);
    ctx.quadraticCurveTo(shX + s * 0.18, shY - s * 0.12, shX + s * 0.3, shY + s * 0.02);
    ctx.quadraticCurveTo(shX + s * 0.36, shY + s * 0.28, cx + s * 0.26, waist);
    ctx.closePath();
    ctx.fill();

    // head + neck, with a bit of variety
    const hx = shX + flip * swell * s * 0.05;
    const hy = shY - s * 0.34 - swell * s * 0.03;
    ctx.fillRect(hx - s * 0.07, shY - s * 0.22, s * 0.14, s * 0.14);
    ctx.beginPath();
    ctx.ellipse(hx, hy, s * 0.145, s * 0.165, flip * 0.08, 0, Math.PI * 2);
    ctx.fill();
    if (p.headType === 1) { // cap
      ctx.beginPath();
      ctx.ellipse(hx, hy - s * 0.09, s * 0.155, s * 0.09, flip * 0.08, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(hx - (flip > 0 ? -s * 0.02 : s * 0.24), hy - s * 0.12, s * 0.22, s * 0.045);
    } else if (p.headType === 2) { // ponytail
      ctx.beginPath();
      ctx.ellipse(hx - flip * s * 0.16, hy + s * 0.02, s * 0.06, s * 0.11, flip * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.headType === 3) { // fluffy hair
      ctx.beginPath();
      ctx.ellipse(hx, hy - s * 0.06, s * 0.175, s * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // arms: thicker upper arm, thinner forearm
    const upper = s * 0.115;
    const fore = s * 0.085;
    const arm = (sx, sy, ex, ey, wx, wy) => {
      ctx.lineWidth = upper;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.lineWidth = fore;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(wx, wy);
      ctx.stroke();
      ctx.beginPath(); // hand
      ctx.arc(wx, wy, fore * 0.62, 0, Math.PI * 2);
      ctx.fill();
    };

    const sL = { x: shX - s * 0.27, y: shY + s * 0.02 };
    const sR = { x: shX + s * 0.27, y: shY + s * 0.02 };
    if (p.style === 'pump') {
      // beat-side fist punches up, other arm cocked at the chest
      const f = flip > 0 ? sR : sL;
      const o = flip > 0 ? sL : sR;
      arm(f.x, f.y, f.x + flip * s * 0.16, f.y - s * 0.32, f.x + flip * s * 0.2, f.y - s * (0.62 + swell * 0.28));
      arm(o.x, o.y, o.x - flip * s * 0.12, o.y + s * 0.16, o.x + flip * s * 0.12, o.y - s * 0.05);
    } else if (p.style === 'wave') {
      for (const [sh, dir] of [[sL, -1], [sR, 1]]) {
        const wave = Math.sin(t * 2.6 + p.swayOff + dir) * s * 0.14;
        arm(sh.x, sh.y, sh.x + dir * s * 0.22, sh.y - s * 0.3, sh.x + dir * s * 0.18 + wave, sh.y - s * (0.6 + swell * 0.12));
      }
    } else if (p.style === 'phone') {
      // phone arm up (hand drawn by the caller with the glow), other arm down
      const f = flip > 0 ? sR : sL;
      const o = flip > 0 ? sL : sR;
      arm(f.x, f.y, f.x + flip * s * 0.15, f.y - s * 0.34, shX + flip * s * 0.34, shY - s * (0.72 + swell * 0.05));
      ctx.lineWidth = upper;
      ctx.beginPath();
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(o.x - flip * s * 0.08, o.y + s * 0.35);
      ctx.stroke();
    } else {
      // 'bob': hands at chest, elbows out, grooving in place
      for (const [sh, dir] of [[sL, -1], [sR, 1]]) {
        arm(sh.x, sh.y, sh.x + dir * s * 0.2, sh.y + s * 0.2, shX + dir * s * 0.1, sh.y + s * (0.06 - swell * 0.1));
      }
    }
  }

  _round(ctx, x, y, w2, h2, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w2, y, x + w2, y + h2, r);
    ctx.arcTo(x + w2, y + h2, x, y + h2, r);
    ctx.arcTo(x, y + h2, x, y, r);
    ctx.arcTo(x, y, x + w2, y, r);
    ctx.closePath();
  }
}
