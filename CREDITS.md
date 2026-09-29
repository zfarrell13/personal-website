# Credits

Third-party assets and libraries used in this project. Added to as assets are integrated.

- three.js — MIT
- Fonts: Russo One, VT323 — SIL Open Font License (Google Fonts)
- esbuild, zustand, glTF-Transform — MIT.

## Surf game

- Surfer model: "Animated Human" by Quaternius — CC0 1.0 (public domain).
  https://poly.pizza/m/c3Ibh9I3udk (file `public/surf/surfer.glb`, unmodified; recolored at runtime).
- Crowd hoots, ocean ambience, board spray, tube whoosh and trick stingers are synthesized
  procedurally with the Web Audio API — no samples.
- Board, wave, environment and particles are procedural.

## DJ booth

- **Signalsmith Stretch** (`signalsmith-stretch` 1.3.2) by Geraint Luff / Signalsmith Audio — MIT. Master Tempo (key lock) in the DJ booth.
- **Low-poly CDJ-3000 + DJM-900NXS2 model** by MaxTht — https://sketchfab.com/3d-models/pioneer-cdj-3000-7a33aaa799044e0db082f3b2b038c328 — licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changes: all textures (including logos) removed, flat recoloured materials, the CDJ duplicated and re-arranged into a two-deck booth, control overlays added. Used only when `content/models/booth.glb` is present. No endorsement by the author or by the hardware manufacturer is implied; product names belong to their owners.
- DJ hardware behaviour is implemented from the manufacturer's public operating manuals; no code, firmware or artwork was copied.
