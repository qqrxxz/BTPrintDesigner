import { describe, expect, it } from 'vitest';
import { generateTspl } from '../src/generate/tspl.js';
import { createDocument, type LabelDocument, type LabelElement } from '../src/model/document.js';
import { renderTspl } from '../src/tspl/execute.js';
import { BarcodeFormat, decode, decodeRegion } from './helpers/decode.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

function document(elements: LabelElement[], overrides: Partial<LabelDocument> = {}) {
  return createDocument({ width: 60, height: 40, elements, ...overrides });
}

const generate = (elements: LabelElement[], options = {}, overrides = {}) =>
  generateTspl(document(elements, overrides), options);

/** Runs generated code back through the interpreter — the whole chain. */
function renderGenerated(elements: LabelElement[], overrides = {}) {
  const { source, issues } = generate(elements, {}, overrides);
  const result = renderTspl(source, { fonts: fonts(), dpi: 203 });
  return { source, issues, result, bitmap: result.labels[0]!.bitmap };
}

/** 203 dpi is very nearly eight dots to the millimetre. */
const dots = (mm: number) => Math.round(mm * (203 / 25.4));

describe('job structure', () => {
  it('opens with the size in millimetres and closes with PRINT', () => {
    const lines = generate([]).source.trimEnd().split('\n');
    expect(lines[0]).toBe('SIZE 60 mm, 40 mm');
    expect(lines.at(-1)).toBe('PRINT 1,1');
    expect(lines).toContain('CLS');
  });

  it('emits the gap the document declares', () => {
    const { source } = generate([], {}, { gap: { height: 3, offset: 1 } });
    expect(source).toContain('GAP 3 mm, 1 mm');
  });

  it('omits the setup lines when they are not wanted', () => {
    const { source } = generate([], { includeSetup: false });
    expect(source).not.toContain('GAP');
    expect(source).not.toContain('DIRECTION');
    expect(source).toContain('CLS');
  });

  it('asks for the number of copies requested', () => {
    expect(generate([], { copies: 12 }).source).toContain('PRINT 12,1');
  });
});

describe('text', () => {
  const text = (overrides: Record<string, unknown> = {}): LabelElement => ({
    id: 't',
    type: 'text',
    x: 3,
    y: 4,
    content: 'Cable',
    style: { heightMm: 3 },
    ...overrides,
  } as LabelElement);

  it('uses the scalable font so the height comes out as designed', () => {
    const { source } = generate([text()]);
    expect(source).toContain(`TEXT ${dots(3)},${dots(4)},"0",0,${dots(3)},${dots(3)},1,"Cable"`);
  });

  it('stretches only the width when asked', () => {
    const { source } = generate([text({ style: { heightMm: 3, widthScale: 1.5 } })]);
    expect(source).toContain(`"0",0,${Math.round(dots(3) * 1.5)},${dots(3)}`);
  });

  it('keeps a pinned resident font and its multipliers', () => {
    const { source } = generate([
      text({ style: { heightMm: 3, residentFont: '3', residentMultiplier: { x: 2, y: 2 } } }),
    ]);
    expect(source).toContain('"3",0,2,2,1,"Cable"');
  });

  it('maps alignment onto TSPL\'s numbering', () => {
    expect(generate([text({ align: 'center' })]).source).toMatch(/,2,"Cable"/);
    expect(generate([text({ align: 'right' })]).source).toMatch(/,3,"Cable"/);
  });

  it('becomes a BLOCK when the element has a box', () => {
    const { source } = generate([text({ box: { width: 30, height: 10 } })]);
    expect(source).toContain(`BLOCK ${dots(3)},${dots(4)},${dots(30)},${dots(10)},"0"`);
  });

  it('escapes quotes and backslashes in the content', () => {
    const { source } = generate([text({ content: 'say "hi" \\ bye' })]);
    expect(source).toContain('"say \\"hi\\" \\\\ bye"');
  });

  it('survives the escaping intact through the interpreter', () => {
    const { source } = generate([text({ content: 'say "hi" \\ bye' })]);
    const command = renderTspl(source, { fonts: fonts() }).commands.find(
      (candidate) => candidate.name === 'TEXT',
    )!;
    expect(command.arguments.at(-1)!.value).toBe('say "hi" \\ bye');
  });
});

