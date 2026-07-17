import { PostFX } from '../lib/postfx.js';

/**
 * Silhouette Rave: a packed concert crowd, waist-up against the stage light,
 * rendered in two stages:
 *
 *   1. The SCENE (this file, canvas 2D): volumetric silhouette figures rising
 *      out of crowd-mass bands, glowing phones, a headphoned DJ working the
 *      decks on a riser, layered laser beams, sweeping spot cones, haze,
 *      confetti, LED-wall bloom.
 *   2. The LIGHTING (js/lib/postfx.js, WebGL): screen-space god rays that
 *      stream from the stage glow and are occluded by the silhouettes,
 *      bloom, filmic tone mapping, chromatic aberration, vignette, grain.
 *
 * The shader pass is what gives the light actual depth — beams wrap around
 * figures per-pixel instead of being flat painted shapes. Falls back to the
 * raw scene if WebGL is unavailable.
 */

// Beat-punch curve: fast rise just after the beat, eased fall into the next.
// Reads as a dance move (anticipate, hit, settle) instead of a twitch.
function punch(p) {
  if (p < 0.22) {
    const x = p / 0.22;
    return 1 - Math.pow(1 - x, 3);
  }
  const fall = (p - 0.22) / 0.78;
  return (1 - fall * fall * (3 - 2 * fall)) * 0.95 + 0.05;
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

export class SilhouetteRave {
  constructor() {
    this.name = 'Silhouette Rave';
    this.beatCount = 0;
    this.confetti = [];
    this.post = null;
    this.scene = null;

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
      const bumps = [];
      for (let i = 0; i < row.n * 2; i++) {
        bumps.push({ rx: Math.random(), r: row.s * (0.05 + Math.random() * 0.035), off: Math.random() });
      }
      return { ...row, ri, people, bumps };
    });
  }

  draw({ ctx, audio, w, h, dt, t }) {
    if (!this.scene || this.scene.width !== w || this.scene.height !== h) {
      this.scene = document.createElement('canvas');
      this.scene.width = w;
      this.scene.height = h;
      this.sctx = this.scene.getContext('2d');
    }
    if (!this.post) this.post = new PostFX();

    if (audio.beat) this.beatCount++;
    const phase = Math.min(1, audio.beatPhase);
    const hue = (t * 8 + this.beatCount * 6) % 360;
    const glowX = w / 2;
    const glowY = h * 0.34;

    this._renderScene(this.sctx, audio, w, h, dt, t, hue, phase, glowX, glowY);

    if (this.post.ok) {
      const out = this.post.render(this.scene, {
        lightX: glowX,
        lightY: glowY,
        time: t,
        beat: audio.beatPulse,
        tint: hslToRgb(hue, 0.75, 0.62),
      });
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(out, 0, 0, w, h);
    } else {
      ctx.drawImage(this.scene, 0, 0);
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }
  }

  _renderScene(ctx, audio, w, h, dt, t, hue, phase, glowX, glowY) {
    const swell = Math.pow(1 - phase, 2);
    const downbeat = this.beatCount % 4 === 1;

    // ---- handheld camera: slow drift + a zoom punch on the beat ----
    ctx.save();
    const zoom = 1.045 + swell * 0.018;
    ctx.translate(w / 2, h / 2);
    ctx.scale(zoom, zoom);
    ctx.rotate(Math.sin(t * 0.07) * 0.004);
    ctx.translate(-w / 2 + Math.sin(t * 0.11) * w * 0.006, -h / 2 + Math.cos(t * 0.09) * h * 0.005);

    this._wall(ctx, w, h, t, hue, swell, audio, glowX, glowY);
    this._haze(ctx, w, h, t, hue);
    this._spots(ctx, w, h, t, hue, swell, audio);
    this._stage(ctx, w, h, t, hue, phase, audio);
    this._beams(ctx, w, h, t, hue, swell, audio, glowX, glowY);
    this._confetti(ctx, audio, w, h, dt, hue);

    if (downbeat && swell > 0.55) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(swell - 0.55) * 0.55})`;
      ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);
    }

    for (const row of this.rows) {
      for (const p of row.people) {
        this._person(ctx, p, row, w, h, phase, t, hue, glowX, glowY);
      }
      this._mass(ctx, row, w, h, phase, t);
    }

    ctx.restore();
  }

  // ================= environment =================

  _wall(ctx, w, h, t, hue, swell, audio, glowX, glowY) {
    ctx.fillStyle = `hsl(${(hue + 250) % 360}, 45%, 4%)`;
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);

    const r = Math.max(w, h) * 0.75;
    const bloom = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, r);
    const lift = 12 + swell * 16 + audio.level * 14;
    bloom.addColorStop(0, `hsla(${hue}, 100%, ${45 + lift}%, 0.95)`);
    bloom.addColorStop(0.25, `hsla(${hue}, 95%, ${22 + lift * 0.6}%, 0.8)`);
    bloom.addColorStop(0.6, `hsla(${(hue + 40) % 360}, 80%, 10%, 0.5)`);
    bloom.addColorStop(1, 'transparent');
    ctx.fillStyle = bloom;
    ctx.fillRect(-w * 0.1, -h * 0.1, w * 1.2, h * 1.2);

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

  /** Layered soft beam: halo, mid glow, hot core. */
  _beamStroke(ctx, x1, y1, x2, y2, hueB, intensity, baseWidth) {
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, `hsla(${hueB}, 100%, 72%, ${0.5 * intensity})`);
    grad.addColorStop(0.55, `hsla(${hueB}, 100%, 62%, ${0.2 * intensity})`);
    grad.addColorStop(1, 'transparent');
    ctx.strokeStyle = grad;
    for (const [mul, alpha] of [[1, 0.3], [0.37, 0.55], [0.11, 1]]) {
      ctx.globalAlpha = alpha * intensity;
      ctx.lineWidth = baseWidth * mul;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Two moving-head spot cones sweeping across the crowd from the truss. */
  _spots(ctx, w, h, t, hue, swell, audio) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const ox = w * (0.5 + side * 0.46);
      const oy = -h * 0.04;
      // sweep tempo-locked: full pass every 8 beats
      const sweep = Math.sin((t / (audio.beatInterval * 8)) * Math.PI * 2 + side * 1.7);
      const tx = w * (0.5 + sweep * 0.38);
      const ty = h * 0.8;
      this._beamStroke(ctx, ox, oy, tx, ty, (hue + 200 + side * 40) % 360, 0.55 + swell * 0.35, w * 0.075);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _beams(ctx, w, h, t, hue, swell, audio, glowX, glowY) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const beams = 7;
    for (let i = 0; i < beams; i++) {
      const wag = Math.sin((t / (audio.beatInterval * 4)) * Math.PI * 2 + (i / beams) * Math.PI * 2);
      const ang = -Math.PI / 2 + wag * 1.15 + (i - (beams - 1) / 2) * 0.16;
      const len = Math.max(w, h) * 1.25;
      this._beamStroke(
        ctx, glowX, glowY,
        glowX + Math.cos(ang) * len, glowY + Math.sin(ang) * len,
        (hue + 130 + i * 28) % 360, 0.7 + swell * 0.35, w * 0.03
      );
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _confetti(ctx, audio, w, h, dt, hue) {
    if (audio.beat && this.confetti.length < 400) {
      const burst = this.beatCount % 4 === 1 ? 26 : 9;
      for (let i = 0; i < burst; i++) {
        const near = Math.random() < 0.15;
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

  // ================= stage & DJ =================

  _stage(ctx, w, h, t, hue, phase, audio) {
    const cx = w / 2;
    const stageY = h * 0.56;
    const boothTop = stageY - h * 0.075;
    const dark = 'hsla(255, 30%, 3%, 0.97)';
    const s = h * 0.105;

    // riser + speaker stacks
    ctx.fillStyle = dark;
    ctx.fillRect(cx - w * 0.16, stageY - h * 0.005, w * 0.32, h * 0.06);
    for (const side of [-1, 1]) {
      this._round(ctx, cx + side * w * 0.24 - w * 0.035, stageY - h * 0.16, w * 0.07, h * 0.21, 5);
      ctx.fill();
    }

    // ---- the DJ: volumetric torso, headphones, arms working the decks ----
    const pn = punch(phase);
    const bob = pn * s * 0.1;
    const shY = boothTop - s * 0.52 + bob;
    const shX = cx + Math.sin(t * 0.5) * s * 0.03;

    // torso: broad shoulders tapering into the booth
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3, boothTop + s * 0.1);
    ctx.quadraticCurveTo(shX - s * 0.44, shY + s * 0.3, shX - s * 0.36, shY + s * 0.02);
    ctx.quadraticCurveTo(shX - s * 0.2, shY - s * 0.13, shX, shY - s * 0.11);
    ctx.quadraticCurveTo(shX + s * 0.2, shY - s * 0.13, shX + s * 0.36, shY + s * 0.02);
    ctx.quadraticCurveTo(shX + s * 0.44, shY + s * 0.3, cx + s * 0.3, boothTop + s * 0.1);
    ctx.closePath();
    ctx.fill();

    // head + neck, nodding into the beat
    const nod = pn * s * 0.06;
    const hx = shX;
    const hy = shY - s * 0.3 + nod;
    ctx.fillRect(hx - s * 0.08, shY - s * 0.24, s * 0.16, s * 0.16);
    ctx.beginPath();
    ctx.ellipse(hx, hy, s * 0.155, s * 0.175, 0, 0, Math.PI * 2);
    ctx.fill();

    // headphones: band over the crown + two ear cups
    ctx.lineCap = 'round';
    ctx.strokeStyle = dark;
    ctx.lineWidth = s * 0.05;
    ctx.beginPath();
    ctx.arc(hx, hy + s * 0.01, s * 0.19, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    for (const side of [-1, 1]) {
      this._round(ctx, hx + side * s * 0.16 - s * 0.045, hy - s * 0.05, s * 0.09, s * 0.13, 3);
      ctx.fill();
    }

    // arms: hands riding the decks; through hype bars one arm throws up,
    // travelling a real arc via the punch curve
    const deckY = boothTop - s * 0.03;
    const hype = this.beatCount % 8 >= 4;
    for (const side of [-1, 1]) {
      const sx = shX + side * s * 0.32;
      const sy = shY + s * 0.04;
      const raising = hype && side === 1;
      let hxnd, hynd;
      if (raising) {
        // wrist arcs from the deck up over the head
        const lift = punch(phase);
        hxnd = sx + side * s * (0.28 - lift * 0.1);
        hynd = deckY - lift * s * 1.05;
      } else {
        // deck hand: small alternating scratch bob
        const scratch = Math.sin((phase + (side === 1 ? 0 : 0.5)) * Math.PI * 2);
        hxnd = cx + side * s * 0.3 + scratch * s * 0.05;
        hynd = deckY + Math.abs(scratch) * s * 0.02;
      }
      const ex = (sx + hxnd) / 2 + side * s * 0.14;
      const ey = (sy + hynd) / 2 + (raising ? -s * 0.05 : s * 0.1);
      const dx = hxnd - ex;
      const dy = hynd - ey;
      const L = Math.hypot(dx, dy) || 1;
      this._limb(ctx, [
        { x: sx, y: sy, r: s * 0.14 },
        { x: (sx + ex) / 2, y: (sy + ey) / 2, r: s * 0.108 },
        { x: ex, y: ey, r: s * 0.085 },
        { x: hxnd, y: hynd, r: s * 0.062 },
        { x: hxnd + (dx / L) * s * 0.13, y: hynd + (dy / L) * s * 0.13, r: s * 0.048 },
      ]);
    }

    // booth in front of the DJ, with glowing laptop + deck LEDs
    ctx.fillStyle = dark;
    this._round(ctx, cx - w * 0.075, boothTop, w * 0.15, h * 0.075, 6);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = `hsla(${(hue + 180) % 360}, 90%, 70%, 0.9)`;
    ctx.shadowBlur = s * 0.3;
    ctx.fillStyle = `hsla(${(hue + 180) % 360}, 80%, 78%, 0.9)`;
    ctx.fillRect(cx - s * 0.16, boothTop + s * 0.06, s * 0.32, s * 0.05);
    ctx.restore();
  }

  // ================= crowd =================

  _mass(ctx, row, w, h, phase, t) {
    const base = row.y * h;
    const amp = row.massAmp * h;
    const bob = Math.abs(Math.sin(phase * Math.PI)) * amp * 0.5;
    const bandY = (x) => base - bob
      + Math.sin(x / w * 21 + row.ri * 3 + t * 0.4) * amp
      + Math.sin(x / w * 9 - row.ri * 2) * amp * 0.7;

    ctx.fillStyle = `hsla(255, 30%, ${row.light * 0.55}%, 0.97)`;

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
    const pn = punch(p2);
    const flip = (this.beatCount + row.ri) % 2 === 0 ? p.side : -p.side;

    const cx = p.rx * w + Math.sin(t * 0.3 + p.swayOff) * s * 0.05;
    const waist = row.y * h + s * 0.15;
    const shY = waist - s * 0.85 - bounce * s * 0.18;
    const lean = flip * (0.04 + pn * 0.09);
    const shX = cx + lean * s;

    const toGlow = Math.atan2(glowY - shY, glowX - shX);
    const gx = Math.cos(toGlow);
    const gy = Math.sin(toGlow);
    const rimD = s * 0.045;
    const rim = `hsla(${hue}, 95%, 68%, 0.4)`;
    // cross-body shading toward the glow: the silhouette reads as a round
    // form catching spill light, not a flat cutout
    const dark = ctx.createLinearGradient(shX + gx * s * 0.9, shY + gy * s * 0.9, shX - gx * s * 0.9, shY - gy * s * 0.9);
    dark.addColorStop(0, `hsla(255, 26%, ${row.light + 5.5}%, 0.97)`);
    dark.addColorStop(0.55, `hsla(255, 30%, ${row.light}%, 0.97)`);
    dark.addColorStop(1, `hsla(255, 32%, ${Math.max(1, row.light - 2)}%, 0.97)`);
    this._body(ctx, p, s, cx + gx * rimD, shX + gx * rimD,
      waist, shY + gy * rimD, flip, pn, t, rim);
    this._body(ctx, p, s, cx, shX, waist, shY, flip, pn, t, dark);

    if (p.style === 'phone') {
      const hx = shX + flip * s * 0.34;
      const hy = shY - s * (0.72 + pn * 0.06) + Math.sin(t * 1.3 + p.swayOff) * s * 0.04;
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

  /**
   * Tapered limb: a centerline of {x, y, r} points filled as one polygon —
   * deltoid tapering through elbow to wrist with no joint circles, ending in
   * a mitt-shaped hand. This is what kills the popsicle-stick look.
   */
  _limb(ctx, pts) {
    const n = pts.length;
    const left = [];
    const right = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      let dx;
      let dy;
      if (i === 0) {
        dx = pts[1].x - p.x;
        dy = pts[1].y - p.y;
      } else if (i === n - 1) {
        dx = p.x - pts[i - 1].x;
        dy = p.y - pts[i - 1].y;
      } else {
        dx = pts[i + 1].x - pts[i - 1].x;
        dy = pts[i + 1].y - pts[i - 1].y;
      }
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      left.push([p.x + nx * p.r, p.y + ny * p.r]);
      right.push([p.x - nx * p.r, p.y - ny * p.r]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) {
      const mx = (left[i - 1][0] + left[i][0]) / 2;
      const my = (left[i - 1][1] + left[i][1]) / 2;
      ctx.quadraticCurveTo(left[i - 1][0], left[i - 1][1], mx, my);
    }
    ctx.lineTo(left[n - 1][0], left[n - 1][1]);
    // rounded tip: bow out past the last point
    const tip = pts[n - 1];
    const prev = pts[n - 2];
    const tl = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const ex = tip.x + ((tip.x - prev.x) / tl) * tip.r * 1.4;
    const ey = tip.y + ((tip.y - prev.y) / tl) * tip.r * 1.4;
    ctx.quadraticCurveTo(ex, ey, right[n - 1][0], right[n - 1][1]);
    for (let i = n - 2; i >= 0; i--) {
      const mx = (right[i + 1][0] + right[i][0]) / 2;
      const my = (right[i + 1][1] + right[i][1]) / 2;
      ctx.quadraticCurveTo(right[i + 1][0], right[i + 1][1], mx, my);
    }
    ctx.lineTo(right[0][0], right[0][1]);
    ctx.closePath();
    ctx.fill();
  }

  /** One silhouette pass: anatomical torso outline + tapered filled arms. */
  _body(ctx, p, s, cx, shX, waist, shY, flip, pn, t, color) {
    ctx.fillStyle = color;

    // ---- torso: one closed outline — lats up to the armpits, deltoid
    // bulges, trapezius sloping into the neck (no shoulder "shelf") ----
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.3, waist);
    ctx.quadraticCurveTo(shX - s * 0.34, shY + s * 0.34, shX - s * 0.28, shY + s * 0.12); // left lat
    ctx.quadraticCurveTo(shX - s * 0.37, shY + s * 0.02, shX - s * 0.3, shY - s * 0.07);  // left deltoid
    ctx.quadraticCurveTo(shX - s * 0.18, shY - s * 0.13, shX - s * 0.07, shY - s * 0.155); // left trapezius
    ctx.quadraticCurveTo(shX, shY - s * 0.165, shX + s * 0.07, shY - s * 0.155);           // neck base
    ctx.quadraticCurveTo(shX + s * 0.18, shY - s * 0.13, shX + s * 0.3, shY - s * 0.07);  // right trapezius
    ctx.quadraticCurveTo(shX + s * 0.37, shY + s * 0.02, shX + s * 0.28, shY + s * 0.12); // right deltoid
    ctx.quadraticCurveTo(shX + s * 0.34, shY + s * 0.34, cx + s * 0.3, waist);            // right lat
    ctx.closePath();
    ctx.fill();

    // ---- neck column + head (hair merged into the silhouette) ----
    const hx = shX + flip * pn * s * 0.06;
    const hy = shY - s * 0.36 - pn * s * 0.04;
    ctx.beginPath();
    ctx.moveTo(hx - s * 0.09, shY - s * 0.13);
    ctx.lineTo(hx - s * 0.07, hy + s * 0.06);
    ctx.lineTo(hx + s * 0.07, hy + s * 0.06);
    ctx.lineTo(hx + s * 0.09, shY - s * 0.13);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx, hy, s * 0.15, s * 0.17, flip * 0.06, 0, Math.PI * 2);
    ctx.fill();
    if (p.headType === 1) { // cap
      ctx.beginPath();
      ctx.ellipse(hx, hy - s * 0.09, s * 0.16, s * 0.095, flip * 0.06, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(hx - (flip > 0 ? -s * 0.02 : s * 0.24), hy - s * 0.12, s * 0.22, s * 0.045);
    } else if (p.headType === 2) { // ponytail
      ctx.beginPath();
      ctx.ellipse(hx - flip * s * 0.17, hy + s * 0.03, s * 0.06, s * 0.12, flip * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.headType === 3) { // fluffy hair
      ctx.beginPath();
      ctx.ellipse(hx, hy - s * 0.06, s * 0.18, s * 0.165, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- arms: centerlines with anatomical radii, filled as one shape ----
    // shoulder joint sits inside the deltoid so the arm grows out of the
    // torso mass with no seam
    const armPts = (sh, elbow, wrist, curl) => {
      const dx = wrist.x - elbow.x;
      const dy = wrist.y - elbow.y;
      const L = Math.hypot(dx, dy) || 1;
      const hand = {
        x: wrist.x + (dx / L) * s * 0.14 - (dy / L) * curl * s * 0.05,
        y: wrist.y + (dy / L) * s * 0.14 + (dx / L) * curl * s * 0.05,
        r: s * 0.045,
      };
      return [
        { x: sh.x, y: sh.y, r: s * 0.13 },
        { x: (sh.x + elbow.x) / 2, y: (sh.y + elbow.y) / 2, r: s * 0.1 }, // bicep
        { x: elbow.x, y: elbow.y, r: s * 0.078 },
        { x: wrist.x, y: wrist.y, r: s * 0.058 },
        hand,
      ];
    };

    const sL = { x: shX - s * 0.24, y: shY + s * 0.03 };
    const sR = { x: shX + s * 0.24, y: shY + s * 0.03 };
    if (p.style === 'pump') {
      // the fist travels a real arc: chest-height at rest, full extension on the hit
      const f = flip > 0 ? sR : sL;
      const o = flip > 0 ? sL : sR;
      this._limb(ctx, armPts(f,
        { x: f.x + flip * s * 0.22, y: f.y - s * (0.02 + pn * 0.28) },
        { x: f.x + flip * s * (0.28 - pn * 0.12), y: f.y - s * (0.12 + pn * 0.68) }, flip));
      this._limb(ctx, armPts(o,
        { x: o.x - flip * s * 0.12, y: o.y + s * 0.18 },
        { x: o.x + flip * s * 0.12, y: o.y - s * 0.02 }, -flip));
    } else if (p.style === 'wave') {
      for (const [sh, dir] of [[sL, -1], [sR, 1]]) {
        const wave = Math.sin(t * 2.6 + p.swayOff + dir) * s * 0.2;
        this._limb(ctx, armPts(sh,
          { x: sh.x + dir * s * 0.24, y: sh.y - s * 0.26 },
          { x: sh.x + dir * s * 0.16 + wave, y: sh.y - s * (0.52 + pn * 0.2) }, dir));
      }
    } else if (p.style === 'phone') {
      const f = flip > 0 ? sR : sL;
      const o = flip > 0 ? sL : sR;
      this._limb(ctx, armPts(f,
        { x: f.x + flip * s * 0.17, y: f.y - s * 0.3 },
        { x: shX + flip * s * 0.33, y: shY - s * (0.68 + pn * 0.06) }, 0));
      this._limb(ctx, armPts(o,
        { x: o.x - flip * s * 0.02, y: o.y + s * 0.22 },
        { x: o.x - flip * s * 0.06, y: o.y + s * 0.4 }, 0));
    } else {
      // 'bob': hands grooving at the chest, elbows out
      for (const [sh, dir] of [[sL, -1], [sR, 1]]) {
        this._limb(ctx, armPts(sh,
          { x: sh.x + dir * s * 0.22, y: sh.y + s * 0.18 },
          { x: shX + dir * s * 0.12, y: sh.y + s * (0.12 - pn * 0.24) }, -dir));
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
