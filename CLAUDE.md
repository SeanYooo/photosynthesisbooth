# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Lock In — Photo Booth**: zero-backend, client-side webcam photo booth. Capture a 6-shot burst, pick 4, choose a frame, download a printable strip. Pure static site — `index.html` + `style.css` + `app.js`, no framework, no build step, no `package.json`. Live at `https://seanyooo.github.io/photosynthesisbooth/`.

## Run / verify

```bash
# run locally (camera needs localhost or HTTPS; never file://)
npx serve .                # or python3 -m http.server 8000
# then open http://localhost:8000/ (or :3000)

node --check app.js        # syntax check — the only "test" there is
```

No lint, no test suite, no CI. To confirm an app.js change in the real app: serve locally and walk the flow (Initiate → camera → burst → select → frame → download); camera cannot be verified headlessly.

## Architecture — the parts that span files

Flow: `beginSetup()` (camera) → `startBooth()` → burst in `startBtn.onclick` → `setupSelection()` (pick 4) → `confirmPhotosBtn.onclick` (frame grid) → `generateFinal()` (export). Screens in `index.html` are `.screen` divs toggled by `showScreen()` in `app.js:99`.

**Frame naming is the key invariant.** `FRAMES` in `app.js:40` is the single source of truth. A frame's files are derived by `slugify()` (lowercase, non-alphanumeric runs → single hyphen) from its `name`, or from an explicit `slug` field: `frames/<slug>-base.png` (required) + `frames/<slug>-overlay.png` (optional). 30 frames / 54 full PNGs on disk. To add a frame: add an entry to `FRAMES`, drop the 1600×4800 PNGs, and regenerate its `frames/thumbs/` previews.

**`SLOT` (`app.js:22`)** pins export geometry: `canvasWidth 1600 × canvasHeight 4800`, `photoWidth 1350 × photoHeight 1007`, `startY 510`, `gap 35`. The 54 full PNGs are now exactly 1600×4800 to match — the exporter never uses more than this. `drawToCanvas()` stretches whatever image it gets to the target canvas size, so templates must be measured against `SLOT`; differently-sized templates need `SLOT` re-measured.

**Layer order everywhere is: base → photos → overlay.** The overlay sits *on top of* the photo slots (e.g. Kapow's POW!/ZAP art). `generateFinal()` renders at full 1600×4800; `drawToCanvas()` is shared by the final export. This order once got inverted in the preview — don't reintroduce that.

**Thumbnails carry the loading performance.** `frames/thumbs/<slug>.webp` (400×1200 base) and `<slug>-overlay.webp` (24 of 30) exist so the frame grid preview downloads ~1.3 MB instead of the full 75 MB of PNGs. `getFrameThumb()` (`app.js:225`) loads them as a `{base, overlay}` pair; the grid draws base → user's 4 photos → overlay thumb. The full-size `getFrameAssets()` loads a frame's PNGs **only when the user picks it** (finalize). Dead code: `preloadAllFrames()` is no longer called — don't re-add eager preloading.

**Capture.** `getUserMedia({width:1920,height:1080})` → `video.videoWidth × video.videoHeight` (16:9 in practice; 640×480 fallback). `capturePhotoSource()` (`app.js:116`) tries `ImageCapture.takePhoto()` first, then falls back to a canvas grab. Export uses `toBlob()` → `URL.createObjectURL` for the download link. `startNewSession()` revokes those object URLs and reloads.

## Quirks worth knowing

- `og-image.png` and `linkedin-post.md` are on `perf/loading` but `og-image.png` is a **draft awaiting owner review** — its meta tags are in `index.html` pointing at `https://seanyooo.github.io/photosynthesisbooth/og-image.png`.
- Root `bg pattern.png` and `booth-logo.png` duplicate `assets/` versions (identical bytes). Nothing references them. Deleting is the owner's call — do not delete without asking.
- `migrate-frame-assets.js` is a one-time script for the pre-slug/numbered-file scheme. Not part of the runtime.