describe('shapes', () => {
  it('draws a solid rectangle as BAR', () => {
    const { source, bitmap } = renderGenerated([
      { id: 'r', type: 'rectangle', x: 5, y: 5, width: 10, height: 5, fill: 'solid' },
    ]);
    expect(source).toContain(`BAR ${dots(5)},${dots(5)},${dots(10)},${dots(5)}`);
    expect(bitmap.get(dots(5), dots(5))).toBe(1);
    expect(bitmap.get(dots(5) + dots(10) - 1, dots(5) + dots(5) - 1)).toBe(1);
    expect(bitmap.get(dots(5) + dots(10), dots(5))).toBe(0);
  });

  it('draws an outline as BOX with inclusive far corners', () => {
    const { source, bitmap } = renderGenerated([
      { id: 'r', type: 'rectangle', x: 5, y: 5, width: 10, height: 5, fill: 'outline', lineWidth: 0.5 },
    ]);
    expect(source).toContain(`BOX ${dots(5)},${dots(5)},${dots(5) + dots(10) - 1},`);
    // The far edge lands inside the designed rectangle, not one dot past it.
    expect(bitmap.get(dots(5) + dots(10) - 1, dots(5) + 2)).toBe(1);
    expect(bitmap.get(dots(5) + dots(10), dots(5) + 2)).toBe(0);
  });

  it('adds a corner radius only when there is one', () => {
    const square = generate([
      { id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill: 'outline' },
    ]).source;
    const rounded = generate([
      { id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 10, fill: 'outline', cornerRadius: 2 },
    ]).source;
    expect(square.match(/BOX [^\n]*/)![0].split(',')).toHaveLength(5);
    expect(rounded.match(/BOX [^\n]*/)![0].split(',')).toHaveLength(6);
  });

  it('draws a horizontal line as a thin bar', () => {
    const { bitmap } = renderGenerated([
      { id: 'l', type: 'line', x: 5, y: 10, x2: 25, y2: 10, thickness: 0.4 },
    ]);
    expect(bitmap.get(dots(5), dots(10))).toBe(1);
    expect(bitmap.get(dots(24), dots(10))).toBe(1);
    expect(bitmap.get(dots(5) - 1, dots(10))).toBe(0);
  });

  it('draws a vertical line as a thin bar', () => {
    const { bitmap } = renderGenerated([
      { id: 'l', type: 'line', x: 10, y: 5, x2: 10, y2: 25, thickness: 0.4 },
    ]);
    expect(bitmap.get(dots(10), dots(6))).toBe(1);
    expect(bitmap.get(dots(10), dots(24))).toBe(1);
  });

  it('refuses a diagonal line, because TSPL has no command for one', () => {
    const { issues, source } = generate([
      { id: 'l', type: 'line', x: 5, y: 5, x2: 25, y2: 20, thickness: 0.4 },
    ]);
    expect(issues[0]).toMatchObject({ severity: 'error', elementId: 'l' });
    expect(issues[0]!.message).toMatch(/no diagonal line command/);
    expect(source).not.toContain('BAR');
  });
});

