/**
 * Toon Two-Step (meme mode): three chunky 3D cartoon dancers doing the classic
 * side-to-side two-step in sync with the detected beat, on a disco dance floor
 * with a mirror ball. Original characters — a low-poly-style boy band of blobs.
 *
 * Rendering is a tiny hand-rolled 3D pipeline: parts are spheres and capsule
 * limbs positioned in world space, perspective-projected, painter-sorted by
 * depth, and drawn as shaded canvas gradients.
 */
export class ToonTwoStep {
  constructor() {
    this.name = 'Toon Dancers (3D)';
    this.beatCount = 0;
    this.stepSide = 1; // +1 stepping right, -1 stepping left
    this.dancers = [
      { x: -2.6, hue: 315, size: 1.0, phase: 0.0 },  // magenta
      { x: 0.0,  hue: 175, size: 1.15, phase: 0.5 }, // cyan (front-blob energy)
      { x: 2.6,  hue: 38,  size: 0.95, phase: 0.0 }, // orange
    ];
  }

  draw({ ctx, audio, w, h, dt, t }) {
    // Advance the dance one step per beat
    if (audio.beat) {
      this.beatCount++;
      this.stepSide = -this.stepSide;
    }
    // Smooth 0..1 progress through the current step; eased so it "lands"
    const p = Math.min(1, audio.beatPhase);
    const ease = p * p * (3 - 2 * p);
    // sway goes -1 .. +1 over two beats
    const sway = this.stepSide * (ease * 2 - 1) * -1;
    const bounce = Math.abs(Math.sin(p * Math.PI)); // hop within each step

    // ---- background: dark club with beat-flashing wall glow ----
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, `hsl(${(t * 15) % 360}, 45%, ${4 + audio.beatPulse * 9}%)`);
    bgGrad.addColorStop(1, '#05030a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ---- camera / projection ----
    const cam = { x: Math.sin(t * 0.12) * 1.2, y: 2.0, z: -7.5 };
    const focal = Math.min(w, h) * 1.05;
    const proj = (x, y, z) => {
      const dz = z - cam.z;
      return {
        x: w / 2 + ((x - cam.x) / dz) * focal,
        y: h * 0.52 - ((y - cam.y) / dz) * focal,
        s: focal / dz, // scale factor at this depth
        z: dz,
      };
    };

    this._drawFloor(ctx, proj, w, h, t, audio);
    this._drawDiscoBall(ctx, proj, t, audio);

    // ---- build all body parts, then painter-sort and draw ----
    const items = [];
    for (const d of this.dancers) {
      const localSway = d.phase ? -sway : sway; // middle dancer mirrors: chaos choreography
      this._buildDancer(items, d, localSway, bounce, t, audio);
    }
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw(ctx, proj);

    this._drawSpotlights(ctx, w, h, t, audio);
  }

