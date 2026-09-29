# Booth model (optional)

The club's room view shows the DJ booth. Without a model file it uses built-in
procedural gear, so nothing breaks if this folder stays empty.

To use the CC BY 4.0 low-poly CDJ + mixer model by **MaxTht**:

1. Sign in to https://sketchfab.com (a free account is enough — downloads need a login).
2. Open https://sketchfab.com/3d-models/pioneer-cdj-3000-7a33aaa799044e0db082f3b2b038c328
3. Click **Download 3D Model** and choose **glTF Binary (.glb)** (the "Autoconverted format" section).
4. Save the file here as `content/models/booth.glb`.
5. Run `npm run models` (it also runs automatically before `npm run dev` and `npm run build`).
   It writes `public/models/booth.glb` with **every texture removed** (the originals carry
   logos, which this site must not show or serve) plus `public/models/models.json`.
6. Open `/dj`, press **Tab** (or VIEW) and look at the booth:
   - The units should read CDJ | MIXER | CDJ with the screens facing the crowd. The loader
     finds the parts by node name (`/cdj/i` and `/djm|mixer|900/i`, see
     `src/dj/club/gear/gearModel.ts`). If the file names them differently, change
     `CDJ_NAME` / `DJM_NAME`. If no split is possible, the whole model is fitted to the booth.
   - If the units face the wrong way, set `MODEL_ROTATION_Y` (radians, e.g. `Math.PI`).
   - To see node names, drop the file on https://gltf-viewer.donmccurdy.com.
7. Keep the attribution in `CREDITS.md` — CC BY 4.0 requires it.

`content/models/*.glb` is git-ignored so the original (with its logo textures) never lands in
the repository. To ship the model to a deployment, commit only the stripped copy:

    npm run models
    git add -f public/models/booth.glb

`scripts/copy-models.ts` reuses an existing stripped `public/models/booth.glb` when the
source file is absent (e.g. on CI).
