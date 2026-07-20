/**
 * Oscilloscope: waveform ribbons flying through 3D space.
 *
 * Every frame the live waveform is captured and pushed into a depth stack;
 * older traces recede toward a drifting vanishing point, twisting with the
 * mids and dissipating with distance. Because the stack preserves history,
 * a kick's spike physically travels down the tunnel as it ages. Speed rides
 * the level, glow rides the beat, and silence collapses the tunnel into a
 * calm corridor of flat lines.
 */
export class Oscilloscope {
  constructor() {
    this.name = 'Oscilloscope';
    this.traces = []; // { v: Float32Array, z: depth }
    this.hue = 160;
  }

  draw({ ctx, audio, w, h, dt, t }) {
    const N = 128;
    const ZFAR = 10;
    const FOCAL = 3.2;

    // ---- capture this frame's waveform, advance the stack into depth ----
    const speed = 2.0 + audio.level * 3.5 + audio.beatPulse * 2.5;
    for (const tr of this.traces) tr.z += speed * dt;
    // capture a new ribbon only once the last one has receded a bit —
    // even spacing in depth keeps the tunnel readable instead of tangled
    if (!this.traces.length || this.traces[0].z >= 0.17) {
      const v = new Float32Array(N);
      const step = audio.wave.length / N;
      for (let i = 0; i < N; i++) v[i] = (audio.wave[(i * step) | 0] - 128) / 128;
      this.traces.unshift({ v, z: 0 });
    }
    while (this.traces.length > 70 || (this.traces.length && this.traces[this.traces.length - 1].z > ZFAR)) {
      this.traces.pop();
    }

    this.hue = (this.hue + dt * 10 + audio.beatPulse * dt * 80) % 360;

    // ---- the space: near-black void with a glow at the vanishing point ----
    ctx.fillStyle = '#020207';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const vpx = cx + Math.sin(t * 0.21) * w * 0.12;
    const vpy = cy + Math.cos(t * 0.17) * h * 0.09;
    const vg = ctx.createRadialGradient(vpx, vpy, 0, vpx, vpy, Math.min(w, h) * 0.4);
    vg.addColorStop(0, `hsla(${this.hue}, 90%, 55%, ${0.1 + audio.beatPulse * 0.16 + audio.level * 0.08})`);
    vg.addColorStop(1, 'transparent');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    const twist = Math.sin(t * 0.13) * 0.4 + audio.mid * 0.5;
    const railL = [];
    const railR = [];

    // ---- ribbons, far to near ----
    ctx.lineJoin = 'round';
    for (let k = this.traces.length - 1; k >= 0; k--) {
      const tr = this.traces[k];
      const z = tr.z;
      const s = FOCAL / (FOCAL + z);
      const fade = Math.max(0, 1 - z / ZFAR);
      const alpha = Math.pow(fade, 2) * (k === 0 ? 0.9 : 0.55);
      if (alpha < 0.01) continue;

      const cxz = cx + (vpx - cx) * (1 - s) * 1.5;
      const cyz = cy + (vpy - cy) * (1 - s) * 1.5;
      const halfW = w * 0.62 * s;
      const ampH = h * 0.3 * s;
      const roll = twist * z * 0.32 + Math.sin(t * 0.4) * 0.05;
      const cosR = Math.cos(roll);
      const sinR = Math.sin(roll);
      const hue = (this.hue + z * 15) % 360;

      ctx.strokeStyle = `hsla(${hue}, 100%, ${62 - fade * 0 + 0}%, ${alpha})`;
      ctx.lineWidth = Math.max(0.6, 2.6 * s);
      ctx.beginPath();
      // decimate distant ribbons: they're subpixel anyway
      const stride = z > ZFAR * 0.45 ? 2 : 1;
      for (let i = 0; i < N; i += stride) {
        const u = (i / (N - 1) - 0.5) * 2;
        const lx = u * halfW;
        const ly = -tr.v[i] * ampH;
        const x = cxz + lx * cosR - ly * sinR;
        const y = cyz + lx * sinR + ly * cosR;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // collect edge points for the tunnel rails
      const ex = halfW * cosR;
      const ey = halfW * sinR;
      railL.push([cxz - ex, cyz - ey, alpha]);
      railR.push([cxz + ex, cyz + ey, alpha]);

      // the newest ribbon gets the neon treatment
      if (k === 0) {
        ctx.save();
        ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowBlur = 16 + audio.beatPulse * 26;
        ctx.strokeStyle = `hsla(${hue}, 100%, 78%, 0.95)`;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- rails: faint edges give the tunnel its structure ----
    ctx.lineWidth = 1;
    for (const rail of [railL, railR]) {
      if (rail.length < 2) continue;
      ctx.strokeStyle = `hsla(${(this.hue + 40) % 360}, 80%, 60%, 0.16)`;
      ctx.beginPath();
      ctx.moveTo(rail[0][0], rail[0][1]);
      for (let i = 1; i < rail.length; i++) ctx.lineTo(rail[i][0], rail[i][1]);
      ctx.stroke();
    }
  }
}
