/**
 * Draws the application icon and builds the macOS icon file.
 *
 * The mark is a label seen slightly askew, with a barcode and a square code on
 * it: the two things this program exists to put there. It is drawn rather than
 * traced so every size is rendered at its own resolution — an icon that is
 * downscaled from one big image goes muddy at sixteen pixels, which is the size
 * that matters most in a menu bar.
 *
 *   node tools/make-icon.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// --- colours -----------------------------------------------------------------

const TOP = [74, 144, 217]; // the app's accent, lightened
const BOTTOM = [31, 78, 130];
const CARD = [255, 255, 255];
const INK = [20, 24, 29];

// --- geometry, in a 1000 unit square ----------------------------------------

const CANVAS = 1000;
/** The rounded square macOS draws every icon inside. */
const PLATE = { x: 40, y: 40, width: 920, height: 920, radius: 205 };
/** The label, turned a few degrees so it reads as paper rather than a panel. */
const CARD_BOX = { x: 175, y: 285, width: 650, height: 430, radius: 38 };

/**
 * Two sets of artwork.
 *
 * A seventeen-bar barcode is a grey smear at sixteen pixels: each bar lands on
 * a third of a pixel and the whole thing averages to nothing. Below sixty-four
 * pixels the mark therefore becomes three thick bars and one solid block, and
 * the card stops leaning — a tilted edge at that size is mush rather than
 * character. This is what system icons do, and it is the only way the small
 * sizes stay legible.
 */
const DETAILED = {
  tilt: (-6 * Math.PI) / 180,
  /** Widths in units, alternating bar and gap, starting with a bar. */
  bars: [26, 18, 14, 22, 40, 16, 18, 30, 14, 20, 34, 18, 24, 16, 44, 20, 28],
  barArea: { x: 235, y: 375, height: 250 },
  code: { x: 640, y: 400, size: 145 },
  cells: [
    [1, 1, 1, 0, 1],
    [1, 0, 1, 1, 0],
    [1, 1, 1, 0, 1],
    [0, 1, 0, 1, 1],
    [1, 0, 1, 1, 1],
  ],
};

const SIMPLE = {
  tilt: 0,
  bars: [95, 60, 75, 60, 115],
  barArea: { x: 245, y: 385, height: 230 },
  code: { x: 640, y: 400, size: 150 },
  cells: [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ],
};

/** Below this the simplified mark is used. */
const DETAIL_FROM = 64;

/** Signed distance to a rounded rectangle: negative inside. */
function roundedDistance(px, py, box) {
  const radius = Math.min(box.radius, box.width / 2, box.height / 2);
  const nearestX = Math.min(Math.max(px, box.x + radius), box.x + box.width - radius);
  const nearestY = Math.min(Math.max(py, box.y + radius), box.y + box.height - radius);
  const dx = px - nearestX;
  const dy = py - nearestY;
  if (dx === 0 && dy === 0) return -radius;
  return Math.hypot(dx, dy) - radius;
}

const cardCentre = {
  x: CARD_BOX.x + CARD_BOX.width / 2,
  y: CARD_BOX.y + CARD_BOX.height / 2,
};

/** Turns a point on the plate into the card's own upright frame. */
function intoCard(px, py, tilt) {
  if (tilt === 0) return { x: px, y: py };
  const dx = px - cardCentre.x;
  const dy = py - cardCentre.y;
  const cos = Math.cos(-tilt);
  const sin = Math.sin(-tilt);
  return {
    x: cardCentre.x + dx * cos - dy * sin,
    y: cardCentre.y + dx * sin + dy * cos,
  };
}

