# Lock In — Photo Booth

A browser-based photo booth: capture a 6-shot burst from your webcam, pick your favorite 4, choose a frame, and download a printable photo strip. No backend — everything runs client-side with `getUserMedia` and `<canvas>` compositing.

<!-- Add a screenshot or short GIF of the app here before publishing -->

## How it works

1. **Start** — tap "Initiate Booth". Frame images load automatically from `/frames/` and the browser asks for camera permission — no file upload.
2. **Capture** — a 6-photo burst with a 3-second countdown and flash between each shot.
3. **Select** — pick 4 of the 6 photos to keep.
4. **Choose a frame** — preview thumbnails are generated live for every frame in `app.js`.
5. **Download** — the final strip is composited on a `<canvas>` and offered as a PNG download.

## Project structure

```
index.html
style.css
app.js
assets/
  booth-logo.png
  bg-pattern.png
frames/
  lucky-green-base.png
  lucky-green-overlay.png
  midnight-sky-base.png
  cloud-dancer-base.png
  ...
```

- `assets/` holds static UI images (logo, background) referenced directly in `index.html`/`style.css`.
- `frames/` holds the frame template PNGs, loaded automatically at startup by `app.js`. This folder must be committed to the repo (or otherwise present on disk) — cloning the project and running a static server is all that's needed to see the frames; no upload step required.

## Adding or renaming a frame

Frame filenames are derived from the frame's `name` in the `FRAMES` array in `app.js`, lowercased and with non-alphanumeric characters collapsed to hyphens (see `slugify()`):

| Frame name | Expected files |
| --- | --- |
| `"Lucky Green"` | `frames/lucky-green-base.png`, `frames/lucky-green-overlay.png` |
| `"Midnight Sky"` | `frames/midnight-sky-base.png` |
| `"Static & Stars"` | `frames/static-stars-base.png`, `frames/static-stars-overlay.png` |
| `"Saan?"` | `frames/saan-base.png`, `frames/saan-overlay.png` |

To add a new frame:

1. Add `{ name: "Your Frame Name", price: "PHP 40" }` to `FRAMES` in `app.js`.
2. Drop `frames/your-frame-name-base.png` (and, if needed, `-overlay.png`) into the `frames/` folder.
3. Reload — no other code changes needed. The overlay file is optional; if it's not present, the frame is rendered with just the base.

If you'd rather keep a filename independent of the display name (e.g. after renaming a frame but not wanting to rename its file), add an explicit `slug` field to that frame's entry: `{ name: "New Name", slug: "old-slug", price: "..." }`.

`base` is drawn first (this is what shows through empty photo slots), photos are composited on top, then `overlay` (if present) is drawn last — useful for frames with borders/text that sit in front of the photos.

Frame templates are expected at 1600×4800px, with photo slots defined in the `SLOT` constant in `app.js`. If you use differently-sized templates you'll need to re-measure those numbers.

## Migrating from the old numbered-file scheme

Earlier versions of this project required manually uploading a folder at runtime, with frames keyed by numeric IDs (`1.png`, `2.png`, ...) mapped to names via `base`/`overlay` fields in `FRAMES`. If you have PNGs in that old format, run the included one-time migration script to rename them:

```bash
node migrate-frame-assets.js ./assets ./frames
```

This copies each old numbered file to its new slug-based name in `frames/`. Review the output, then delete the old numbered files. New frames added after migrating don't need this script.

## Running locally

This is a static site — no build step. Clone the repo (with the `frames/` folder included) and serve it with any static file server, e.g.:

```bash
npx serve .
```

Camera access requires either `localhost` or HTTPS; it will not work over a plain `http://` connection to a non-localhost address.

## Known limitations

- No persistence — refreshing mid-session loses captured photos.

## License

MIT — see `LICENSE`.
