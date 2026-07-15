/**
 * Pulse Rings (BPM): a tempo-centric visualization. Every detected beat emits
 * an expanding ring whose travel speed is scaled so it crosses the screen in
 * exactly one 4-beat bar; downbeats (every 4th) fire heavier accent rings.
 * The core breathes with the beat phase like a metronome and shows the live
 * BPM estimate from the tempo tracker.
 */
export class PulseRings {
  constructor() {
    this.name = 'Pulse Rings (BPM)';
    this.rings = [];
    this.beatCount = 0;
  }

  draw({ ctx, audio, w, h, dt, t }) {
    ctx.fillStyle = 'rgba(2, 2, 10, 0.25)';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(w, h) / 2;

    if (audio.beat) {
      this.beatCount++;
      const major = this.beatCount % 4 === 1; // downbeat accent
      this.rings.push({
        r: 0,
        major,
        hue: (this.beatCount * 24 + t * 10) % 360,
      });
    }

    // Rings cross the screen in one 4-beat bar, so spacing reads as tempo
    const speed = maxR / (4 * audio.beatInterval);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.r += speed * dt;
      if (ring.r > maxR) {
        this.rings.splice(i, 1);
        continue;
      }
      const fade = 1 - ring.r / maxR;
      ctx.strokeStyle = `hsla(${ring.hue}, 90%, ${55 + fade * 15}%, ${fade * (ring.major ? 0.95 : 0.55)})`;
      ctx.lineWidth = ring.major ? 5 + fade * 4 : 2 + fade * 2;
      ctx.shadowColor = `hsl(${ring.hue}, 90%, 60%)`;
      ctx.shadowBlur = ring.major ? 18 : 8;
      ctx.beginPath();
      ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Metronome core: swells at the instant of the beat, relaxes toward the next
    const phase = Math.min(1, audio.beatPhase);
    const swell = Math.pow(1 - phase, 2);
    const coreR = Math.min(w, h) * (0.11 + swell * 0.035 + audio.bass * 0.02);
    const hue = (t * 25) % 360;
    const g = ctx.createRadialGradient(cx, cy, coreR * 0.2, cx, cy, coreR);
    g.addColorStop(0, `hsla(${hue}, 80%, ${25 + swell * 25}%, 0.95)`);
    g.addColorStop(1, `hsla(${hue}, 90%, 12%, 0.9)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `hsla(${hue}, 90%, ${60 + swell * 30}%, 0.9)`;
    ctx.lineWidth = 2 + swell * 3;
    ctx.stroke();

    // Live BPM readout
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (audio.bpm > 0 && audio.bpmConfidence > 0.15) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.75 + swell * 0.25})`;
      ctx.font = `bold ${Math.round(coreR * 0.55)}px system-ui`;
      ctx.fillText(String(Math.round(audio.bpm)), cx, cy - coreR * 0.08);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `${Math.round(coreR * 0.18)}px system-ui`;
      ctx.fillText('BPM', cx, cy + coreR * 0.34);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${Math.round(coreR * 0.2)}px system-ui`;
      ctx.fillText('listening…', cx, cy);
    }

    // Bar-position dots (1-2-3-4) under the core
    const dotY = cy + coreR * 1.5;
    for (let i = 0; i < 4; i++) {
      const isCurrent = (this.beatCount - 1) % 4 === i && this.beatCount > 0;
      ctx.fillStyle = isCurrent
        ? `hsla(${hue}, 90%, 70%, ${0.5 + swell * 0.5})`
        : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx + (i - 1.5) * coreR * 0.45, dotY, coreR * (isCurrent ? 0.09 : 0.06), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
