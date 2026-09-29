# DJ Booth (Dark Mode) — Design

Date: 2026-09-29 · Status: approved in brainstorming, pending spec review
Depends on: `2026-09-29-foundation-design.md`

A fully functional virtual booth — **2 × CDJ-3000 + DJM-900NXS2** — inside a
PS2-style low-poly club whose crowd and lights react to the mix. Loads the
user's own productions. Behavior is implemented from Pioneer's public
operating manuals (no reverse engineering, no copied code). Layout is
faithful; Pioneer logos/branding are **not** reproduced.

## Research outcome (why we build rather than fork)

No open-source, fully functional browser CDJ-3000/DJM-900NXS2 exists.
VRChat "CDJs" are visual props mirroring real controllers (e.g. UDJ-1000);
Tribe XR is proprietary; web "simulators" are thin demos; the most complete
browser DJ repos are either unlicensed or generic-UI. We reuse:
- **Signalsmith Stretch** (`signalsmith-stretch`, MIT, WASM/AudioWorklet) for
  Master Tempo (key lock).
- **CC-BY 4.0 low-poly CDJ-3000 + DJM-900NXS2 model** by MaxTht (Sketchfab)
  for the room view, re-textured without logos, credited.
- `Pandiyarajk/dj` (MIT) as a reference only.

## Audio architecture (`src/dj/engine/`)

```
Deck 1: DeckWorklet ─┬─ dry (DelayNode = stretch latency) ─┐
                     └─ StretchNode (semitones) ───────────┴─ MT crossfade ─► Channel 1 strip
Deck 2: (same)                                                               ► Channel 2 strip
Channel strip: Trim → Isolator EQ (LR4 3-band) → Color FX → CUE tap → Channel fader → XF assign
Mixer bus: Σ channels via crossfader → Beat FX (insert on selected channel or master) → Master level
         → Limiter (DynamicsCompressor + soft clip) → destination
Headphone bus: Σ CUE taps (+ master per CUE/MASTER mix) → HeadphoneOutput
Analysers: per-channel + master (meters, club reactivity, LED wall FFT)
```

- `AudioContext({ latencyHint: 'interactive' })`, created on first user gesture.
- **DSP core is pure TypeScript classes** (no Web Audio types), wrapped by thin
  AudioWorkletProcessors. The core is unit-tested in Node.

### Deck engine (DeckWorklet + `DeckCore`)
- Holds decoded stereo PCM (transferred once via `postMessage`).
- Playhead: float sample position advanced by `rate` per sample, where
  `rate = tempo × (1 + pitchBend) × motor` (or the jog-driven rate while scratching);
  4-point cubic Hermite interpolation.
- **Motor model** (CDJ vinyl feel): play/pause ramps the motor with adjustable
  start/stop times (VINYL SPEED ADJ touch/release), default ~0.15 s.
- **Tempo:** slider value × range (±6 / ±10 / ±16 / WIDE = ±100%), 0.01%
  resolution at ±6, TEMPO RESET.
- **Jog** (host sends angular velocity + touch state at input rate):
  - VINYL mode, top touched → scratch: the rate follows the jog angular velocity
    (one full rotation = 1.8 s of audio, matching a 33⅓ rpm feel), smoothed
    with a one-pole filter to avoid zipper noise. Releasing hands back to the motor.
  - CDJ mode, or the outer ring → pitch bend proportional to velocity, decaying.
  - JOG ADJUST sets the platter weight (inertia of the jog visual and
    release behavior).
- **CUE** (per manual): paused → sets the cue point at the current position
  (quantized if QUANTIZE is on). Playing → returns to the cue and pauses.
  Holding CUE while at the cue plays; release returns to the cue and pauses.
  CUE + PLAY continues playback.
- **Hot cues A–H**: empty pad → store (quantized) with a color; filled pad →
  jump (and play if playing). SHIFT + pad clears. Stored per track in memory
  and localStorage.
- **Memory cues** from `tracks.json`, with CALL ◄/► buttons.
- **Loops:** LOOP IN / OUT, RELOOP/EXIT, 4-BEAT and 8-BEAT auto loops,
  ½X / 2X (1/16 … 32 beats), all quantize-aware. The loop wrap happens inside
  the worklet, so it is sample-accurate.
- **Beat jump** (default 4 beats; the size is adjustable on screen), **REVERSE**,
  **SLIP** (a shadow playhead keeps advancing during scratch, loop, reverse and
  hot-cue holds; releasing returns to the shadow position), **QUANTIZE**
  (snaps actions to the nearest beat; the resolution is set on screen).
- **Needle search:** touch or drag on the screen's overview waveform.
- **Track end:** stops at the end; the screen shows a flashing "END" warning in
  the last 30 s.