  /** Assemble one dancer's spheres/limbs into the item list. */
  _buildDancer(items, d, sway, bounce, t, audio) {
    const s = d.size;
    const hipX = d.x + sway * 0.45 * s;
    const hipY = 1.05 * s + bounce * 0.22 * s + audio.beatPulse * 0.06;
    const lean = sway * 0.28; // body lean into the step
    const twist = Math.sin(t * 0.8 + d.x) * 0.15;

    // Helper: rotate a local offset by the lean, then place in world
    const at = (lx, ly, lz) => {
      const rx = lx * Math.cos(lean) - ly * Math.sin(lean);
      const ry = lx * Math.sin(lean) + ly * Math.cos(lean);
      const rz = lz + rx * twist * 0.3;
      return { x: hipX + rx, y: hipY + ry, z: rz };
    };

    const sphere = (pos, r, hue, sat, light, extra) => {
      items.push({
        z: pos.z,
        draw: (ctx, proj) => {
          const pr = proj(pos.x, pos.y, pos.z);
          const rad = r * pr.s;
          const g = ctx.createRadialGradient(
            pr.x - rad * 0.35, pr.y - rad * 0.35, rad * 0.1,
            pr.x, pr.y, rad
          );
          g.addColorStop(0, `hsl(${hue}, ${sat}%, ${light + 22}%)`);
          g.addColorStop(0.7, `hsl(${hue}, ${sat}%, ${light}%)`);
          g.addColorStop(1, `hsl(${hue}, ${sat}%, ${light - 16}%)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, rad, 0, Math.PI * 2);
          ctx.fill();
          if (extra) extra(ctx, pr, rad);
        },
      });
    };

    const limb = (a, b, r, hue, sat, light) => {
      items.push({
        z: (a.z + b.z) / 2 + 0.01,
        draw: (ctx, proj) => {
          const pa = proj(a.x, a.y, a.z);
          const pb = proj(b.x, b.y, b.z);
          ctx.strokeStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
          ctx.lineWidth = r * (pa.s + pb.s);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        },
      });
    };

    // --- legs: the stepping foot lifts, the planted foot stays down ---
    const stepLift = bounce * 0.3 * s;
    const footSpread = 0.34 * s;
    const liftSide = sway >= 0 ? 1 : -1; // trailing foot lifts
    for (const side of [-1, 1]) {
      const lift = side === liftSide ? stepLift : 0;
      const foot = {
        x: hipX + side * footSpread - sway * 0.15 * s * (side === liftSide ? 1 : 0.2),
        y: 0.12 * s + lift,
        z: side === liftSide ? -0.08 : 0.02,
      };
      const knee = {
        x: (hipX + side * footSpread * 0.7 + foot.x) / 2,
        y: (hipY * 0.55 + foot.y) / 2 + 0.12 * s,
        z: foot.z - 0.05 - lift * 0.4,
      };
      const hip = at(side * 0.2 * s, -0.28 * s, 0);
      limb(hip, knee, 0.11 * s, d.hue, 60, 32);
      limb(knee, foot, 0.11 * s, d.hue, 60, 32);
      sphere(foot, 0.17 * s, d.hue, 25, 88); // chunky white-ish shoes
    }

    // --- body ---
    sphere(at(0, 0, 0), 0.52 * s, d.hue, 85, 55);          // belly
    sphere(at(0, 0.42 * s, -0.02), 0.4 * s, d.hue, 85, 60); // chest

    // --- arms: swing opposite to the step, pump on the beat ---
    const armSwing = -sway * 0.9;
    for (const side of [-1, 1]) {
      const shoulder = at(side * 0.42 * s, 0.55 * s, 0);
      const pump = audio.beatPulse * 0.25 * (side === liftSide ? 1.4 : 0.6);
      const hand = {
        x: shoulder.x + side * 0.3 * s + armSwing * 0.25 * side,
        y: shoulder.y - 0.35 * s + armSwing * side * 0.3 + pump,
        z: shoulder.z - 0.25 - pump * 0.5,
      };
      const elbow = {
        x: (shoulder.x + hand.x) / 2 + side * 0.08,
        y: (shoulder.y + hand.y) / 2 - 0.08 * s,
        z: (shoulder.z + hand.z) / 2,
      };
      limb(shoulder, elbow, 0.1 * s, d.hue, 70, 45);
      limb(elbow, hand, 0.1 * s, d.hue, 70, 45);
      sphere(hand, 0.14 * s, d.hue, 20, 85);
    }

    // --- head with face; bobs opposite the hips for extra groove ---
    const headPos = at(sway * -0.12, 0.95 * s + bounce * 0.05, -0.05);
    const mouthOpen = 0.25 + audio.level * 0.9; // they sing along
    sphere(headPos, 0.34 * s, d.hue, 80, 62, (ctx, pr, rad) => {
      // eyes
      for (const es of [-1, 1]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.ellipse(pr.x + es * rad * 0.32, pr.y - rad * 0.15, rad * 0.18, rad * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(pr.x + es * rad * 0.32 + sway * rad * 0.08, pr.y - rad * 0.12, rad * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      // mouth
      ctx.fillStyle = '#401020';
      ctx.beginPath();
      ctx.ellipse(pr.x, pr.y + rad * 0.4, rad * 0.24, rad * 0.28 * Math.min(1, mouthOpen), 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  _drawFloor(ctx, proj, w, h, t, audio) {
    // Checkerboard disco tiles that light up with the beat
    const tiles = 8;
    const size = 1.3;
    for (let gz = 0; gz < tiles; gz++) {
      for (let gx = -tiles / 2; gx < tiles / 2; gx++) {
        const x0 = gx * size;
        const z0 = gz * size - 1.5;
        const corners = [
          proj(x0, 0, z0), proj(x0 + size, 0, z0),
          proj(x0 + size, 0, z0 + size), proj(x0, 0, z0 + size),
        ];
        const flash = (gx + gz + this.beatCount) % 2 === 0;
        const hue = (gx * 47 + gz * 91 + t * 25) % 360;
        const light = flash ? 14 + audio.beatPulse * 38 : 7;
        ctx.fillStyle = `hsl(${hue}, 70%, ${light}%)`;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  _drawDiscoBall(ctx, proj, t, audio) {
    const pos = proj(0, 4.6, 1.5);
    const r = 0.45 * pos.s;
    ctx.strokeStyle = 'rgba(200,200,220,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - r * 3);
    ctx.lineTo(pos.x, pos.y - r);
    ctx.stroke();

    const g = ctx.createRadialGradient(pos.x - r * 0.3, pos.y - r * 0.3, r * 0.1, pos.x, pos.y, r);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.5, '#aab');
    g.addColorStop(1, '#556');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fill();

    // facet sparkles, extra on beats
    const sparkles = 14 + Math.floor(audio.beatPulse * 20);
    for (let i = 0; i < sparkles; i++) {
      const a = (i / sparkles) * Math.PI * 2 + t * 1.5;
      const rr = r * (0.2 + ((i * 37) % 10) / 14);
      ctx.fillStyle = `hsla(${(i * 60 + t * 90) % 360}, 90%, 75%, ${0.5 + audio.beatPulse * 0.5})`;
      ctx.fillRect(pos.x + Math.cos(a) * rr - 1.5, pos.y + Math.sin(a) * rr * 0.8 - 1.5, 3, 3);
    }
  }

  _drawSpotlights(ctx, w, h, t, audio) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const ang = Math.sin(t * (0.6 + i * 0.2) + i * 2.1) * 0.7;
      const hue = (i * 120 + t * 40) % 360;
      const topX = w * (0.25 + i * 0.25);
      const grad = ctx.createLinearGradient(topX, 0, topX + ang * h * 0.6, h);
      grad.addColorStop(0, `hsla(${hue}, 100%, 60%, ${0.10 + audio.beatPulse * 0.10})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(topX - 8, 0);
      ctx.lineTo(topX + 8, 0);
      ctx.lineTo(topX + ang * h * 0.6 + w * 0.09, h);
      ctx.lineTo(topX + ang * h * 0.6 - w * 0.09, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
