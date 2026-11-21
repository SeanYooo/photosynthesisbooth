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

// Live Motion Replay constants
const COUNTDOWN_SECONDS = 10;
const VIDEO_BUFFER_SECONDS = 4;
const VIDEO_FPS = 30;
const REPLAY_DURATION_SECONDS = 4;
const REPLAY_TOTAL_FRAMES = REPLAY_DURATION_SECONDS * VIDEO_FPS; // 120 frames

// Video MIME type preference: MP4 (H.264) for iOS Safari, fallback to WebM (VP9)
const VIDEO_MIME = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
    ? 'video/mp4;codecs=avc1.42E01E'
    : 'video/webm;codecs=vp9';

// Cloudinary config (fallback defaults; overridden by config.js if present)
// These are defined as constants but the actual values used at runtime come from
// window.CLOUDINARY_CLOUD_NAME / window.CLOUDINARY_UPLOAD_PRESET (set by config.js)
// with fallback to these defaults for GitHub Pages
const CLOUDINARY_CLOUD_NAME = 'bhgpuo3w';
const CLOUDINARY_UPLOAD_PRESET = 'photosynthesisbooth';

const FRAME_ASSET_DIR = "frames/";
const FRAME_THUMB_DIR = "frames/thumbs/";

// Single source of truth for frames: name. The base/overlay PNGs
// are resolved automatically from `name` (see getFrameSlug) — add a new
// frame by adding an entry here and dropping matching PNGs into /frames/,
// no other wiring required. Set an explicit `slug` only if you need the
// filename to differ from the auto-generated one (e.g. to avoid a
// collision, or to keep an existing filename when renaming a frame).
const FRAMES = [
    { name: "Lucky Green" },
    { name: "Midnight Sky" },
    { name: "Cloud Dancer" },
    { name: "Pacific Breeze" },
    { name: "Kanibalismo II" },
    { name: "Eternal Sunshine" },
    { name: "Urban Steel" },
    { name: "Pastel Pony" },
    { name: "Dream Atlas" },
    { name: "Static & Stars" },
    { name: "Neon Summer" },
    { name: "IVOS" },
    { name: "Chrome Forever" },
    { name: "Stay Grounded" },
    { name: "Lost & Found Season" },
    { name: "Citrus Punch" },
    { name: "Midnight Sun" },
    { name: "Quick & Cute" },
    { name: "Rose Static" },
    { name: "Alaala" },
    { name: "Saan?" },
    { name: "Kapow!" },
    { name: "STEMAZING" },
    { name: "Humanista" },
    { name: "Kapitalista" },
    { name: "Snorkle" },
    { name: "Y2K Wallpaper" },
    { name: "Stars" },
    { name: "Bleed Crimson" },
    { name: "Luxe Velvet" },
];

const PHOTOS_PER_SESSION = 6;
const PHOTOS_TO_KEEP = 4;
const FRAME_SELECTION_SECONDS = 60;

let capturedPhotos = []; // Array of { still: url, video: blob, videoUrl: objectUrl }
let selectedPhotoIndices = [];
let selectedFrame = null;
let cameraStream = null;
let frameSelectionInterval = null;
let createdObjectUrls = [];

// Live Motion Replay state
let mediaRecorder = null;
let videoChunks = [];
let videoStartTime = 0;
let countdownInterval = null;
let countdownStartTime = 0;

// Replay state for mobile view
let replayVideoBlob = null;
let replayCloudinaryUrl = null;

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

/**
 * Check for ?replay= query parameter on page load and show mobile replay view.
 * This runs before any other initialization.
 */
(function initMobileReplayOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const replayUrl = params.get('replay');
    if (replayUrl) {
        // Show the dedicated replay screen
        showScreen('replayScreen');
        setupMobileReplayView(decodeURIComponent(replayUrl));
        return;
    }
})();