- **Telemetry:** position, rate, beat index and phase, and loop state are
  posted about 60 times per second into a mutable `DeckTelemetry` object.
  React never re-renders on this path.

### Master Tempo (key lock)
- `StretchNode` = Signalsmith Stretch in **live-input mode** with
  `semitones = −12 · log2(rate)`, so the variable-speed deck output is shifted
  back to its original key.
- The dry path is delayed by `stretch.latency()` so switching between wet and
  dry is time-aligned. The MT toggle does a 20 ms equal-power crossfade.
- While scratching or reversing, the engine auto-crossfades to dry (as the real
  deck does) and returns when released.
- Displayed position and sync phase subtract the output latency.
- **Fallback:** if the WASM fails to load, MT is disabled with a notice.

### Beat sync
- A master deck is chosen explicitly with MASTER, or automatically as the first
  playing deck.
- SYNC on the follower:
  - Sets tempo to the master's BPM, promoting the tempo range to WIDE if
    needed.
  - Aligns the beat phase using the exact beatgrids.
- A phase-locked loop trims the follower's rate (≤ ±0.5%, invisible on the
  tempo display) to hold the phase error below 1 ms and cancel numeric drift.
- Moving the tempo fader while synced changes the master tempo (the
  CDJ-3000's BEAT SYNC behavior). Pressing SYNC while it is lit turns it off.

### Mixer (`MixerCore` + native nodes where cheaper)
- **TRIM:** −∞ … +9 dB.
- **Isolator EQ:** HI / MID / LOW −∞ (kill) … +6 dB. Built as LR4 crossovers
  at 250 Hz / 3 kHz (cascaded biquads) with per-band gain, so kill is a true
  kill.
- **Color FX** (one active type, applied per channel by its knob; the knob
  centre = off):
  - SPACE (reverb send), DUB ECHO, SWEEP (gate/band), NOISE (filtered
    white noise), CRUSH (bit/sample-rate reduction), FILTER (LPF left /
    HPF right, resonant). PARAMETER knob.
- **Channel faders** and **crossfader:** 3 curves each; per-channel XF assign
  A / THRU / B.
- **Beat FX** (synced to the master deck's BPM):
  - Types: DELAY, ECHO, PING PONG, SPIRAL, REVERB, TRANS, FILTER, FLANGER,
    PHASER, PITCH, SLIP ROLL, ROLL, VINYL BRAKE, HELIX.
  - Beat divisions ◄/► (1/8 … 16 beats), FX channel select (1, 2, XF-A,
    XF-B, MASTER), LEVEL/DEPTH, ON/OFF.
  - Time-based FX quantize to the beat.
- **Master:** MASTER LEVEL, stereo peak meters with hold (LED ladder), and a
  limiter so the browser output never clips.
- **Headphones:**
  - CUE buttons on channels 1 and 2 and the master, plus CUE/MASTER MIX,
    HEADPHONES LEVEL, and a SPLIT / STEREO mode.
  - `HeadphoneOutput`: if the browser supports `HTMLMediaElement.setSinkId`
    and the user picks a second device in Settings, the headphone bus is sent
    through a `MediaStreamAudioDestinationNode` to that device.
  - Otherwise, SPLIT mode on the main output: cue left, master right.

## Track loading
- Library = shared `manifest.json` (5–15 tracks, BPM/key known).
- Loading fetches `audio.m4a`, calls `decodeAudioData`, and transfers the PCM to
  the deck worklet. `waveform.bin` / `overview.bin` are fetched in parallel,
  so the waveforms show before decoding finishes.
- Loading onto a deck that is playing **and** on air (its fader up) shows a
  "DECK ON AIR — tap again to load" confirmation.
- Decoded tracks are cached in memory (LRU, up to 4) so reloading is instant.

## UI (`src/dj/ui/`)

Single source of truth: the `useDjStore` zustand store holds every control
position and toggle. The engine subscribes and applies changes. Telemetry
(positions, levels) goes through mutable objects read by rAF loops.

### Two views of the same state
- **Close-up (default play view):** a crisp, top-down, DOM/SVG + Canvas2D
  rendering of CDJ 1 | DJM | CDJ 2 at native resolution. It is not passed
  through the low-res PS2 filter, and it is styled like the hardware (dark
  panels, rubber pads, LED colors). The club stays visible, dimmed, around
  and behind the gear.
- **Room view:** the PS2 3D club with the 3D gear. The knob and fader meshes
  follow the store, and the CDJ screens and jog displays are `CanvasTexture`s
  sharing the same canvases.
- Tab or the on-screen VIEW button switches with a camera dolly (0.8 s).

### CDJ-3000 screen (Canvas2D, 60 fps)
- **Main view:** a scrolling 3-band detail waveform (low blue, mid amber, high
  white) with a playhead, beat grid ticks, hot cue and loop markers, and zoom
  (±).
- Also on the main view: an overview waveform with the played region greyed
  and needle search, BPM, tempo %, range, MT indicator, key, elapsed and
  remaining time, beat countdown to the next memory cue, and the MASTER/SYNC
  state.
- **Jog display:** artwork in the centre, a rotating position indicator, and a
  cue marker.
- **BROWSE (large and easy to see, as the user asked):**
  - The deck's screen expands into an overlay about 70% of the viewport, with
    the camera zooming toward that deck in room view.
  - Rows are 96 px tall, each with artwork, title, artist, BPM, key and
    duration.
  - Sortable by title, BPM or key. A badge shows tracks loaded on the other deck.
  - Tapping a row loads it, then the overlay closes.

### Interaction
- Pointer Events throughout (mouse, pen, multi-touch). For example, you can
  hold the jog with one finger while moving a fader with another.
- Knobs: vertical drag (with SHIFT for fine control), the wheel adjusts, and
  double-click resets to the default. The centre detent is magnetic (±2%).
- Faders drag, and a click on the track jumps them.
- Jog: pointer down on the top plate = touch. Angular velocity comes from
  pointer angle deltas about the centre, sent to the worklet each frame.
  Dragging on the outer ring = pitch bend.
- Buttons light like the real LEDs (PLAY blinks when paused, CUE blinks when a
  cue is set, and so on).
- **Mobile (basic, landscape):** three swipeable panels (CDJ 1 · MIXER · CDJ 2),
  full-size touch targets, and no room view by default (it is available from
  the VIEW button).

## The show (`src/dj/club/`)

- A PS2-style low-poly club rendered with the shared `RetroRenderer`: the
  booth riser, speaker stacks, a truss, an LED wall behind the booth, and a
  dance floor.
- **Crowd:** about 150 instanced low-poly dancers.
  - A vertex-shader bounce is driven by uniforms: `beatPhase` (master deck),
    `energy`, and per-dancer random offsets.
  - Hands go up on the "drop" event.
- **Energy model** (`ClubDirector`), reading master analysers and mixer state:
  - `energy` = smoothed low-band RMS.
  - `tension` rises with filter sweeps (Color FX FILTER away from centre), a
    low-EQ cut on the playing channel, and rising Beat FX depth.
  - The **drop** fires when tension is released while energy returns. It
    triggers a strobe burst, a crowd jump, and CO₂-jet sprites.
- **Lights:** moving heads (cone sprites) sweep on the bar phrase, strobes on
  beats when energy is high, and lasers on high tension. Everything is locked
  to the master beat phase.
- **LED wall:** a fragment shader driven by an FFT texture from the master
  analyser, with palette changes per track (derived from the artwork's
  dominant colour).
- **Idle:** with no deck playing, the crowd idles and the lights run a slow
  ambient chase.

## Performance targets
- There are no audio dropouts at 60 fps UI on an M1 MacBook Air. The audio
  thread does no allocation per block.
- Close-up UI: waveforms at 60 fps, and fewer than 20 React re-renders per
  second during normal play.
- Room view: 60 fps desktop, ≥ 30 fps mobile.

## Testing
- **Vitest, DeckCore:**
  - Hermite interpolation accuracy.
  - The CUE state machine (every manual case).
  - Hot-cue store, jump and quantize.
  - Loop wrap is sample-accurate.
  - Slip shadow position.
  - Reverse, and motor ramps.
  - Scratch rate follows jog velocity.
- **Vitest, sync:**
  - Tempo match.
  - Phase alignment.
  - The PLL converges below 1 ms within 2 s and stays there over 10 min of
    simulated playback.
- **Vitest, MixerCore:**
  - EQ kill: a band's own path is exactly zero; sines far from the
    neighbouring crossovers are > 60 dB down (a 1 kHz tone with MID killed is
    ≈ −40 dB due to LR4 neighbour skirts).
  - Crossfader curves.
  - Beat FX delay times match the BPM and division.
- **Playwright:**
  - `/dj` boots, a test track loads via BROWSE, and PLAY advances the
    position (read via a `window.__dj` debug hook).
  - SYNC matches BPM.
  - No console errors.

## Out of scope
Web MIDI, mix recording, keyboard shortcuts, Auto-DJ, four decks, stems,
visitor-uploaded files, and online anything.

## Inputs needed from the user
Track masters with exact BPM, key, first downbeat, artwork, optional memory
cues, and which tracks to include in the surf soundtrack.
