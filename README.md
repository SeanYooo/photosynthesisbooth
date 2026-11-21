# Lock In — Photo Booth

A browser-based photo booth that turns a webcam burst into a printable photo strip. No backend — everything runs in the browser with `getUserMedia` and `<canvas>`.

**Live demo:** https://seanyooo.github.io/photosynthesisbooth/

<!-- Screenshot or short GIF of the app — drop a file at docs/screenshot.png and replace this line with ![Screenshot](docs/screenshot.png) -->

## Features

- 6-shot burst with a 3-second countdown and flash between shots
- Pick 4 of 6 photos to keep
- 30 frame designs with live preview thumbnails
- Download the final strip as a full-resolution PNG (1600×4800)
- No uploads, no server — photos never leave the browser

## How it works

1. **Start** — tap *INITIATE BOOTH*. The browser asks for camera permission.
2. **Capture** — a 6-photo burst with a countdown and flash.
3. **Select** — pick 4 of the 6 photos.
4. **Choose a frame** — preview thumbnails load only at this step; the full-size frame downloads only for the one you pick.
5. **Download** — the final strip is composited on a `<canvas>` and offered as a PNG.

## Running locally

This is a static site — no build step. Clone the repo (with the `frames/` folder included) and serve it with any static file server, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Camera access requires either `localhost` or HTTPS. It will not work over a plain `http://` connection to a non-localhost address, and opening `index.html` directly from disk is not supported.

## Tech used

- Vanilla JavaScript (`app.js`)
- `getUserMedia` (webcam capture, with `ImageCapture` fallback to `<canvas>`)
- `<canvas>` compositing for the strip export
- Plain HTML and CSS, no framework, no build tooling

## Project structure

```
index.html
style.css
app.js
assets/
  booth-logo.png
  bg-pattern.png
frames/
  <slug>-base.png          # full-size frame, 1600×4800
  <slug>-overlay.png       # optional, drawn on top
  thumbs/
    <slug>.webp              # 400×1200 base preview
    <slug>-overlay.webp     # 400×1200 overlay preview (when present)
```

## Adding a frame

Frame filenames are derived from the `name` in the `FRAMES` array in `app.js` by `slugify()` — lowercased, non-alphanumeric runs collapsed to hyphens. To add one, add `{ name: "Your Frame" }` to `FRAMES`, drop `frames/your-frame-base.png` (and `-overlay.png` if needed) at 1600×4800, and generate the matching `thumbs/` previews. The overlay is optional; frames without one render with just the base.

## What I built and learned

I built this as a small, focused web app with no framework — all the image work happens on HTML canvas elements and the browser's media APIs do the rest. Two issues were worth fixing properly instead of patching around. First, the app was downloading all 54 full-size frame PNGs up front; I moved to small 400×1200 preview thumbs and only fetch the chosen frame at full size. Second, the preview had its layer order wrong — overlay art that overlaps a photo slot was drawn under the photos instead of on top, which I caught by comparing the grid against the final export and fixed in the thumbnail pipeline. I also resized the frame art to exactly the 1600×4800 size the export actually uses and recompressed the PNGs, which cut the frame payload by more than half.

## Known limitations

- No persistence — refreshing mid-session loses captured photos.

## License

MIT.
