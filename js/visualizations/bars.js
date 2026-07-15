/** Classic Winamp-style spectrum analyzer: green-to-red bars with falling peak caps. */
export class SpectrumBars {
  constructor() {
    this.name = 'Spectrum Bars (Classic)';
    this.peaks = [];
  }

  draw({ ctx, audio, w, h, dt }) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, w, h);

    const barCount = 64;
    const gap = Math.max(1, w * 0.003);
    const barW = (w - gap * (barCount + 1)) / barCount;
    const usable = Math.floor(audio.freq.length * 0.7); // top bins are mostly empty
    const maxBarH = h * 0.85;

    if (this.peaks.length !== barCount) this.peaks = new Array(barCount).fill(0);

    for (let i = 0; i < barCount; i++) {
      // Log-ish bin mapping so bass doesn't hog half the display
      const t0 = Math.pow(i / barCount, 1.6);
      const t1 = Math.pow((i + 1) / barCount, 1.6);
      const from = Math.floor(t0 * usable);
      const to = Math.max(from + 1, Math.floor(t1 * usable));
      let sum = 0;
      for (let j = from; j < to; j++) sum += audio.freq[j];
      const v = Math.min(1, sum / (to - from) / 255);

      const barH = v * maxBarH;
      const x = gap + i * (barW + gap);

      // Segmented LED look, green at the bottom through yellow to red
      const segH = Math.max(3, h * 0.012);
      const segs = Math.floor(barH / segH);
      for (let sIdx = 0; sIdx < segs; sIdx++) {
        const frac = (sIdx * segH) / maxBarH;
        const hue = 120 - frac * 130; // 120 green -> below 0 red
        ctx.fillStyle = `hsl(${Math.max(-10, hue)}, 100%, ${45 + frac * 15}%)`;
        ctx.fillRect(x, h - (sIdx + 1) * segH + 1, barW, segH - 2);
      }

      // Falling peak cap
      if (barH > this.peaks[i]) this.peaks[i] = barH;
      else this.peaks[i] = Math.max(0, this.peaks[i] - dt * h * 0.25);
      if (this.peaks[i] > 2) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, h - this.peaks[i] - 3, barW, 3);
      }
    }
  }
}
