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
| 2 | Oscilloscope | Neon glowing waveform trace |
| 3 | Radial Burst | Spectrum fan around a pulsing waveform ring |
| 4 | Psychedelic Feedback | Milkdrop-style zoom/rotate feedback tunnel |
| 5 | Beat Fireworks | Particle bursts on every detected beat |
| 6 | Starfield Warp | Hyperspace star streaks, speed follows the music |
| 7 | Pulse Rings (BPM) | Beat-emitted rings paced to the bar, metronome core with a live BPM readout |
| 8 | Two-Step Meme | The classic two-stepping GIF, playback locked to the beat; pauses when the music stops |
| 9 | Toon Dancers (3D) | Three chunky 3D cartoon dancers two-stepping on beat, disco floor + mirror ball |

## Controls

| Input | Action |
|-------|--------|
| `←` / `→` | Previous / next visualization |
| `1`–`9` | Jump to a visualization |
| `B` | Toggle the live BPM readout overlay |
| `F` or double-click | Toggle fullscreen |
| `H` | Hide/show the control bar |
| Sensitivity slider | Boost or tame the response for quiet/loud rooms |

The control bar and cursor auto-hide after 3 seconds of no mouse movement.

## How it works

- `js/audio.js` — Web Audio `AnalyserNode` over the mic stream (behind an
  auto-gain stage so quiet real-world mics still drive the visuals); derives
  smoothed bass/mid/treble/level bands plus **beat detection** (bass-energy
  flux vs. a rolling average) and a **periodic tempo estimator**: every 2s the
  last ~12s of beat onsets are octave-folded into 70–180 BPM and clustered,
  and the tightest cluster sets `bpm`/`beatInterval`, so tempo changes are
  tracked within a few seconds. Several visualizations pump with the beat
  *phase* (tempo-locked) rather than a fixed decay.
- `js/visualizations/*.js` — each visualization is a small class with a
  `draw({ctx, audio, w, h, dt, t})` method; add your own and register it in
  `js/main.js`.
- The Two-Step Meme scene decodes `assets/two-step.gif` with a hand-rolled
  GIF89a/LZW decoder (`js/lib/gif.js`) into independent frames, then *scrubs*
  playback to the beat: the loop is pinned to an even number of beats and each
  detected beat advances it by exactly one beat's worth, so the footfalls stay
  on rhythm even as tempo drifts. Swap in any looping GIF at that path.
- The Toon Dancers scene uses a tiny hand-rolled 3D pipeline (perspective
  projection + painter's-algorithm depth sort) — no WebGL or libraries.
