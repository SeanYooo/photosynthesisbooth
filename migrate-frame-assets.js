#!/usr/bin/env node
/**
 * One-time migration: renames the old numbered frame PNGs (1.png, 2.png, ...)
 * to the new slug-based names the app now expects (frames/<slug>-base.png,
 * frames/<slug>-overlay.png).
 *
 * Usage:
 *   1. Put your existing 1.png..54.png files in a folder (default: ./assets)
 *   2. node migrate-frame-assets.js [sourceDir] [destDir]
 *      e.g. node migrate-frame-assets.js ./assets ./frames
 *   3. Verify the output in destDir, then delete the old numbered files.
 *
 * This script is only needed once, when moving from the old numeric
 * base/overlay ID scheme to the new name-derived filenames. New frames
 * added after migrating don't need this script — just save the PNGs
 * directly with the right slug-based filename.
 */

const fs = require("fs");
const path = require("path");

// Mirrors the old FRAMES array's name -> {base, overlay} numeric mapping.
const OLD_MAPPING = [
    { name: "Lucky Green", base: 1, overlay: 2 },
    { name: "Midnight Sky", base: 3 },
    { name: "Cloud Dancer", base: 4 },
    { name: "Pacific Breeze", base: 5 },
    { name: "Kanibalismo II", base: 6, overlay: 7 },
    { name: "Eternal Sunshine", base: 8, overlay: 9 },
    { name: "Urban Steel", base: 10, overlay: 11 },
    { name: "Pastel Pony", base: 12, overlay: 13 },
    { name: "Dream Atlas", base: 14, overlay: 15 },
    { name: "Static & Stars", base: 16, overlay: 17 },
    { name: "Neon Summer", base: 18 },
    { name: "IVOS", base: 19, overlay: 20 },
    { name: "Chrome Forever", base: 21, overlay: 22 },
    { name: "Stay Grounded", base: 23 },
    { name: "Lost & Found Season", base: 24, overlay: 25 },
    { name: "Citrus Punch", base: 26, overlay: 27 },
    { name: "Midnight Sun", base: 28, overlay: 29 },
    { name: "Quick & Cute", base: 30, overlay: 31 },
    { name: "Rose Static", base: 32, overlay: 33 },
    { name: "Alaala", base: 34, overlay: 35 },
    { name: "Saan?", base: 36, overlay: 37 },
    { name: "Kapow!", base: 38, overlay: 39 },
    { name: "STEMAZING", base: 40, overlay: 41 },
    { name: "Humanista", base: 42, overlay: 43 },
    { name: "Kapitalista", base: 44, overlay: 45 },
    { name: "Snorkle", base: 46, overlay: 47 },
    { name: "Y2K Wallpaper", base: 48, overlay: 49 },
    { name: "Stars", base: 50, overlay: 51 },
    { name: "Bleed Crimson", base: 52 },
    { name: "Luxe Velvet", base: 53, overlay: 54 },
];

// Same slugify logic as app.js — keep these in sync.
function slugify(str) {
    return str
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

const sourceDir = process.argv[2] || "./assets";
const destDir = process.argv[3] || "./frames";

if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory not found: ${sourceDir}`);
    process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });

let copied = 0;
let missing = 0;

for (const frame of OLD_MAPPING) {
    const slug = slugify(frame.name);

    const parts = [{ id: frame.base, kind: "base" }];
    if (frame.overlay) parts.push({ id: frame.overlay, kind: "overlay" });

    for (const { id, kind } of parts) {
        const srcPath = path.join(sourceDir, `${id}.png`);
        const destPath = path.join(destDir, `${slug}-${kind}.png`);

        if (!fs.existsSync(srcPath)) {
            console.warn(`  MISSING  ${srcPath}  (expected for "${frame.name}")`);
            missing++;
            continue;
        }

        fs.copyFileSync(srcPath, destPath);
        console.log(`  ${srcPath}  ->  ${destPath}`);
        copied++;
    }
}

console.log(`\nDone. Copied ${copied} file(s), ${missing} missing.`);
console.log(`Review "${destDir}", then you can delete the old numbered PNGs from "${sourceDir}".`);
