/**
 * Lock In Photo Booth
 *
 * Frame assets are loaded automatically from /frames/ on startup — no
 * manual upload step. Each frame in FRAMES needs a "base" PNG (drawn under
 * the photos) and optionally an "overlay" PNG (drawn on top).
 *
 * Filenames are derived from the frame's `name` (or an explicit `slug`,
 * see getFrameSlug below):
 *   frames/<slug>-base.png
 *   frames/<slug>-overlay.png   (optional — silently skipped if missing)
 *
 * "assets/booth-logo.png" and "assets/bg-pattern.png" are referenced
 * directly in index.html / style.css and don't go through this pipeline.
 *
 * Photo slot geometry (SLOT) is expressed relative to a 1600x4800 canvas,
 * i.e. a 4-photo strip printed at 1600px wide. It was measured against the
 * frame template PNGs, so if you swap in differently-sized templates you'll
 * need to re-measure these numbers.
 */

const SLOT = {
    canvasWidth: 1600,
    canvasHeight: 4800,
    photoWidth: 1350,
    photoHeight: 1007,
    startY: 510,
    gap: 35,
};

const FRAME_ASSET_DIR = "frames/";

// Single source of truth for frames: name and price. The base/overlay PNGs
// are resolved automatically from `name` (see getFrameSlug) — add a new
// frame by adding an entry here and dropping matching PNGs into /frames/,
// no other wiring required. Set an explicit `slug` only if you need the
// filename to differ from the auto-generated one (e.g. to avoid a
// collision, or to keep an existing filename when renaming a frame).
const FRAMES = [
    { name: "Lucky Green", price: "PHP 30" },
    { name: "Midnight Sky", price: "PHP 30" },
    { name: "Cloud Dancer", price: "PHP 30" },
    { name: "Pacific Breeze", price: "PHP 30" },
    { name: "Kanibalismo II", price: "PHP 40" },
    { name: "Eternal Sunshine", price: "PHP 40" },
    { name: "Urban Steel", price: "PHP 40" },
    { name: "Pastel Pony", price: "PHP 40" },
    { name: "Dream Atlas", price: "PHP 40" },
    { name: "Static & Stars", price: "PHP 40" },
    { name: "Neon Summer", price: "PHP 40" },
    { name: "IVOS", price: "PHP 40" },
    { name: "Chrome Forever", price: "PHP 40" },
    { name: "Stay Grounded", price: "PHP 40" },
    { name: "Lost & Found Season", price: "PHP 40" },
    { name: "Citrus Punch", price: "PHP 40" },
    { name: "Midnight Sun", price: "PHP 40" },
    { name: "Quick & Cute", price: "PHP 40" },
    { name: "Rose Static", price: "PHP 40" },
    { name: "Alaala", price: "PHP 40" },
    { name: "Saan?", price: "PHP 40" },
    { name: "Kapow!", price: "PHP 40" },
    { name: "STEMAZING", price: "PHP 40" },
    { name: "Humanista", price: "PHP 40" },
    { name: "Kapitalista", price: "PHP 40" },
    { name: "Snorkle", price: "PHP 40" },
    { name: "Y2K Wallpaper", price: "PHP 40" },
    { name: "Stars", price: "PHP 40" },
    { name: "Bleed Crimson", price: "PHP 40" },
    { name: "Luxe Velvet", price: "PHP 40" },
];

const PHOTOS_PER_SESSION = 6;
const PHOTOS_TO_KEEP = 4;
const FRAME_SELECTION_SECONDS = 60;

let capturedPhotos = [];
let selectedPhotoIndices = [];
let selectedFrame = null;
let cameraStream = null;
let frameSelectionInterval = null;
let createdObjectUrls = [];

// Cache of loaded frame images, keyed by slug: slug -> { base, overlay }.
// Populated once by preloadAllFrames() on startup; getFrameAssets() falls
// back to loading on-demand if a frame is ever requested before that
// finishes (defensive — shouldn't normally happen).
const frameAssetCache = new Map();

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const captureCanvas = document.createElement("canvas");
const captureCtx = captureCanvas.getContext("2d");

if (window.location.protocol === "file:") {
    console.warn("Opening index.html directly from disk is not supported for camera-based features.");
}