/** The colour and coverage of one point of the artwork, in unit coordinates. */
function sample(px, py, art) {
  if (roundedDistance(px, py, PLATE) > 0) return undefined;

  const blend = py / CANVAS;
  const plate = [
    Math.round(TOP[0] + (BOTTOM[0] - TOP[0]) * blend),
    Math.round(TOP[1] + (BOTTOM[1] - TOP[1]) * blend),
    Math.round(TOP[2] + (BOTTOM[2] - TOP[2]) * blend),
  ];

  const local = intoCard(px, py, art.tilt);
  if (roundedDistance(local.x, local.y, CARD_BOX) > 0) return plate;

  // On the card: bars on the left, a square code on the right.
  if (
    local.y >= art.barArea.y &&
    local.y <= art.barArea.y + art.barArea.height &&
    local.x >= art.barArea.x
  ) {
    let at = art.barArea.x;
    for (let i = 0; i < art.bars.length; i++) {
      const width = art.bars[i];
      if (local.x >= at && local.x < at + width) return i % 2 === 0 ? INK : CARD;
      at += width;
    }
  }

  if (
    local.x >= art.code.x &&
    local.x < art.code.x + art.code.size &&
    local.y >= art.code.y &&
    local.y < art.code.y + art.code.size
  ) {
    const cells = art.cells;
    const cell = art.code.size / cells.length;
    const column = Math.min(cells.length - 1, Math.floor((local.x - art.code.x) / cell));
    const row = Math.min(cells.length - 1, Math.floor((local.y - art.code.y) / cell));
    return cells[row][column] ? INK : CARD;
  }

  return CARD;
}

/**
 * Renders the artwork at one size.
 *
 * Coverage comes from a four by four grid of samples per pixel, which is enough
 * for edges this simple and keeps the sixteen pixel icon from going ragged.
 */
function render(size) {
  const pixels = new Uint8Array(size * size * 4);
  const art = size >= DETAIL_FROM ? DETAILED : SIMPLE;
  // Small sizes get more samples per pixel; there are few of them and the
  // edges are where they live or die.
  const grid = size >= DETAIL_FROM ? 4 : 8;
  const scale = CANVAS / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < grid; sy++) {
        for (let sx = 0; sx < grid; sx++) {
          const px = (x + (sx + 0.5) / grid) * scale;
          const py = (y + (sy + 0.5) / grid) * scale;
          const colour = sample(px, py, art);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          hits++;
        }
      }
      const at = (y * size + x) * 4;
      const total = grid * grid;
      if (hits === 0) continue;
      pixels[at] = Math.round(r / hits);
      pixels[at + 1] = Math.round(g / hits);
      pixels[at + 2] = Math.round(b / hits);
      pixels[at + 3] = Math.round((hits / total) * 255);
    }
  }
  return pixels;
}

// --- PNG ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(pixels, size) {
  return encodePngSized(pixels, size, size);
}

function encodePngSized(pixels, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- output ------------------------------------------------------------------

/**
 * With `--preview`, writes the small sizes magnified with no smoothing.
 *
 * Sixteen pixels is the size that decides whether an icon works, and it is the
 * one size nobody can judge at its own scale.
 */
if (process.argv.includes('--preview')) {
  const sizes = [16, 32, 64];
  const zoom = 12;
  const gap = 8;
  const width = sizes.reduce((total, size) => total + size * zoom + gap, gap);
  const height = Math.max(...sizes) * zoom + gap * 2;
  const sheet = new Uint8Array(width * height * 4);

  let left = gap;
  for (const size of sizes) {
    const pixels = render(size);
    for (let y = 0; y < size * zoom; y++) {
      for (let x = 0; x < size * zoom; x++) {
        const from = (Math.floor(y / zoom) * size + Math.floor(x / zoom)) * 4;
        const to = ((y + gap) * width + left + x) * 4;
        sheet[to] = pixels[from];
        sheet[to + 1] = pixels[from + 1];
        sheet[to + 2] = pixels[from + 2];
        sheet[to + 3] = pixels[from + 3];
      }
    }
    left += size * zoom + gap;
  }

  const out = here('../build/icon-preview.png');
  mkdirSync(here('../build'), { recursive: true });
  writeFileSync(out, encodePngSized(sheet, width, height));
  console.log(`wrote ${out}`);
  process.exit(0);
}

const buildDir = here('../build');
const iconset = `${buildDir}/icon.iconset`;
mkdirSync(iconset, { recursive: true });

/** The sizes macOS wants, each with the name iconutil expects. */
const ENTRIES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

for (const [size, name] of ENTRIES) {
  writeFileSync(`${iconset}/${name}`, encodePng(render(size), size));
}
// A plain PNG as well, for the window and for any platform without .icns.
writeFileSync(`${buildDir}/icon.png`, encodePng(render(512), 512));

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', `${buildDir}/icon.icns`]);
rmSync(iconset, { recursive: true, force: true });
console.log(`wrote ${buildDir}/icon.icns and icon.png`);