function goToBooth() {
    // Clear replay parameter and reload to start fresh booth session
    window.location.href = 'https://seanyooo.github.io/photosynthesisbooth/';
}

function setupMobileReplayView(videoUrl) {
    const replayVideo = document.getElementById('replayVideo');
    const downloadBtn = document.getElementById('downloadReplayBtn');
    const directLink = document.getElementById('replayDirectLink');
    const errorDiv = document.getElementById('replayError');

    // Set up video
    replayVideo.src = videoUrl;

    replayVideo.onloadeddata = () => {
        // Video loaded successfully
        replayVideo.play().catch(() => {
            // Autoplay may be blocked, controls are available
            console.log('Autoplay prevented, user can tap play');
        });
    };

    replayVideo.onerror = () => {
        errorDiv.textContent = 'Failed to load video. The link may have expired or be invalid.';
        errorDiv.style.display = 'block';
    };

    // Download button - fetches video and triggers download
    downloadBtn.onclick = async () => {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'DOWNLOADING...';

        try {
            const response = await fetch(videoUrl);
            if (!response.ok) throw new Error('Failed to fetch video');

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            // Try programmatic download
            const a = document.createElement('a');
            a.href = url;
            a.download = 'photosynthesis-booth-replay.mp4';
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            downloadBtn.textContent = 'DOWNLOADED!';
            setTimeout(() => {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'DOWNLOAD VIDEO';
            }, 2000);
        } catch (err) {
            console.error('Download failed:', err);
            downloadBtn.textContent = 'ERROR - TRY AGAIN';
            setTimeout(() => {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'DOWNLOAD VIDEO';
            }, 3000);
        }
    };

    // Direct link fallback
    directLink.href = videoUrl;
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
 * Loads the 400x1200 preview thumbnails for a frame (frames/thumbs/<slug>.webp
 * for the base, frames/thumbs/<slug>-overlay.webp for the overlay).
 * Falls back to resizing the full PNGs if the thumbs are missing.
 */
async function getFrameThumb(frame) {
    const slug = getFrameSlug(frame);
    const basePath = `${FRAME_THUMB_DIR}${slug}.webp`;
    const overlayPath = `${FRAME_THUMB_DIR}${slug}-overlay.webp`;
    if (frameAssetCache.has(basePath)) return frameAssetCache.get(basePath);
    let base = await loadImage(basePath);
    let overlay = await loadImage(overlayPath);
    if (!base) {
        // fallback: build thumbs from the full assets
        const full = await getFrameAssets(frame);
        if (!full.base) return { base: null, overlay: null };
        const c = document.createElement("canvas");
        c.width = 400; c.height = 1200;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(full.base, 0, 0, c.width, c.height);
        base = c;
        overlay = full.overlay ? await loadImage(overlayPath) : null;
    }
    const pair = { base, overlay };
    frameAssetCache.set(basePath, pair);
    return pair;
}

/**
 * Kicks off the booth: request camera access, then move to the ready screen.
 * Frame previews are loaded lazily at frame selection time from
 * frames/thumbs/*.webp, and the full-size base/overlay only when the user
 * picks a frame. Triggered by a user gesture (the home screen button),
 * which getUserMedia requires.
 */
async function beginSetup() {
    showScreen("initScreen");

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1920, height: 1080 },
        });
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

        // Start video recording for this shot
        await startVideoRecording();

        // 10-second countdown with smooth timer updates
        await runCountdown(COUNTDOWN_SECONDS, timerEl);

        // At 0s: trigger flash, capture still photo, finalize video
        triggerFlash();

        timerEl.classList.add("timer-success");
        timerEl.innerText = "LIGHT CAPTURED! ✨";

        const photoSource = await capturePhotoSource();
        const videoBlob = await stopVideoRecording();

        capturedPhotos.push({
            still: photoSource,
            video: videoBlob,
            videoUrl: videoBlob ? URL.createObjectURL(videoBlob) : null
        });
        if (videoBlob) createdObjectUrls.push(capturedPhotos[capturedPhotos.length - 1].videoUrl);

        await new Promise((r) => setTimeout(r, 800));
    }

    stopCamera();
    setupSelection();
};

