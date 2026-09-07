/**
 * Builds a label document, generates TSPL from it, renders that TSPL, and
 * writes both out. This is the whole second milestone in one run: what the
 * canvas holds becomes code, and the code becomes the picture.
 *
 *   node tools/render-model.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createDocument,
  encodePng,
  Font,
  generateCpcl,
  generateTspl,
  generateZpl,
  renderCpcl,
  renderTspl,
  renderZpl,
  serializeDocument,
} from '../dist/index.js';

const assets = (name) => fileURLToPath(new URL(`../assets/fonts/${name}`, import.meta.url));
const fonts = {
  scalable: Font.fromBuffer(readFileSync(assets('DejaVuSansCondensed-Bold.ttf'))),
  fixed: Font.fromBuffer(readFileSync(assets('DejaVuSansMono.ttf'))),
};

const document = createDocument({
  name: 'Кабель USB-C',
  width: 60,
  height: 40,
  gap: { height: 2, offset: 0 },
  sampleData: {
    sku: '4820-117-A',
    title: 'Кабель USB-C 2 м',
    lot: '2026-09',
  },
  elements: [
    {
      id: 'border',
      name: 'Рамка',
      type: 'rectangle',
      x: 1,
      y: 1,
      width: 58,
      height: 38,
      fill: 'outline',
      lineWidth: 0.4,
      cornerRadius: 1.5,
    },
    {
      id: 'header',
      name: 'Заголовок',
      type: 'text',
      x: 30,
      y: 3.2,
      content: '{{title}}',
      align: 'center',
      style: { heightMm: 4 },
    },
    {
      id: 'rule',
      name: 'Линейка',
      type: 'line',
      x: 4,
      y: 9.5,
      x2: 56,
      y2: 9.5,
      thickness: 0.4,
    },
    {
      id: 'sku',
      type: 'text',
      x: 4,
      y: 11,
      content: 'SKU {{sku}}',
      style: { heightMm: 3.2, residentFont: '3', residentMultiplier: { x: 1, y: 1 } },
    },
    {
      id: 'code',
      name: 'Штрихкод',
      type: 'barcode',
      x: 4,
      y: 17,
      symbology: 'code128',
      data: '{{sku}}',
      moduleWidth: 0.25,
      height: 11,
      humanReadable: true,
    },
    {
      id: 'qr',
      type: 'matrix',
      x: 40,
      y: 15,
      symbology: 'qr',
      data: 'https://example.com/p/{{sku}}',
      moduleWidth: 0.45,
      errorCorrection: 'M',
    },
    {
      id: 'note',
      type: 'text',
      x: 4,
      y: 33,
      content: 'Партия {{lot}}, хранить в сухом месте',
      style: { heightMm: 2.4, lineGapMm: 0.4 },
      box: { width: 34, height: 6 },
    },
  ],
});

const outDir = fileURLToPath(new URL('../out', import.meta.url));
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/model.btpd.json`, serializeDocument(document));

// The same document in the third language. CPCL is the narrowest of them, and
// what it cannot say is reported rather than approximated.
{
  const dpi = 203;
  const { source, issues } = generateCpcl(document, { dpi });
  for (const issue of issues) {
    console.log(`cpcl ${issue.severity}: ${issue.elementId ?? 'document'}: ${issue.message}`);
  }
  writeFileSync(`${outDir}/model-${dpi}dpi.cpcl`, source);
  const rendered = renderCpcl(source, {
    fonts,
    dpi,
    defaultWidthDots: Math.round(document.width * (dpi / 25.4)),
  });
  for (const diagnostic of rendered.diagnostics) {
    console.log(`cpcl ${diagnostic.severity}: line ${diagnostic.line}: ${diagnostic.message}`);
  }
  const label = rendered.labels[0];
  writeFileSync(`${outDir}/model-${dpi}dpi-cpcl.png`, encodePng(label.bitmap, { scale: 2 }));
  console.log(`cpcl ${dpi} dpi: ${label.bitmap.width}x${label.bitmap.height} dots`);
}

// The same document in the other language, which is the point of keeping the
// model language-neutral.
{
  const dpi = 203;
  const { source, issues } = generateZpl(document, { dpi });
  for (const issue of issues) {
    console.log(`zpl ${issue.severity}: ${issue.elementId ?? 'document'}: ${issue.message}`);
  }
  writeFileSync(`${outDir}/model-${dpi}dpi.zpl`, source);
  const perMm = dpi / 25.4;
  const rendered = renderZpl(source, {
    fonts,
    dpi,
    defaultWidthDots: Math.round(document.width * perMm),
    defaultHeightDots: Math.round(document.height * perMm),
  });
  for (const diagnostic of rendered.diagnostics) {
    console.log(`zpl ${diagnostic.severity}: line ${diagnostic.line}: ${diagnostic.message}`);
  }
  const label = rendered.labels[0];
  writeFileSync(`${outDir}/model-${dpi}dpi-zpl.png`, encodePng(label.bitmap, { scale: 2 }));
  console.log(`zpl ${dpi} dpi: ${label.bitmap.width}x${label.bitmap.height} dots`);
}

for (const dpi of [203, 300]) {
  const { source, issues } = generateTspl(document, { dpi });
  for (const issue of issues) {
    console.log(`${issue.severity}: ${issue.elementId ?? 'document'}: ${issue.message}`);
  }
  writeFileSync(`${outDir}/model-${dpi}dpi.tspl`, source);

  const rendered = renderTspl(source, { fonts, dpi });
  for (const diagnostic of rendered.diagnostics) {
    console.log(`${diagnostic.severity}: line ${diagnostic.line}: ${diagnostic.message}`);
  }
  const label = rendered.labels[0];
  writeFileSync(
    `${outDir}/model-${dpi}dpi.png`,
    encodePng(label.bitmap, { scale: dpi <= 203 ? 2 : 1 }),
  );
  console.log(
    `${dpi} dpi: ${source.trimEnd().split('\n').length} lines of TSPL, ` +
      `${label.bitmap.width}x${label.bitmap.height} dots`,
  );
}
