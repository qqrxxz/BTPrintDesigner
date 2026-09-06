/**
 * Renders a sample label at every supported resolution.
 *
 * The layout is written in millimetres exactly as the document model will hold
 * it, so this doubles as a check that a design survives being retargeted from
 * a 203 dpi printer to a 600 dpi one without being redrawn.
 *
 *   node tools/render-sample.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  Bitmap1,
  drawLine,
  drawLinear,
  drawMatrix,
  drawText,
  encodeCode128,
  encodeDataMatrix,
  encodeEan13,
  encodePdf417,
  encodePng,
  encodeQr,
  fillCircle,
  fillRectangle,
  measureText,
  mmToDots,
  renderLinear,
  roundedRectangle,
  strokeCircle,
  Font,
} from '../dist/index.js';

const LABEL_WIDTH_MM = 60;
const LABEL_HEIGHT_MM = 40;

const assets = (name) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
const sans = Font.fromBuffer(readFileSync(assets('DejaVuSansCondensed-Bold.ttf')));
const sansRegular = Font.fromBuffer(readFileSync(assets('DejaVuSansCondensed.ttf')));
const mono = Font.fromBuffer(readFileSync(assets('DejaVuSansMono.ttf')));

function renderLabel(dpi) {
  const mm = (value) => mmToDots(value, dpi);
  const label = new Bitmap1(Math.round(mm(LABEL_WIDTH_MM)), Math.round(mm(LABEL_HEIGHT_MM)));
  const hairline = Math.max(1, Math.round(mm(0.3)));

  roundedRectangle(label, mm(1), mm(1), mm(58), mm(38), mm(2), {
    thickness: Math.max(1, Math.round(mm(0.4))),
  });

  // Header bar with reversed text — the ^FR / REVERSE idiom.
  fillRectangle(label, mm(2), mm(2), mm(56), mm(6));
  const heading = { font: sans, size: mm(4) };
  const headingWidth = measureText('ТОВАРНАЯ ЭТИКЕТКА', heading).width;
  drawText(label, 'ТОВАРНАЯ ЭТИКЕТКА', mm(30) - headingWidth / 2, mm(2.9), heading, {
    anchor: 'top-left',
    mode: 'xor',
  });

  drawText(label, 'Кабель USB-C 2 м', mm(3), mm(9.5), { font: sans, size: mm(4.2) }, {
    anchor: 'top-left',
  });
  drawText(label, 'Braided, 100 W PD', mm(3), mm(14), { font: sansRegular, size: mm(3.2) }, {
    anchor: 'top-left',
  });

  drawLine(label, mm(3), mm(18.5), mm(57), mm(18.5), { thickness: hairline });

  // Fixed pitch, the way a resident printer font lays characters out.
  drawText(
    label,
    'SKU 4820-117-A',
    mm(3),
    mm(19.5),
    { font: mono, size: mm(3.6), fixedAdvance: mm(2.4) },
    { anchor: 'top-left' },
  );

  drawText(label, 'ПАРТИЯ 2026-09', mm(57), mm(36), { font: sansRegular, size: mm(3) }, {
    rotation: 270,
  });

  strokeCircle(label, mm(43), mm(24), mm(12), { thickness: Math.max(1, Math.round(mm(0.4))) });
  fillCircle(label, mm(47), mm(28), mm(3));
  drawLine(label, mm(38), mm(35), mm(50), mm(23), { thickness: hairline });

  // Size ladder. Nothing here is clamped or hinted, so this is where the
  // coverage threshold shows itself: as the cell shrinks, strokes fall below
  // half a dot and drop out, which is exactly how small text dies on a 203 dpi
  // head. At 600 dpi the same ladder stays legible all the way down.
  let y = mm(24.3);
  for (const size of [3.2, 2.6, 2.1, 1.7, 1.4]) {
    drawText(label, `${size} мм Ok 8`, mm(3), y, { font: sansRegular, size: mm(size) }, {
      anchor: 'top-left',
    });
    y += mm(size) + mm(0.6);
  }

  // Rule ladder in whole dots, the unit every printer language speaks.
  let ruleY = mm(25.5);
  for (const dots of [4, 3, 2, 1]) {
    drawLine(label, mm(22), ruleY, mm(31), ruleY, { thickness: dots });
    ruleY += mm(1.9);
  }

  return label;
}

/**
 * A sheet of every symbology, at the module widths a 203 dpi head can hold.
 *
 * Each symbol is drawn at a whole number of dots per module, which is the only
 * way a printed barcode scans reliably, and captioned with what it cost in
 * space — the trade a label designer actually has to make.
 */