/**
 * Starts MediaRecorder to capture video from the camera stream.
 * Uses a circular buffer to keep only the last VIDEO_BUFFER_SECONDS.
 */
async function startVideoRecording() {
    videoChunks = [];
    videoStartTime = Date.now();

    try {
        const stream = video.srcObject;
        if (!stream) throw new Error('No camera stream available');

        mediaRecorder = new MediaRecorder(stream, { mimeType: VIDEO_MIME });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                videoChunks.push(event.data);
                // Trim buffer to keep only last VIDEO_BUFFER_SECONDS
                trimVideoBuffer();
            }
        };

        // Request data every 100ms for smoother buffer management
        mediaRecorder.start(100);
    } catch (err) {
        console.warn('MediaRecorder not available, video capture disabled:', err);
        mediaRecorder = null;
    }
}

/**
 * Trims videoChunks to keep only approximately the last VIDEO_BUFFER_SECONDS.
 * Uses blob size estimation since we don't have exact timestamps.
 */
function trimVideoBuffer() {
    if (!mediaRecorder || videoChunks.length === 0) return;

    // Estimate: each chunk is ~100ms at our recording interval
    // We want to keep VIDEO_BUFFER_SECONDS * 10 chunks
    const maxChunks = VIDEO_BUFFER_SECONDS * 10;
    if (videoChunks.length > maxChunks) {
        videoChunks = videoChunks.slice(-maxChunks);
    }
}

/**
 * Runs a visual countdown for the specified seconds.
 * Updates timerEl every 100ms for smooth animation.
 */
function runCountdown(seconds, timerEl) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const endTime = startTime + seconds * 1000;

        timerEl.classList.remove("timer-success");

        countdownInterval = setInterval(() => {
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((endTime - now) / 1000));

            // Show tenths of seconds for last 3 seconds for precision feel
            if (remaining <= 3) {
                const remainingMs = endTime - now;
                const tenths = Math.ceil(remainingMs / 100) / 10;
                timerEl.innerText = tenths.toFixed(1);
            } else {
                timerEl.innerText = remaining;
            }

            if (now >= endTime) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                timerEl.innerText = "0";
                resolve();
            }
        }, 100);
    });
}

/**
 * Stops video recording and returns the buffered video as a Blob.
 * Returns null if MediaRecorder wasn't available.
 */
async function stopVideoRecording() {
    if (!mediaRecorder) return null;

    return new Promise((resolve) => {
        mediaRecorder.onstop = () => {
            if (videoChunks.length === 0) {
                resolve(null);
                return;
            }
            const blob = new Blob(videoChunks, { type: VIDEO_MIME });
            videoChunks = [];
            mediaRecorder = null;
            resolve(blob);
        };

        mediaRecorder.stop();
    });
}