describe('barcodes', () => {
  const barcode = (overrides: Record<string, unknown> = {}): LabelElement => ({
    id: 'b',
    type: 'barcode',
    x: 4,
    y: 6,
    symbology: 'code128',
    data: '4820-117-A',
    moduleWidth: 0.25,
    height: 10,
    ...overrides,
  } as LabelElement);

  it('names each symbology the way TSPL spells it', () => {
    const names: [string, string][] = [
      ['code128', '"128"'],
      ['gs1-128', '"EAN128"'],
      ['code39', '"39"'],
      ['itf', '"25"'],
      ['ean13', '"EAN13"'],
      ['ean8', '"EAN8"'],
      ['upca', '"UPCA"'],
      ['upce', '"UPCE"'],
    ];
    for (const [symbology, spelling] of names) {
      expect(generate([barcode({ symbology, data: '12345670' })]).source).toContain(spelling);
    }
  });

  it('switches to the check-digit spelling where the symbology has one', () => {
    expect(generate([barcode({ symbology: 'code39', checkDigit: true })]).source).toContain('"39C"');
    expect(
      generate([barcode({ symbology: 'itf', data: '12345678', checkDigit: true })]).source,
    ).toContain('"25C"');
  });

  it('ignores a check digit request where the symbology has none', () => {
    expect(generate([barcode({ checkDigit: true })]).source).toContain('"128"');
  });

  it('asks for the human-readable line when the element wants it', () => {
    expect(generate([barcode({ humanReadable: true })]).source).toMatch(/,1,0,\d+,\d+,/);
  });

  it('warns when snapping the module width changes the printed size', () => {
    // 0.05 mm is 0.4 dots; it prints as one, which is more than twice as wide.
    const { issues } = generate([barcode({ moduleWidth: 0.05 })]);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toMatch(/prints as 1/);
  });

  it('says nothing when the snap is invisible', () => {
    // 0.25 mm is almost exactly two dots at 203 dpi.
    expect(generate([barcode({ moduleWidth: 0.25 })]).issues).toHaveLength(0);
  });

  it('produces a Code 128 that decodes after the round trip', () => {
    const { bitmap } = renderGenerated([barcode({ moduleWidth: 0.4, height: 12 })], {
      width: 90,
      height: 40,
    });
    expect(decode(bitmap, [BarcodeFormat.CODE_128])).toBe('4820-117-A');
  });

  it('produces an EAN-13 that decodes after the round trip', () => {
    const { bitmap } = renderGenerated(
      [barcode({ symbology: 'ean13', data: '400638133393', moduleWidth: 0.4, height: 12 })],
      { width: 90, height: 40 },
    );
    expect(decode(bitmap, [BarcodeFormat.EAN_13])).toBe('4006381333931');
  });
});

describe('two-dimensional symbols', () => {
  const matrix = (overrides: Record<string, unknown> = {}): LabelElement => ({
    id: 'm',
    type: 'matrix',
    x: 5,
    y: 5,
    symbology: 'qr',
    data: 'https://example.com/p/4820',
    moduleWidth: 0.5,
    ...overrides,
  } as LabelElement);

  it('emits QRCODE with the requested error correction and cell size', () => {
    const { source } = generate([matrix({ errorCorrection: 'Q' })]);
    expect(source).toMatch(/QRCODE \d+,\d+,Q,4,A,0,/);
  });

  it('produces a QR code that decodes after the round trip', () => {
    const { bitmap } = renderGenerated([matrix()], { width: 60, height: 60 });
    expect(decode(bitmap, [BarcodeFormat.QR_CODE])).toBe('https://example.com/p/4820');
  });

  it('measures the Data Matrix box by encoding the symbol', () => {
    const { source } = generate([matrix({ symbology: 'datamatrix', data: 'SKU-4820' })]);
    const command = source.match(/DMATRIX [^\n]*/)![0].split(',');
    // A square symbol at four dots a module: both sides equal and a multiple of four.
    expect(command[2]).toBe(command[3]);
    expect(Number(command[2]) % 4).toBe(0);
  });

  it('produces a Data Matrix that decodes after the round trip', () => {
    const { bitmap } = renderGenerated([matrix({ symbology: 'datamatrix', data: 'SKU-4820' })], {
      width: 40,
      height: 40,
    });
    // A 14 by 14 symbol at four dots a module, five millimetres in from the
    // corner; the reader needs to be told where to look.
    expect(
      decodeRegion(
        bitmap,
        { x: dots(5), y: dots(5), width: 14 * 4, height: 14 * 4 },
        [BarcodeFormat.DATA_MATRIX],
      ),
    ).toBe('SKU-4820');
  });

  it('produces a PDF417 that decodes after the round trip', () => {
    const { bitmap } = renderGenerated(
      [matrix({ symbology: 'pdf417', data: 'SKU-4820-117-A', moduleWidth: 0.3, columns: 3 })],
      { width: 90, height: 40 },
    );
    expect(decode(bitmap, [BarcodeFormat.PDF_417])).toBe('SKU-4820-117-A');
  });

  it('reports data the symbology cannot hold instead of emitting a broken line', () => {
    const { issues, source } = generate([
      matrix({ symbology: 'pdf417', data: 'x'.repeat(5000) }),
    ]);
    expect(issues[0]!.severity).toBe('error');
    expect(source).not.toContain('PDF417');
  });
});