function renderBarcodeSheet(dpi) {
  const mm = (value) => mmToDots(value, dpi);
  const sheet = new Bitmap1(Math.round(mm(100)), Math.round(mm(66)));
  const caption = (text, x, y) =>
    drawText(sheet, text, x, y, { font: sansRegular, size: mm(2.6) }, { anchor: 'top-left' });

  const payload = 'SKU-4820-117-A';

  caption(`Code 128  ${payload}`, mm(4), mm(3));
  drawLinear(sheet, encodeCode128(payload), mm(4), mm(6.5), {
    moduleWidth: 2,
    height: Math.round(mm(10)),
  });

  caption('EAN-13  4006381333931', mm(56), mm(3));
  drawLinear(sheet, encodeEan13('400638133393'), mm(56), mm(6.5), {
    moduleWidth: 2,
    height: Math.round(mm(10)),
    descenderExtension: Math.round(mm(1.5)),
  });

  caption('QR, level M', mm(4), mm(20));
  drawMatrix(sheet, encodeQr(payload), mm(4), mm(24), { moduleWidth: 3 });

  caption('Data Matrix', mm(24), mm(20));
  drawMatrix(sheet, encodeDataMatrix(payload), mm(24), mm(24), { moduleWidth: 3 });

  caption('PDF417', mm(42), mm(20));
  drawMatrix(sheet, encodePdf417(payload, { columns: 3 }), mm(42), mm(24), { moduleWidth: 2 });

  // The same symbol at three module widths. This is why module width is a whole
  // number of dots rather than a millimetre measurement: each step is a third
  // more label eaten, and there is nothing in between.
  caption('One Code 128 symbol at module width 1, 2 and 3 dots', mm(4), mm(38));
  const ladder = encodeCode128('48201174');
  let y = mm(42);
  for (const moduleWidth of [1, 2, 3]) {
    const rendered = renderLinear(ladder, { moduleWidth, height: Math.round(mm(6)) });
    sheet.blit(rendered, Math.round(mm(4)), Math.round(y));
    caption(
      `${moduleWidth} dot  ${rendered.width} dots  ${(rendered.width / (dpi / 25.4)).toFixed(1)} mm`,
      mm(58),
      y + mm(1.6),
    );
    y += mm(7.5);
  }

  return sheet;
}

const outDir = fileURLToPath(new URL('../out', import.meta.url));
mkdirSync(outDir, { recursive: true });

{
  const started = performance.now();
  const sheet = renderBarcodeSheet(203);
  const elapsed = performance.now() - started;
  const png = encodePng(sheet, { scale: 2 });
  writeFileSync(`${outDir}/barcodes-203dpi.png`, png);
  console.log(
    `barcode sheet: ${sheet.width}x${sheet.height} dots, ${elapsed.toFixed(1)} ms render, ` +
      `${(png.length / 1024).toFixed(0)} kB png`,
  );
}

for (const dpi of [203, 300, 600]) {
  const started = performance.now();
  const label = renderLabel(dpi);
  const elapsed = performance.now() - started;
  const png = encodePng(label, { scale: dpi === 203 ? 2 : 1 });
  writeFileSync(`${outDir}/sample-${dpi}dpi.png`, png);
  console.log(
    `${dpi} dpi: ${label.width}x${label.height} dots, ${label.countSet()} burnt, ` +
      `${elapsed.toFixed(1)} ms render, ${(png.length / 1024).toFixed(0)} kB png`,
  );
}