function setupSelection() {
    const grid = document.getElementById("selectionGrid");
    grid.innerHTML = "";
    capturedPhotos.forEach((photoObj, idx) => {
        const div = document.createElement("div");
        div.className = "photo-choice";
        div.innerHTML = `<img src="${photoObj.still}" alt="Captured photo ${idx + 1}">`;
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
        selectedPhotoIndices.map((i) => loadImage(capturedPhotos[i].still))
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
        card.appendChild(cnv);

        const info = document.createElement("div");
        info.className = "frame-label-overlay";
        info.innerHTML = `
            <div class="frame-name">${frame.name}</div>
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

        // Preview: draw base thumb, then the user's 4 photos, then the overlay
        // thumb — the same layer order as generateFinal() so overlay art that
        // overlaps a photo slot sits on top of the photo. No full PNG needed.
        (async () => {
            const pair = await getFrameThumb(frame);
            const thumbBase = pair?.base;
            const thumbOverlay = pair?.overlay;
            if (!thumbBase) return;
            cnv.width = 400; cnv.height = 1200;
            const tCtx = cnv.getContext("2d");
            tCtx.fillStyle = "white"; tCtx.fillRect(0, 0, cnv.width, cnv.height);
            tCtx.drawImage(thumbBase, 0, 0, cnv.width, cnv.height);
            const scale = cnv.width / SLOT.canvasWidth;
            const pW = SLOT.photoWidth * scale, pH = SLOT.photoHeight * scale;
            const startY = SLOT.startY * scale, gap = SLOT.gap * scale;
            photoImgs.forEach((p, i) => {
                if (!p) return;
                const yPos = startY + i*(pH+gap), xPos = (cnv.width-pW)/2;
                const imgAspect = p.width/p.height, slotAspect = pW/pH;
                let sw, sh, sx, sy;
                if (imgAspect > slotAspect) { sh=p.height; sw=sh*slotAspect; sx=(p.width-sw)/2; sy=0; }
                else { sw=p.width; sh=sw/slotAspect; sx=0; sy=(p.height-sh)/2; }
                tCtx.drawImage(p, sx, sy, sw, sh, xPos, yPos, pW, pH);
            });
            if (thumbOverlay) tCtx.drawImage(thumbOverlay, 0, 0, cnv.width, cnv.height);
        })();
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
            selectedPhotoIndices.map((i) => loadImage(capturedPhotos[i].still))
        );
        const selectedFrameData = selectedFrame || FRAMES[0];
        const finalCanvas = document.createElement("canvas");
        finalCanvas.width = SLOT.canvasWidth;
        finalCanvas.height = SLOT.canvasHeight;
        await drawToCanvas(finalCanvas, selectedFrameData, photoImgs);

        const blob = await new Promise((resolve, reject) => {
            finalCanvas.toBlob((result) => {
                if (result) resolve(result);
                else reject(new Error("Could not create PNG export"));
            }, "image/png");
        });
        const url = URL.createObjectURL(blob);
        createdObjectUrls.push(url);

        document.getElementById("finalOutput").innerHTML =
            `<img src="${url}" style="max-height: 75vh; width: auto; border-radius: 8px;" alt="Final photo strip">`;
        const downloadLink = document.getElementById("downloadLink");
        downloadLink.href = url;
        downloadLink.download = "lock-in-strip.png";

        // After generating still, process the replay strip
        await processReplayStrip();

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

/** Loads a video from a Blob and returns a ready-to-seek <video> element. */
function loadVideo(blob) {
    return new Promise((resolve, reject) => {
        if (!blob) return resolve(null);
        const url = URL.createObjectURL(blob);
        createdObjectUrls.push(url);
        const video = document.createElement('video');
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onloadedmetadata = () => {
            // Seek to 0 to ensure it's ready
            video.currentTime = 0;
            resolve(video);
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load video'));
        };
    });
}

/**
 * Generates the animated replay strip by compositing 4 video clips
 * into the selected frame at 30fps for 4 seconds (120 frames total).
 *
 * FIXES:
 * 1. No more flicker: Uses 4 persistent offscreen slot canvases.
 *    Each slot canvas is initialized ONCE with the static photo, then
 *    only updated when video has a valid frame (readyState >= 2, not seeking).
 *    This eliminates the jump-cut flash between static and video frames.
 *
 * 2. No more 1.5s freeze: Uses a single master clock (elapsed = (now - startTime) % clipDurationMs)
 *    instead of relying on video.duration (often Infinity for MediaRecorder blobs) or native
 *    video.loop (which drifts and stalls across 4 separate elements).
 *    Pre-buffers all 4 videos, calls await video.play() on each so they decode continuously,
 *    and resets all 4 to currentTime=0 together once per 4000ms cycle (NOT every frame).
 */
async function generateReplayStrip(selectedIndices, frame) {
    const canvas = document.createElement('canvas');
    canvas.width = SLOT.canvasWidth;
    canvas.height = SLOT.canvasHeight;
    const ctx = canvas.getContext('2d');

    // Capture canvas stream at 30fps
    const stream = canvas.captureStream(VIDEO_FPS);
    const recorder = new MediaRecorder(stream, { mimeType: VIDEO_MIME });
    const chunks = [];

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    // Load frame assets (base + overlay)
    const frameAssets = await getFrameAssets(frame);

    // Load the 4 selected videos
    const videoBlobs = selectedIndices.map(i => capturedPhotos[i].video);
    const videos = await Promise.all(videoBlobs.map(loadVideo));

    // Calculate slot positions (same as drawToCanvas)
    const scale = canvas.width / SLOT.canvasWidth;
    const pW = SLOT.photoWidth * scale;
    const pH = SLOT.photoHeight * scale;
    const startY = SLOT.startY * scale;
    const gap = SLOT.gap * scale;
    const xPos = (canvas.width - pW) / 2;

    const slotPositions = [];
    for (let i = 0; i < 4; i++) {
        slotPositions.push({
            x: xPos,
            y: startY + i * (pH + gap),
            w: pW,
            h: pH
        });
    }

    // Load static photos (one-time initialization for slot canvases)
    const staticPhotos = await Promise.all(
        selectedIndices.map(async (i) => {
            const photo = capturedPhotos[i];
            if (!photo?.still) return null;
            return loadImage(photo.still);
        })
    );

    // FIX 1: Create 4 persistent offscreen slot canvases
    // Draw static photo ONCE during initialization as the initial frame
    const slotCanvases = [];
    for (let i = 0; i < 4; i++) {
        const slotCanvas = document.createElement('canvas');
        slotCanvas.width = slotPositions[i].w;
        slotCanvas.height = slotPositions[i].h;
        const slotCtx = slotCanvas.getContext('2d');
        const staticImg = staticPhotos[i];
        if (staticImg) {
            const imgAspect = staticImg.width / staticImg.height;
            const slotAspect = slotCanvas.width / slotCanvas.height;
            let sx, sy, sw, sh;
            if (imgAspect > slotAspect) {
                sh = staticImg.height;
                sw = sh * slotAspect;
                sx = (staticImg.width - sw) / 2;
                sy = 0;
            } else {
                sw = staticImg.width;
                sh = sw / slotAspect;
                sx = 0;
                sy = (staticImg.height - sh) / 2;
            }
            slotCtx.drawImage(staticImg, sx, sy, sw, sh, 0, 0, slotCanvas.width, slotCanvas.height);
        }
        slotCanvases.push(slotCanvas);
    }

    // Pre-buffer all 4 videos and wait for readyState >= 3 (HAVE_ENOUGH_DATA)
    await Promise.all(videos.map(async (video, i) => {
        if (!video) return;
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = "anonymous";
        // NO video.loop = true - we drive playback via master clock
        video.currentTime = 0;

        // Wait for video to be fully buffered and seekable
        if (video.readyState < 3) {
            await new Promise((resolve, reject) => {
                const onCanPlayThrough = () => {
                    video.removeEventListener('canplaythrough', onCanPlayThrough);
                    video.removeEventListener('error', onError);
                    resolve();
                };
                const onError = (e) => {
                    video.removeEventListener('canplaythrough', onCanPlayThrough);
                    video.removeEventListener('error', onError);
                    reject(e);
                };
                video.addEventListener('canplaythrough', onCanPlayThrough);
                video.addEventListener('error', onError);
            });
        }

        // Prime the decoder: play briefly, then pause at t=0
        try {
            await video.play();
            await new Promise(r => setTimeout(r, 50));
            video.pause();
            video.currentTime = 0;
        } catch (e) {
            console.warn(`Video ${i} play/pause failed:`, e);
        }
    }));

    // FIX 2: Start all 4 videos playing continuously so they decode frames in real time
    await Promise.all(videos.map(async (video) => {
        if (!video) return;
        try {
            await video.play();
        } catch (e) {
            console.warn('Video play failed:', e);
        }
    }));

    // Master clock - 4 second cycle (120 frames at 30fps)
    const CLIP_DURATION_MS = REPLAY_DURATION_SECONDS * 1000; // 4000ms
    let lastLoopBoundary = 0;
    const startTime = performance.now();

    recorder.start();

    // Render 120 frames (4 seconds at 30fps)
    for (let frameIdx = 0; frameIdx < REPLAY_TOTAL_FRAMES; frameIdx++) {
        // Master clock: elapsed time within the 4-second cycle
        const elapsedMs = (performance.now() - startTime) % CLIP_DURATION_MS;

        // Once per cycle (~4000ms), reset all 4 videos to t=0 TOGETHER
        // This keeps them synchronized without seeking every frame
        if (elapsedMs < lastLoopBoundary) {
            // We crossed the 4-second boundary (elapsed wrapped from ~4000 -> ~0)
            videos.forEach(v => { if (v) v.currentTime = 0; });
        }
        lastLoopBoundary = elapsedMs;

        // Clear and draw white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw frame base
        if (frameAssets.base) {
            ctx.drawImage(frameAssets.base, 0, 0, canvas.width, canvas.height);
        }

        // Draw each slot from its persistent offscreen canvas
        for (let i = 0; i < 4; i++) {
            const video = videos[i];
            const slot = slotPositions[i];
            const slotCanvas = slotCanvases[i];

            // Update slot canvas when video has a valid frame (readyState >= 2, not seeking)
            // NOTE: We do NOT check !video.paused because videos are now playing continuously
            if (video && video.readyState >= 2 && !video.seeking) {
                const slotCtx = slotCanvas.getContext('2d');
                // Draw video frame fitted to slot (cover) with mirror fix
                const vAspect = video.videoWidth / video.videoHeight;
                const slotAspect = slotCanvas.width / slotCanvas.height;
                let sx, sy, sw, sh;
                if (vAspect > slotAspect) {
                    sh = video.videoHeight;
                    sw = sh * slotAspect;
                    sx = (video.videoWidth - sw) / 2;
                    sy = 0;
                } else {
                    sw = video.videoWidth;
                    sh = sw / slotAspect;
                    sx = 0;
                    sy = (video.videoHeight - sh) / 2;
                }
                // Mirror the video horizontally (webcam is mirrored, so we un-mirror for recording)
                slotCtx.save();
                slotCtx.translate(slotCanvas.width, 0);
                slotCtx.scale(-1, 1);
                slotCtx.drawImage(video, sx, sy, sw, sh, 0, 0, slotCanvas.width, slotCanvas.height);
                slotCtx.restore();
            }

            // Draw the slot canvas (holds either static photo or latest valid video frame)
            ctx.drawImage(slotCanvas, slot.x, slot.y, slot.w, slot.h);
        }

        // Draw frame overlay on top (at normal un-mirrored orientation)
        if (frameAssets.overlay) {
            ctx.setTransform(1, 0, 0, 1, 0, 0); // Ensure no transform leakage
            ctx.drawImage(frameAssets.overlay, 0, 0, canvas.width, canvas.height);
        }

        // Update progress
        if (frameIdx % 10 === 0) {
            const progress = Math.round((frameIdx / REPLAY_TOTAL_FRAMES) * 100);
            const progressBar = document.getElementById('replayProgressBar');
            const statusEl = document.getElementById('replayStatus');
            if (progressBar) progressBar.style.width = `${progress}%`;
            if (statusEl) statusEl.textContent = `Rendering frame ${frameIdx + 1} / ${REPLAY_TOTAL_FRAMES}...`;
        }

        // Wait for next frame (sync to 30fps via captureStream)
        await new Promise(r => requestAnimationFrame(r));
    }

    // After rendering, stop recorder
    recorder.stop();

    return new Promise((resolve) => {
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: VIDEO_MIME });
            resolve(blob);
        };
    });
}

/**
 * Normalizes Cloudinary URL to ensure MP4 delivery with auto quality.
 */
function normalizeCloudinaryUrl(url) {
    return url
        .replace('/video/upload/', '/video/upload/f_mp4,q_auto/')
        .replace(/\.(webm|mov|avi|mkv)$/i, '.mp4');
}

/**
 * Uploads video blob to Cloudinary and returns normalized secure URL.
 */
async function uploadToCloudinary(videoBlob) {
    const cloudName = window.CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME;
    const uploadPreset = window.CLOUDINARY_UPLOAD_PRESET || CLOUDINARY_UPLOAD_PRESET;

    const formData = new FormData();
    formData.append('file', videoBlob);
    formData.append('upload_preset', uploadPreset);

    const statusEl = document.getElementById('replayStatus');
    if (statusEl) statusEl.textContent = 'Uploading to Cloudinary...';

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Cloudinary upload failed: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return normalizeCloudinaryUrl(data.secure_url);
}

/**
 * Renders QR code to canvas using qrcodejs.
 * Note: qrcodejs replaces the canvas element, so we need to re-get it after.
 */
function renderQRCode(url) {
    const canvas = document.getElementById('qrCanvas');
    if (!canvas) return;

    // Clear canvas
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Use qrcodejs if available
    if (typeof QRCode !== 'undefined') {
        // qrcodejs replaces the canvas element, so create a temporary div
        const tempDiv = document.createElement('div');
        canvas.parentNode.insertBefore(tempDiv, canvas);
        canvas.style.display = 'none';

        new QRCode(tempDiv, {
            text: url,
            width: 512,
            height: 512,
            correctLevel: QRCode.CorrectLevel.H,
            colorDark: '#062014',
            colorLight: '#ffffff'
        });

        // qrcodejs creates a canvas inside the div, copy it to our canvas
        setTimeout(() => {
            const qrCanvas = tempDiv.querySelector('canvas');
            if (qrCanvas) {
                ctx.drawImage(qrCanvas, 0, 0, canvas.width, canvas.height);
            }
            tempDiv.remove();
            canvas.style.display = 'block';
        }, 0);
    } else {
        // Fallback: draw placeholder text
        ctx.fillStyle = '#062014';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('QR Code library not loaded', canvas.width / 2, canvas.height / 2);
    }
}

/**
 * Shows the replay processing screen and generates the animated strip.
 */
async function processReplayStrip() {
    showScreen('replayProcessingScreen');

    // Reset progress bar
    const progressBar = document.getElementById('replayProgressBar');
    const statusEl = document.getElementById('replayStatus');
    if (progressBar) progressBar.style.width = '0%';
    if (statusEl) statusEl.textContent = 'Compositing video frames...';

    try {
        // Get selected frame and video indices
        const selectedFrameData = selectedFrame || FRAMES[0];
        const selectedIndices = selectedPhotoIndices;

        // Generate animated replay strip
        if (statusEl) statusEl.textContent = 'Compositing video frames...';

        const videoBlob = await generateReplayStrip(selectedIndices, selectedFrameData);

        // Store blob for potential retry / local fallback
        replayVideoBlob = videoBlob;

        // Upload to Cloudinary
        if (statusEl) statusEl.textContent = 'Uploading replay & generating QR...';

        let cloudinaryUrl;
        let uploadError = null;
        try {
            cloudinaryUrl = await uploadToCloudinary(videoBlob);
        } catch (err) {
            console.error('Cloudinary upload failed:', err);
            uploadError = err;
        }

        if (uploadError) {
            // Clear any previous retry/error UI
            const replayContainer = document.getElementById('replayPreviewContainer');
            const replayVideo = document.getElementById('replayPreview');
            if (replayContainer && replayVideo) {
                replayContainer.style.display = 'block';
                replayVideo.src = URL.createObjectURL(videoBlob);
                createdObjectUrls.push(replayVideo.src);
            }
            if (statusEl) statusEl.textContent = `Upload failed — QR code will point to homepage without video.`;
            showScreen('resultScreen');
            // QR code will encode just the base homepage (no replay param)
            renderQRCode('https://seanyooo.github.io/photosynthesisbooth/');
            const qrSection = document.getElementById('qrSection');
            if (qrSection) qrSection.style.display = 'block';
            const downloadVideoBtn = document.getElementById('downloadVideoBtn');
            if (downloadVideoBtn) downloadVideoBtn.style.display = 'block';
            return;
        }

        replayCloudinaryUrl = cloudinaryUrl;

        // Show result screen with replay preview and QR code
        showResultWithReplay(cloudinaryUrl);

    } catch (err) {
        console.error('Replay processing failed:', err);
        const message = err?.message || String(err);
        document.getElementById('replayStatus').textContent = `Error: ${message}`;
        // Fall back to result screen without replay
        showScreen('resultScreen');
    }
}

/**
 * Shows the result screen with replay video preview and QR code.
 */
function showResultWithReplay(videoUrl) {
    // Show replay video preview
    const replayContainer = document.getElementById('replayPreviewContainer');
    const replayVideo = document.getElementById('replayPreview');
    if (replayContainer && replayVideo) {
        replayVideo.src = videoUrl;
        replayContainer.style.display = 'block';
    }

    // Generate and show QR code
    // Encoded as: https://seanyooo.github.io/photosynthesisbooth/?replay=<encoded_cloudinary_url>
    const replayPageUrl = `https://seanyooo.github.io/photosynthesisbooth/?replay=${encodeURIComponent(videoUrl)}`;
    renderQRCode(replayPageUrl);

    const qrSection = document.getElementById('qrSection');
    if (qrSection) qrSection.style.display = 'block';

    // Show download video button
    const downloadVideoBtn = document.getElementById('downloadVideoBtn');
    if (downloadVideoBtn) downloadVideoBtn.style.display = 'block';

    showScreen('resultScreen');
}

/**
 * Downloads the replay video from Cloudinary or local blob.
 * Fetches the video as blob and triggers a download via object URL
 * to work around cross-origin restrictions on <a download> with remote URLs.
 */
async function downloadReplayVideo() {
    const btn = document.getElementById('downloadVideoBtn');
    const url = window.replayVideoUrl;
    if (!url) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'DOWNLOADING...';
    }

    try {
        // First try: if it's a local blob URL, use it directly
        if (url.startsWith('blob:')) {
            const a = document.createElement('a');
            a.href = url;
            a.download = 'photosynthesis-booth-replay.mp4';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            if (btn) {
                btn.textContent = 'DOWNLOADED!';
                setTimeout(() => {
                    btn.disabled = false;
                    btn.textContent = 'SAVE VIDEO';
                }, 2000);
            }
            return;
        }

        // Second try: fetch remote URL (Cloudinary) as blob
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch video');

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'photosynthesis-booth-replay.mp4';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);

        if (btn) {
            btn.textContent = 'DOWNLOADED!';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = 'SAVE VIDEO';
            }, 2000);
        }
    } catch (err) {
        console.error('Download failed:', err);
        if (btn) {
            btn.textContent = 'ERROR - TRY AGAIN';
            setTimeout(() => {
                btn.disabled = false;
                btn.textContent = 'SAVE VIDEO';
            }, 3000);
        }
    }
}

function startNewSession() {
    createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    stopCamera();
    location.reload();
}