describe('placeholders', () => {
  const templated: LabelElement[] = [
    {
      id: 't',
      type: 'text',
      x: 3,
      y: 3,
      content: 'SKU {{sku}}',
      style: { heightMm: 3 },
    },
    {
      id: 'b',
      type: 'barcode',
      x: 3,
      y: 10,
      symbology: 'code128',
      data: '{{sku}}',
      moduleWidth: 0.4,
      height: 10,
    },
  ];

  it('substitutes the document\'s sample data by default', () => {
    const { source } = generate(templated, {}, { sampleData: { sku: '4820-117-A' } });
    expect(source).toContain('"SKU 4820-117-A"');
    expect(source).toContain('"4820-117-A"');
  });

  it('prefers values passed to the generator over the sample data', () => {
    const { source } = generate(
      templated,
      { data: { sku: 'RUN-VALUE' } },
      { sampleData: { sku: '4820-117-A' } },
    );
    expect(source).toContain('"SKU RUN-VALUE"');
  });

  it('leaves an unresolved placeholder in the code and warns once per element', () => {
    const { source, issues } = generate(templated);
    expect(source).toContain('{{sku}}');
    expect(issues.filter((issue) => issue.elementId === 't')).toHaveLength(1);
    expect(issues.filter((issue) => issue.elementId === 'b')).toHaveLength(1);
  });

  it('carries a substituted value through to a scannable barcode', () => {
    const { source } = generate(templated, {}, { sampleData: { sku: '4820-117-A' } });
    const rendered = renderTspl(source, { fonts: fonts(), dpi: 203 });
    expect(decode(rendered.labels[0]!.bitmap, [BarcodeFormat.CODE_128])).toBe('4820-117-A');
  });
});

describe('resolution', () => {
  it('keeps the physical layout when the printer changes', () => {
    const elements: LabelElement[] = [
      { id: 'r', type: 'rectangle', x: 10, y: 10, width: 20, height: 10, fill: 'solid' },
    ];
    for (const dpi of [203, 300, 600] as const) {
      const { source } = generateTspl(document(elements), { dpi });
      const rendered = renderTspl(source, { fonts: fonts(), dpi });
      const image = rendered.labels[0]!.bitmap;
      const perMm = dpi / 25.4;
      // The bar occupies the same tenth to thirtieth millimetre at every
      // resolution, which is the whole point of storing millimetres.
      expect(image.get(Math.round(15 * perMm), Math.round(15 * perMm))).toBe(1);
      expect(image.get(Math.round(31 * perMm), Math.round(15 * perMm))).toBe(0);
      // Within one per cent of the designed area at every resolution; the
      // remainder is the rounding of two edges onto the dot grid.
      const designed = 20 * 10 * perMm * perMm;
      expect(Math.abs(image.countSet() - designed) / designed).toBeLessThan(0.01);
    }
  });
});
