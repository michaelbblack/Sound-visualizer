# Sound Visualizer

Winamp-style, full-screen music visualizations driven by your **microphone**.
Pure HTML/CSS/JS — no build step, no dependencies.

## Running it

Microphone access requires a **secure context**, so serve the folder over
`localhost` (or HTTPS) rather than opening `index.html` directly:

```bash
# any static server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

Click **Start with Microphone** and play some music near your mic.
No mic handy? **Demo Mode** plays a built-in synth beat instead.

## Visualizations

| # | Name | Vibe |
|---|------|------|
| 1 | Spectrum Bars (Classic) | Green-to-red LED analyzer with falling peak caps |
| 2 | Oscilloscope | Neon waveform ribbons flying through 3D space — older traces recede, twist and dissipate down a tunnel |
| 3 | Radial Burst | Spectrum fan around a pulsing waveform ring |
| 4 | Psychedelic Feedback | Milkdrop-style zoom/rotate feedback tunnel |
| 5 | Beat Fireworks | Particle bursts on every detected beat |
| 6 | Starfield Warp | Hyperspace star streaks, speed follows the music |
| 7 | Pulse Rings (BPM) | Beat-emitted rings paced to the bar, metronome core with a live BPM readout |
| 8 | Meme Cycle | Rotates through a playlist of animated meme GIFs in random order, each beat-scrubbed, cutting between them on the beat; pauses when the music stops |
| 9 | Party Animals | A silhouette crowd of bunnies, cats, bears, foxes and unicorns raving on the beat — mouse-eared DJ, volumetric god-ray lighting (WebGL), wet-floor reflection, confetti |
| 10 | Spectre Diffraction Bloom | Flight over a real Spectre aperiodic tiling (2023 monotile, true substitution rules) morphing into its computed Fourier diffraction pattern — Bragg peaks stream past as a star tunnel; key `0` |

## Controls

| Input | Action |
|-------|--------|
| `←` / `→` | Previous / next visualization |
| `1`–`9`, `0` | Jump to a visualization (`0` = tenth) |
| `B` | Toggle the live BPM readout overlay |
| `S` | Shuffle mode: hop to a random visualization every 16 bars |
| `F` or double-click | Toggle fullscreen |
| `H` | Hide/show the control bar |
| Sensitivity slider | Boost or tame the response for quiet/loud rooms |

The control bar and cursor auto-hide after 3 seconds of no mouse movement.

## How it works

- `js/audio.js` — Web Audio `AnalyserNode` over the mic stream (behind an
  auto-gain stage so quiet real-world mics still drive the visuals); derives
  smoothed bass/mid/treble/level bands plus **tempo tracking by envelope
  autocorrelation**: every frame records an onset-strength sample (spectral
  flux); every 2s the last ~8s of that envelope is autocorrelated over the
  70–180 BPM range (with harmonic scoring and parabolic refinement) to find
  the tempo, and a comb filter finds the beat *phase*. A phase-locked
  metronome then fires perfectly regular beats on that grid — robust with
  real microphones, where individual kick attacks are too smeared to detect
  reliably. Several visualizations pump with the beat phase (tempo-locked)
  rather than a fixed decay.
- `js/visualizations/*.js` — each visualization is a small class with a
  `draw({ctx, audio, w, h, dt, t})` method; add your own and register it in
  `js/main.js`.
- The Meme Cycle scene rotates through `assets/memes/playlist.json`. Animated
  GIFs are decoded with a hand-rolled GIF89a/LZW decoder (`js/lib/gif.js`)
  into independent frames, then *scrubbed* to the beat: each loop is pinned to
  an even number of beats and each beat advances it by exactly one beat's
  worth, so footfalls stay on rhythm even as tempo drifts. Each meme holds
  for its `beats` count, then the next beat hard-cuts to a random other meme.
  Animated GIFs only — single-frame files are skipped with a console
  warning. **Add your own:** drop an animated GIF into `assets/memes/` and
  add a line to `playlist.json`.
- Shuffle mode (`S` or the control-bar button) hops to a random visualization
  every 64 beats — 16 bars — with a 40s fallback when no beats are detected.
