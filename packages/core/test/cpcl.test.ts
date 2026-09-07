import { describe, expect, it } from 'vitest';
import { renderCpcl } from '../src/cpcl/execute.js';
import { parseCpcl } from '../src/cpcl/parse.js';
import { generateCpcl } from '../src/generate/cpcl.js';
import { importCpcl } from '../src/import/cpcl.js';
import { createDocument, type LabelDocument, type LabelElement } from '../src/model/document.js';
import { BarcodeFormat, decode, decodeRegion } from './helpers/decode.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

const render = (source: string, width = 576) =>
  renderCpcl(source, { fonts: fonts(), defaultWidthDots: width });

const label = (source: string, width?: number) => render(source, width).labels[0]!.bitmap;

const errors = (result: ReturnType<typeof render>) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

const cpcl = (...lines: string[]): string => `${lines.join('\n')}\n`;
const job = (...lines: string[]): string =>
  cpcl('! 0 200 200 300 1', 'PAGE-WIDTH 576', ...lines, 'FORM', 'PRINT');

const perMm = 203 / 25.4;
const mm = (dotCount: number) => Math.round((dotCount / perMm) * 100) / 100;

describe('parsing', () => {
  it('reads the header as a command of its own', () => {
    const { commands } = parseCpcl('! 0 200 200 406 1\nFORM\nPRINT');
    expect(commands[0]).toMatchObject({ name: '!', parameters: ['0', '200', '200', '406', '1'] });
  });

  it('keeps the spacing inside text data', () => {
    // Two columns lined up with runs of spaces would be ruined by re-joining
    // the tokens, so the tail is taken from the source as written.
    const source = 'TEXT 7 24 10 20 SKU     4820';
    const { commands } = parseCpcl(source);
    expect(commands[0]!.parameters.slice(0, 4)).toEqual(['7', '24', '10', '20']);
    const rendered = render(job(source));
    expect(rendered.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('skips blank lines and both comment spellings', () => {
    const { commands } = parseCpcl('! 0 200 200 100 1\n\n; a note\n// another\nPRINT');
    expect(commands.map((command) => command.name)).toEqual(['!', 'PRINT']);
  });

  it('warns when a job does not start with its header', () => {
    const { diagnostics } = parseCpcl('TEXT 7 24 0 0 hello\nPRINT');
    expect(diagnostics[0]).toMatchObject({ code: 'cpcl.missing-header' });
  });

  it('handles an empty source', () => {
    expect(parseCpcl('').commands).toEqual([]);
  });
});

describe('the interpreter', () => {
  it('takes the label height from the header and the width from PAGE-WIDTH', () => {
    const image = label(cpcl('! 0 200 200 240 1', 'PAGE-WIDTH 400', 'FORM', 'PRINT'));
    expect(image.width).toBe(400);
    expect(image.height).toBe(240);
  });

  it('reports the copies the header asks for', () => {
    expect(render(cpcl('! 0 200 200 100 3', 'PRINT')).labels[0]!.copies).toBe(3);
  });

  it('draws a box with the corners it names, inclusive', () => {
    const image = label(job('BOX 10 10 59 39 1'));
    expect(image.get(10, 10)).toBe(1);
    expect(image.get(59, 39)).toBe(1);
    expect(image.get(60, 39)).toBe(0);
    expect(image.get(30, 25)).toBe(0);
  });

  it('fills a box whose border meets in the middle', () => {
    expect(label(job('BOX 10 10 29 29 20')).countSet()).toBe(400);
  });

  it('draws a horizontal and a vertical line', () => {
    const horizontal = label(job('LINE 10 20 109 20 3'));
    expect(horizontal.countSet()).toBe(100 * 3);
    const vertical = label(job('LINE 20 10 20 109 3'));
    expect(vertical.countSet()).toBe(100 * 3);
  });

  it('draws a sloped line, which CPCL allows and TSPL does not', () => {
    const image = label(job('LINE 10 10 110 60 2'));
    expect(image.countSet()).toBeGreaterThan(80);
    // The stroke hangs to one side of the corner-to-corner line, so the first
    // row starts a dot or so in rather than exactly on the corner.
    expect(image.crop(9, 9, 5, 5).countSet()).toBeGreaterThan(0);
    expect(image.crop(106, 56, 6, 6).countSet()).toBeGreaterThan(0);
  });

  it('inverts a band with INVERSE-LINE, which is how CPCL makes white text', () => {
    const image = label(job('TEXT 7 24 20 20 WHITE', 'INVERSE-LINE 10 10 200 10 40'));
    expect(image.get(11, 12)).toBe(1);
    expect(image.countSet()).toBeLessThan(191 * 40);
  });

  it('offsets everything by the header offset', () => {
    const shifted = label(cpcl('! 30 200 200 200 1', 'BOX 10 10 29 29 20', 'FORM', 'PRINT'));
    expect(shifted.get(45, 15)).toBe(1);
    expect(shifted.get(15, 15)).toBe(0);
  });

  it('centres text on the anchor when told to', () => {
    const left = label(job('TEXT 7 24 200 20 WIDE'));
    const centred = label(job('CENTER 400', 'TEXT 7 24 0 20 WIDE', 'LEFT'));
    expect(centred.crop(0, 0, 200, 60).countSet()).toBeGreaterThan(0);
    expect(left.crop(0, 0, 200, 60).countSet()).toBe(0);
  });

  it('magnifies text in whole multiples', () => {
    const plain = label(job('TEXT 7 24 10 10 X'));
    const doubled = label(job('SETMAG 2 2', 'TEXT 7 24 10 10 X'));
    expect(doubled.countSet()).toBeGreaterThan(plain.countSet() * 2);
  });

  it('says once that a size index is approximate, and still draws', () => {
    const result = render(job('TEXT 4 2 10 10 Cable', 'TEXT 4 2 10 40 Cable'));
    const notes = result.diagnostics.filter((entry) => entry.code === 'cpcl.font-approximate');
    expect(notes).toHaveLength(1);
    expect(result.labels[0]!.bitmap.countSet()).toBeGreaterThan(0);
  });

  it('warns about an image and renders the rest', () => {
    const result = render(job('PCX 10 10 !<logo.pcx', 'BOX 10 10 29 29 20'));
    expect(result.diagnostics.some((entry) => entry.code === 'cpcl.image-not-drawn')).toBe(true);
    expect(result.labels[0]!.bitmap.countSet()).toBe(400);
  });

  it('warns about an unknown command', () => {
    expect(render(job('FROBNICATE 1 2')).diagnostics[0]).toMatchObject({
      code: 'cpcl.unknown-command',
    });
  });

  it('never throws, whatever it is handed', () => {
    expect(() => render('!\nTEXT\nBOX\nB QR\nBARCODE\nENDQR\nPRINT')).not.toThrow();
    expect(() => render('')).not.toThrow();
  });
});

describe('barcodes', () => {
  it('renders a Code 128 that decodes', () => {
    const image = label(job('BARCODE 128 2 4 80 20 20 4820-117-A'), 700);
    expect(decode(image, [BarcodeFormat.CODE_128])).toBe('4820-117-A');
  });

  it('renders Code 39 and interleaved 2 of 5', () => {
    expect(decode(label(job('BARCODE 39 2 6 80 20 20 ABC-123'), 900), [BarcodeFormat.CODE_39])).toBe(
      'ABC-123',
    );
    expect(
      decode(label(job('BARCODE I2OF5 3 9 80 20 20 12345678'), 900), [BarcodeFormat.ITF]),
    ).toBe('12345678');
  });

  it('renders an EAN-13 that decodes', () => {
    expect(
      decode(label(job('BARCODE EAN13 3 6 80 20 20 400638133393'), 700), [BarcodeFormat.EAN_13]),
    ).toBe('4006381333931');
  });

  it('adds a readable line only between BARCODE-TEXT and its OFF', () => {
    const without = label(job('BARCODE 128 2 4 80 20 20 ABC'), 700);
    const withText = label(
      job('BARCODE-TEXT 7 18 5', 'BARCODE 128 2 4 80 20 20 ABC', 'BARCODE-TEXT OFF'),
      700,
    );
    expect(withText.countSet()).toBeGreaterThan(without.countSet());
    const afterOff = label(
      job('BARCODE-TEXT 7 18 5', 'BARCODE-TEXT OFF', 'BARCODE 128 2 4 80 20 20 ABC'),
      700,
    );
    expect(afterOff.countSet()).toBe(without.countSet());
  });

  it('renders a QR code from the block that follows it', () => {
    const image = label(job('B QR 20 20 M 2 U 6', 'MA,https://example.com/p/4820', 'ENDQR'), 400);
    expect(decode(image, [BarcodeFormat.QR_CODE])).toBe('https://example.com/p/4820');
  });

  it('takes the QR error correction from the payload, as CPCL does', () => {
    const low = label(job('B QR 20 20 M 2 U 4', 'LA,SKU-4820', 'ENDQR'), 400);
    const high = label(job('B QR 20 20 M 2 U 4', 'HA,SKU-4820', 'ENDQR'), 400);
    expect(high.countSet()).not.toBe(low.countSet());
  });

  it('renders a PDF417 from its block', () => {
    const image = label(
      job('B PDF-417 20 20 XD 3 YD 9 C 3', 'SKU-4820-117-A', 'ENDPDF'),
      700,
    );
    expect(decode(image, [BarcodeFormat.PDF_417])).toBe('SKU-4820-117-A');
  });

  it('reports a payload the symbology cannot hold', () => {
    expect(errors(render(job('BARCODE EAN13 3 6 80 20 20 not-digits')))[0]!.code).toBe(
      'cpcl.barcode-failed',
    );
  });

  it('says which symbologies it does not draw rather than drawing something else', () => {
    const result = render(job('BARCODE DATAMATRIX 20 20 SKU'));
    expect(result.diagnostics[0]!.code).toBe('cpcl.symbology-unsupported');
  });
});

describe('generating CPCL', () => {
  const document = (elements: LabelElement[], overrides: Partial<LabelDocument> = {}) =>
    createDocument({ width: 60, height: 40, elements, ...overrides });

  const generate = (elements: LabelElement[], overrides = {}) =>
    generateCpcl(document(elements, overrides), { dpi: 203 });

  it('opens with the header and closes with FORM and PRINT', () => {
    const lines = generate([]).source.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^! 0 200 200 \d+ 1$/);
    expect(lines.at(-2)).toBe('FORM');
    expect(lines.at(-1)).toBe('PRINT');
  });

  it('writes text with the scalable font and a height in dots', () => {
    const { source } = generate([
      { id: 't', type: 'text', x: 5, y: 5, content: 'Cable', style: { heightMm: 4 } },
    ]);
    expect(source).toMatch(/^TEXT 7 \d+ \d+ \d+ Cable$/m);
  });

  it('brackets a justified line and puts it back to the left afterwards', () => {
    const { source } = generate([
      {
        id: 't',
        type: 'text',
        x: 30,
        y: 5,
        content: 'Centred',
        align: 'center',
        style: { heightMm: 4 },
      },
    ]);
    const lines = source.trimEnd().split('\n');
    const at = lines.findIndex((line) => line.startsWith('CENTER'));
    expect(lines[at + 1]).toContain('Centred');
    expect(lines[at + 2]).toBe('LEFT');
  });

  it('draws a solid rectangle as a box thick enough to fill', () => {
    const { source } = generate([
      { id: 'r', type: 'rectangle', x: 5, y: 5, width: 10, height: 5, fill: 'solid' },
    ]);
    const box = source.match(/^BOX .*/m)![0].split(' ');
    expect(Number(box[5])).toBeGreaterThanOrEqual(Math.min(Number(box[3]), Number(box[4])) / 2);
  });

  it('inverts with INVERSE-LINE', () => {
    expect(
      generate([{ id: 'r', type: 'rectangle', x: 1, y: 1, width: 20, height: 6, fill: 'invert' }])
        .source,
    ).toMatch(/^INVERSE-LINE /m);
  });

  it('refuses to erase, because CPCL has no white shape', () => {
    const { issues, source } = generate([
      { id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 5, fill: 'erase' },
    ]);
    expect(issues[0]).toMatchObject({ severity: 'error', code: 'generate.cpcl-no-erase' });
    expect(source).not.toContain('BOX');
  });

  it('says a corner radius will not print, and prints the box anyway', () => {
    const { issues, source } = generate([
      {
        id: 'r',
        type: 'rectangle',
        x: 1,
        y: 1,
        width: 20,
        height: 10,
        fill: 'outline',
        cornerRadius: 2,
      },
    ]);
    expect(issues[0]!.code).toBe('generate.cpcl-no-rounding');
    expect(source).toMatch(/^BOX /m);
  });

  it('refuses a Data Matrix and names the symbologies that do work', () => {
    const { issues } = generate([
      { id: 'm', type: 'matrix', x: 5, y: 5, symbology: 'datamatrix', data: 'X', moduleWidth: 0.5 },
    ]);
    expect(issues[0]!.code).toBe('generate.cpcl-no-datamatrix');
    expect(issues[0]!.message).toMatch(/QR code or a PDF417/);
  });

  it('draws a diagonal line, which CPCL allows', () => {
    expect(
      generate([{ id: 'l', type: 'line', x: 5, y: 5, x2: 25, y2: 20, thickness: 0.4 }]).source,
    ).toMatch(/^LINE /m);
  });
});

describe('the CPCL round trip', () => {
  const original = createDocument({
    width: 60,
    height: 40,
    elements: [
      { id: 'a', type: 'rectangle', x: 1, y: 1, width: 58, height: 38, fill: 'outline', lineWidth: 0.4 },
      { id: 'b', type: 'text', x: 4, y: 5, content: 'Cable USB-C', style: { heightMm: 4 } },
      {
        id: 'c',
        type: 'barcode',
        x: 4,
        y: 17,
        symbology: 'code128',
        data: '4820-117-A',
        moduleWidth: 0.25,
        height: 11,
        humanReadable: true,
      },
      {
        id: 'd',
        type: 'matrix',
        x: 40,
        y: 15,
        symbology: 'qr',
        data: 'https://example.com',
        moduleWidth: 0.5,
        errorCorrection: 'M',
      },
      { id: 'e', type: 'line', x: 4, y: 32, x2: 56, y2: 32, thickness: 0.4 },
    ],
  });

  it('links a job it wrote itself', () => {
    const generated = generateCpcl(original, { dpi: 203 });
    expect(generated.issues).toEqual([]);
    const back = importCpcl(generated.source, { dpi: 203 });
    expect(back.unmapped).toEqual([]);
    expect(back.mode).toBe('linked');
    expect(back.document.elements).toHaveLength(5);
  });

  it('prints the same label after a trip through the model', () => {
    const first = generateCpcl(original, { dpi: 203 });
    const back = importCpcl(first.source, { dpi: 203 });
    const second = generateCpcl(back.document, { dpi: 203 });
    expect(label(second.source, 480).equals(label(first.source, 480))).toBe(true);
  });

  it('settles after one trip, so the second changes nothing', () => {
    const once = generateCpcl(importCpcl(generateCpcl(original, { dpi: 203 }).source).document, {
      dpi: 203,
    }).source;
    const twice = generateCpcl(importCpcl(once).document, { dpi: 203 }).source;
    expect(twice).toBe(once);
  });

  it('carries the barcode through the loop readably', () => {
    const generated = generateCpcl(original, { dpi: 203 });
    const rendered = render(generated.source, 480);
    const outline = rendered.bounds.find((entry) => entry.line === generated.origins['c'])!;
    expect(decodeRegion(rendered.labels[0]!.bitmap, outline, [BarcodeFormat.CODE_128])).toBe(
      '4820-117-A',
    );
  });

  it('detaches on a command the canvas cannot hold', () => {
    const result = importCpcl(job('PCX 10 10 !<logo.pcx'));
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.code).toBe('import.image');
  });

  it('detaches on a unit mode, which changes every coordinate after it', () => {
    const result = importCpcl(job('IN-MILLIMETERS', 'BOX 1 1 5 5 1'));
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.reason).toMatch(/every following coordinate/);
  });

  it('keeps printer settings verbatim', () => {
    expect(importCpcl(job('SPEED 3', 'TONE 10', 'BOX 1 1 9 9 9')).document.preamble).toEqual([
      'SPEED 3',
      'TONE 10',
    ]);
  });

  it('reads a box back with the size it was given', () => {
    const element = importCpcl(job('BOX 16 24 95 63 3')).document.elements[0]!;
    expect(element).toMatchObject({ x: mm(16), y: mm(24), width: mm(80), height: mm(40) });
  });
});
