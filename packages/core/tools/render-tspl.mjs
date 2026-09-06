/**
 * Renders a TSPL file to PNG.
 *
 *   node tools/render-tspl.mjs label.tspl [out.png] [dpi]
 *
 * With no arguments it renders the built-in sample, which is the quickest way
 * to see whether the interpreter still works after a change.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng, Font, renderTspl } from '../dist/index.js';

const assets = (name) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
const fonts = {
  scalable: Font.fromBuffer(readFileSync(assets('DejaVuSansCondensed-Bold.ttf'))),
  fixed: Font.fromBuffer(readFileSync(assets('DejaVuSansMono.ttf'))),
};

const SAMPLE = `SIZE 60 mm, 40 mm
GAP 2 mm, 0
DIRECTION 0
CLS
BOX 8,8,471,311,3,12
TEXT 240,26,"0",0,30,30,2,"ТОВАРНАЯ ЭТИКЕТКА"
REVERSE 16,16,447,48
TEXT 24,76,"0",0,36,36,"Кабель USB-C 2 м"
TEXT 24,116,"3",0,1,1,"Braided, 100 W PD"
BAR 24,148,415,2
TEXT 24,158,"2",0,1,1,"SKU 4820-117-A"
BARCODE 24,190,"128",60,1,0,2,4,"4820-117-A"
QRCODE 300,150,M,4,A,0,"https://example.com/p/4820-117-A"
BLOCK 24,268,260,40,"1",0,1,1,0,1,"Партия 2026-09, хранить в сухом месте"
PRINT 1,1
`;

const [, , inputPath, outputPath, dpiArgument] = process.argv;
const source = inputPath ? readFileSync(inputPath, 'utf8') : SAMPLE;
const dpi = Number(dpiArgument ?? 203);

const result = renderTspl(source, { fonts, dpi });

for (const diagnostic of result.diagnostics) {
  console.log(
    `${diagnostic.severity}: line ${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`,
  );
}

const outDir = fileURLToPath(new URL('../out', import.meta.url));
mkdirSync(outDir, { recursive: true });

result.labels.forEach((label, index) => {
  const suffix = result.labels.length > 1 ? `-${index + 1}` : '';
  const target = outputPath ?? `${outDir}/tspl${suffix}-${dpi}dpi.png`;
  writeFileSync(target, encodePng(label.bitmap, { scale: dpi <= 203 ? 2 : 1 }));
  console.log(
    `${target}: ${label.bitmap.width}x${label.bitmap.height} dots, ` +
      `${label.widthMm.toFixed(1)} x ${label.heightMm.toFixed(1)} mm, ${label.copies} copy`,
  );
});