function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    window.scrollTo(0, 0);

    if (id === "frameSelection") {
        startFrameSelectionTimer();
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
    }
}

async function capturePhotoSource() {
    const videoTrack = cameraStream?.getVideoTracks?.()[0];

    if (typeof window.ImageCapture !== "undefined" && videoTrack) {
        try {
            const imageCapture = new ImageCapture(videoTrack);
            const blob = await imageCapture.takePhoto();
            const objectUrl = URL.createObjectURL(blob);
            createdObjectUrls.push(objectUrl);
            return objectUrl;
        } catch (err) {
            console.warn("ImageCapture failed, falling back to canvas capture", err);
        }
    }

    captureCanvas.width = video.videoWidth || 640;
    captureCanvas.height = video.videoHeight || 480;
    captureCtx.save();
    captureCtx.translate(captureCanvas.width, 0);
    captureCtx.scale(-1, 1);
    captureCtx.drawImage(video, 0, 0);
    captureCtx.restore();
    return captureCanvas.toDataURL("image/png", 1.0);
}

function showCameraError(message) {
    const el = document.getElementById("cameraError");
    el.textContent = message;
    el.style.display = "block";
}

function startFrameSelectionTimer() {
    let timeLeft = FRAME_SELECTION_SECONDS;
    const timerEl = document.getElementById("frameTimer");
    timerEl.innerText = `${timeLeft}s`;

    if (frameSelectionInterval) clearInterval(frameSelectionInterval);
    frameSelectionInterval = setInterval(() => {
        timeLeft--;
        timerEl.innerText = `${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(frameSelectionInterval);
            if (!selectedFrame) selectedFrame = FRAMES[0];
            generateFinal();
        }
    }, 1000);
}

/**
 * Turns a frame name into a filename-safe slug:
 * "Static & Stars" -> "static-stars", "Saan?" -> "saan", "IVOS" -> "ivos".
 */
function slugify(str) {
    return str
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // strip accents
        .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric runs -> single hyphen
        .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens
}

function getFrameSlug(frame) {
    return frame.slug || slugify(frame.name);
}

/**
 * Loads the base/overlay PNGs for a single frame from /frames/ and caches
 * them by slug. The overlay is optional: if "<slug>-overlay.png" doesn't
 * exist, loadImage() resolves null instead of throwing, so frames without
 * an overlay work with zero extra configuration.
 */
async function loadFrameAssets(frame) {
    const slug = getFrameSlug(frame);
    const basePath = `${FRAME_ASSET_DIR}${slug}-base.png`;
    const overlayPath = `${FRAME_ASSET_DIR}${slug}-overlay.png`;

    const [base, overlay] = await Promise.all([loadImage(basePath), loadImage(overlayPath)]);

    if (!base) {
        console.warn(
            `Missing frame asset for "${frame.name}". Expected a file at ` +
                `${basePath} — check the filename matches the frame name/slug.`
        );
    }

    const assets = { base, overlay };
    frameAssetCache.set(slug, assets);
    return assets;
}

/** Loads every frame's assets in parallel. Call once on startup. */
function preloadAllFrames() {
    return Promise.all(FRAMES.map(loadFrameAssets));
}

/** Returns the cached { base, overlay } for a frame, loading it first if needed. */
async function getFrameAssets(frame) {
    const slug = getFrameSlug(frame);
    if (!frameAssetCache.has(slug)) {
        await loadFrameAssets(frame);
    }
    return frameAssetCache.get(slug);
}

/**
 * Kicks off the booth: preload all frame images and request camera access
 * in parallel, then move to the ready screen. Triggered by a user gesture
 * (the home screen button), which getUserMedia requires.
 */
async function beginSetup() {
    showScreen("initScreen");

    try {
        const [, stream] = await Promise.all([
            preloadAllFrames(),
            navigator.mediaDevices.getUserMedia({
                video: { width: 1920, height: 1080 },
            }),
        ]);
        cameraStream = stream;
        video.srcObject = cameraStream;
        setTimeout(() => showScreen("readyPrompt"), 1000);
    } catch (err) {
        console.error("Setup error", err);
        showCameraError(
            "Couldn't access your camera. Please allow camera permissions and reload the page."
        );
        showScreen("initScreen");
    }
}

function startBooth() {
    showScreen("booth");
}

function triggerFlash() {
    const flash = document.getElementById("flash");
    flash.classList.remove("active");
    flash.style.opacity = "1";

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flash.classList.add("active");
            flash.style.opacity = "0";
        });
    });
}

document.getElementById("startBtn").onclick = async function () {
    this.disabled = true;
    const timerEl = document.getElementById("timer");
    const labelEl = document.getElementById("label");

    for (let i = 0; i < PHOTOS_PER_SESSION; i++) {
        labelEl.innerText = `SNAP ${i + 1} / ${PHOTOS_PER_SESSION}`;
        for (let c = 3; c > 0; c--) {
            timerEl.classList.remove("timer-success");
            timerEl.innerText = c;
            await new Promise((r) => setTimeout(r, 600));
        }

        triggerFlash();

        timerEl.classList.add("timer-success");
        timerEl.innerText = "LIGHT CAPTURED! ✨";

        const photoSource = await capturePhotoSource();
        capturedPhotos.push(photoSource);
        await new Promise((r) => setTimeout(r, 800));
    }

    stopCamera();
    setupSelection();
};

function setupSelection() {
    const grid = document.getElementById("selectionGrid");
    grid.innerHTML = "";
    capturedPhotos.forEach((src, idx) => {
        const div = document.createElement("div");
        div.className = "photo-choice";
        div.innerHTML = `<img src="${src}" alt="Captured photo ${idx + 1}">`;
        div.onclick = () => {
            if (selectedPhotoIndices.includes(idx)) {
                selectedPhotoIndices = selectedPhotoIndices.filter((i) => i !== idx);
            } else if (selectedPhotoIndices.length < PHOTOS_TO_KEEP) {
                selectedPhotoIndices.push(idx);
            }
            div.classList.toggle("selected", selectedPhotoIndices.includes(idx));
            const btn = document.getElementById("confirmPhotosBtn");
            btn.disabled = selectedPhotoIndices.length !== PHOTOS_TO_KEEP;
            btn.innerText = `LOCK IN PHOTOS (${selectedPhotoIndices.length}/${PHOTOS_TO_KEEP})`;
        };
        grid.appendChild(div);
    });
    showScreen("selectionScreen");
}

document.getElementById("confirmPhotosBtn").onclick = async () => {
    showScreen("processingScreen");

    const bar = document.getElementById("progressBar");
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 0.5;
        if (progress >= 100) {
            clearInterval(progressInterval);
            setTimeout(() => showScreen("frameSelection"), 200);
        }
        bar.style.width = `${progress}%`;
    }, 50);

    const photoImgs = await Promise.all(
        selectedPhotoIndices.map((i) => loadImage(capturedPhotos[i]))
    );

    const grid = document.getElementById("frameGrid");
    grid.innerHTML = "";

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) entry.target.classList.add("revealed");
            });
        },
        { threshold: 0.2 }
    );

    for (const frame of FRAMES) {
        const card = document.createElement("div");
        card.className = "frame-card";
        const cnv = document.createElement("canvas");
        cnv.width = 400;
        cnv.height = 1200;

        const info = document.createElement("div");
        info.className = "frame-label-overlay";
        info.innerHTML = `
            <div class="frame-name">${frame.name}</div>
            <div class="frame-price">${frame.price}</div>
        `;

        card.appendChild(cnv);
        card.appendChild(info);
        card.onclick = () => {
            selectedFrame = frame;
            document.querySelectorAll(".frame-card").forEach((c) => c.classList.remove("selected"));
            card.classList.add("selected");
            document.getElementById("finalizeBtn").disabled = false;
        };

        grid.appendChild(card);
        observer.observe(card);
        drawToCanvas(cnv, frame, photoImgs);
    }
};

async function drawToCanvas(cnv, frame, photos) {
    const tCtx = cnv.getContext("2d");
    const selectedFrame = frame || FRAMES[0];
    const { base: bImg, overlay: tImg } = await getFrameAssets(selectedFrame);

    tCtx.fillStyle = "white";
    tCtx.fillRect(0, 0, cnv.width, cnv.height);
    if (bImg) tCtx.drawImage(bImg, 0, 0, cnv.width, cnv.height);

    const scale = cnv.width / SLOT.canvasWidth;
    const pW = SLOT.photoWidth * scale;
    const pH = SLOT.photoHeight * scale;
    const startY = SLOT.startY * scale;
    const gap = SLOT.gap * scale;

    const localPhotos = await Promise.all(
        photos.map(async (img) => {
            if (!img) return null;
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext("2d");
            tempCtx.drawImage(img, 0, 0);
            return tempCanvas;
        })
    );

    localPhotos.forEach((localImg, i) => {
        if (!localImg) return;
        const yPos = startY + i * (pH + gap);
        const xPos = (cnv.width - pW) / 2;
        const imgAspect = localImg.width / localImg.height;
        const slotAspect = pW / pH;
        let sw, sh, sx, sy;

        if (imgAspect > slotAspect) {
            sh = localImg.height;
            sw = sh * slotAspect;
            sx = (localImg.width - sw) / 2;
            sy = 0;
        } else {
            sw = localImg.width;
            sh = sw / slotAspect;
            sx = 0;
            sy = (localImg.height - sh) / 2;
        }
        tCtx.drawImage(localImg, sx, sy, sw, sh, xPos, yPos, pW, pH);
    });

    if (tImg) tCtx.drawImage(tImg, 0, 0, cnv.width, cnv.height);
}

function imageToDataUrl(img) {
    return new Promise((resolve, reject) => {
        if (!img) return resolve(null);

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = img.naturalWidth || img.width || 1;
        tempCanvas.height = img.naturalHeight || img.height || 1;
        const tempCtx = tempCanvas.getContext("2d");

        tempCtx.drawImage(img, 0, 0);
        try {
            resolve(tempCanvas.toDataURL("image/png"));
        } catch (err) {
            reject(err);
        }
    });
}

async function generateFinal() {
    if (frameSelectionInterval) clearInterval(frameSelectionInterval);
    const btn = document.getElementById("finalizeBtn");
    btn.disabled = true;
    btn.innerText = "PROCESSING...";

    try {
        const photoImgs = await Promise.all(
            selectedPhotoIndices.map((i) => loadImage(capturedPhotos[i]))
        );
        const selectedFrameData = selectedFrame || FRAMES[0];
        const finalCanvas = document.createElement("canvas");
        finalCanvas.width = SLOT.canvasWidth;
        finalCanvas.height = SLOT.canvasHeight;
        await drawToCanvas(finalCanvas, selectedFrameData, photoImgs);

        const url = finalCanvas.toDataURL("image/png");

        document.getElementById("finalOutput").innerHTML =
            `<img src="${url}" style="max-height: 75vh; width: auto; border-radius: 8px;" alt="Final photo strip">`;
        const downloadLink = document.getElementById("downloadLink");
        downloadLink.href = url;
        downloadLink.download = "lock-in-strip.png";
        showScreen("resultScreen");
    } catch (err) {
        console.error("Final generation failed", err);
        const message = err?.message || String(err);
        document.getElementById("finalOutput").innerHTML =
            `<div style="color: #fff; background: rgba(0,0,0,0.6); padding: 16px 20px; border-radius: 8px;">We couldn’t generate your strip.<br><small>${message}</small></div>`;
        btn.disabled = false;
        btn.innerText = "FINALIZE & PRINT";
        showScreen("resultScreen");
    }
}

function downloadFinalImage() {
    const downloadLink = document.getElementById("downloadLink");
    if (!downloadLink || !downloadLink.href || downloadLink.href === window.location.href) {
        return;
    }

    const tempLink = document.createElement("a");
    tempLink.href = downloadLink.href;
    tempLink.download = downloadLink.download || "lock-in-strip.png";
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);
}

/** Loads an image from a URL (or data URL). Resolves null on error instead
 * of rejecting, so callers can treat "missing file" as "optional asset not
 * present" (used for optional overlays, and to keep the frame grid
 * rendering even if one frame's PNG is missing). */
function loadImage(src) {
    return new Promise((resolve) => {
        if (!src) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

function startNewSession() {
    createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    stopCamera();
    location.reload();
}
