import { describe, expect, it } from 'vitest';
import { generateTspl } from '../src/generate/tspl.js';
import { importTspl } from '../src/import/tspl.js';
import { createDocument, type LabelDocument, type LabelElement } from '../src/model/document.js';
import { renderTspl } from '../src/tspl/execute.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });
const tspl = (...lines: string[]): string => `${lines.join('\n')}\n`;

const body = (...lines: string[]): string =>
  tspl('SIZE 60 mm, 40 mm', 'GAP 2 mm, 0 mm', 'DIRECTION 0', 'CLS', ...lines, 'PRINT 1,1');

const single = (line: string): LabelElement => importTspl(body(line)).document.elements[0]!;

/**
 * 203 dpi is 7.992 dots to the millimetre, not eight, so expected measurements
 * are computed the same way the importer computes them rather than rounded by
 * eye.
 */
const perMm = 203 / 25.4;
const mm = (dotCount: number) => Math.round((dotCount / perMm) * 100) / 100;

describe('label setup', () => {
  it('reads the size, whatever unit it is written in', () => {
    expect(importTspl(body()).document).toMatchObject({ width: 60, height: 40 });
    expect(importTspl(tspl('SIZE 4,3', 'CLS')).document).toMatchObject({ width: 101.6, height: 76.2 });
  });

  it('reads the gap', () => {
    expect(importTspl(body()).document.gap).toEqual({ height: 2, offset: 0 });
  });

  it('keeps printer setup lines verbatim in the preamble', () => {
    const result = importTspl(
      tspl('SIZE 60 mm, 40 mm', 'SPEED 4', 'DENSITY 8', 'SET TEAR ON', 'CLS', 'PRINT 1'),
    );
    expect(result.mode).toBe('linked');
    expect(result.document.preamble).toEqual(['SPEED 4', 'DENSITY 8', 'SET TEAR ON']);
  });

  it('reports the copies the job asked for without putting them in the design', () => {
    const result = importTspl(body('PRINT 3,4').replace('PRINT 1,1\n', ''));
    expect(result.copies).toBe(12);
    expect(result.document).not.toHaveProperty('copies');
  });

  it('folds a reference offset into the elements it applies to', () => {
    const withReference = importTspl(body('REFERENCE 16,8', 'BAR 24,16,80,40')).document;
    const without = importTspl(body('BAR 40,24,80,40')).document;
    expect(withReference.elements[0]).toMatchObject(without.elements[0] as object);
  });
});

describe('elements', () => {
  it('reads a bar as a solid rectangle', () => {
    expect(single('BAR 32,24,80,40')).toMatchObject({
      type: 'rectangle',
      fill: 'solid',
      x: mm(32),
      y: mm(24),
      width: mm(80),
      height: mm(40),
    });
  });

  it('reads a reverse and an erase as their own fills', () => {
    expect(single('REVERSE 0,0,80,40')).toMatchObject({ type: 'rectangle', fill: 'invert' });
    expect(single('ERASE 0,0,80,40')).toMatchObject({ type: 'rectangle', fill: 'erase' });
  });

  it('reads a box back as an outline, undoing the inclusive corners', () => {
    // 8 to 87 inclusive is eighty dots across, which is ten millimetres.
    expect(single('BOX 8,8,87,47,3')).toMatchObject({
      type: 'rectangle',
      fill: 'outline',
      x: mm(8),
      y: mm(8),
      width: mm(80),
      height: mm(40),
    });
  });

  it('carries a corner radius only when the source has one', () => {
    expect(single('BOX 8,8,87,47,3')).not.toHaveProperty('cornerRadius');
    expect(single('BOX 8,8,87,47,3,12')).toHaveProperty('cornerRadius');
  });

  it('reads scalable text as a height in millimetres', () => {
    expect(single('TEXT 24,32,"0",0,32,32,1,"Cable"')).toMatchObject({
      type: 'text',
      content: 'Cable',
      x: mm(24),
      y: mm(32),
      style: { heightMm: mm(32) },
    });
  });

  it('notes a width scale only when the multipliers differ', () => {
    expect((single('TEXT 0,0,"0",0,32,32,1,"X"') as { style: object }).style).not.toHaveProperty(
      'widthScale',
    );
    expect(single('TEXT 0,0,"0",0,48,32,1,"X"')).toMatchObject({ style: { widthScale: 1.5 } });
  });

  it('pins a resident font with its own multipliers', () => {
    expect(single('TEXT 0,0,"3",0,2,2,1,"X"')).toMatchObject({
      style: { residentFont: '3', residentMultiplier: { x: 2, y: 2 } },
    });
  });

  it('reads alignment and rotation', () => {
    expect(single('TEXT 0,0,"0",90,24,24,2,"X"')).toMatchObject({
      align: 'center',
      rotation: 90,
    });
    expect(single('TEXT 0,0,"0",0,24,24,3,"X"')).toMatchObject({ align: 'right' });
    expect(single('TEXT 0,0,"0",0,24,24,1,"X"')).not.toHaveProperty('align');
  });

  it('reads a block as text with a box', () => {
    expect(single('BLOCK 24,32,240,80,"0",0,20,20,4,2,"long text"')).toMatchObject({
      type: 'text',
      content: 'long text',
      align: 'center',
      box: { width: mm(240), height: mm(80) },
    });
  });

  it('reads a barcode, its module width and its human-readable flag', () => {
    expect(single('BARCODE 32,48,"128",88,1,0,2,4,"4820-117-A"')).toMatchObject({
      type: 'barcode',
      symbology: 'code128',
      data: '4820-117-A',
      moduleWidth: mm(2),
      height: mm(88),
      humanReadable: true,
    });
  });

  it('recognises the check-digit spellings', () => {
    expect(single('BARCODE 0,0,"39C",80,0,0,2,6,"ABC"')).toMatchObject({
      symbology: 'code39',
      checkDigit: true,
    });
    expect(single('BARCODE 0,0,"25C",80,0,0,2,6,"1234"')).toMatchObject({
      symbology: 'itf',
      checkDigit: true,
    });
  });

  it('reads a QR code with its level and cell size', () => {
    expect(single('QRCODE 32,32,Q,4,A,0,"https://example.com"')).toMatchObject({
      type: 'matrix',
      symbology: 'qr',
      errorCorrection: 'Q',
      moduleWidth: mm(4),
      data: 'https://example.com',
    });
  });

  it('works out a Data Matrix module size from the box it was given', () => {
    // A 14 by 14 symbol in a 56 dot box is four dots a module.
    expect(single('DMATRIX 32,32,56,56,"SKU-4820"')).toMatchObject({
      symbology: 'datamatrix',
      moduleWidth: mm(4),
    });
  });

  it('reads PDF417 options it can hold', () => {
    expect(single('PDF417 32,32,300,120,0,W2,H6,C3,E2,"SKU-4820"')).toMatchObject({
      symbology: 'pdf417',
      moduleWidth: mm(2),
      columns: 3,
      pdf417ErrorCorrection: 2,
    });
  });

  it('numbers elements and remembers the line each came from', () => {
    const result = importTspl(body('BAR 0,0,10,10', 'BAR 0,20,10,10'));
    expect(result.document.elements.map((element) => element.id)).toEqual(['e1', 'e2']);
    expect(result.origins['e1']).toMatchObject({ line: 5 });
    expect(result.origins['e2']).toMatchObject({ line: 6 });
  });
});

/**
 * The mode is the whole contract. Linked means regenerating from the canvas
 * reproduces the label; anything the model cannot hold has to force detached,
 * or the canvas would quietly delete it the first time something is moved.
 */
describe('linked and detached', () => {
  it('links a job it holds completely', () => {
    const result = importTspl(
      body('BAR 8,8,80,40', 'TEXT 8,60,"0",0,24,24,1,"Cable"', 'QRCODE 200,8,M,4,A,0,"x"'),
    );
    expect(result.mode).toBe('linked');
    expect(result.unmapped).toEqual([]);
  });

  it('detaches on an image command and says why', () => {
    const result = importTspl(body('BAR 0,0,10,10', 'PUTBMP 10,10,"logo.bmp"'));
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]).toMatchObject({ line: 6, source: 'PUTBMP 10,10,"logo.bmp"' });
    expect(result.unmapped[0]!.reason).toMatch(/Images/);
  });

  it('detaches on an unknown command', () => {
    const result = importTspl(body('FROBNICATE 1,2'));
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.reason).toMatch(/FROBNICATE/);
  });

  it('detaches on a barcode the canvas does not offer', () => {
    const result = importTspl(body('BARCODE 0,0,"MSI",80,0,0,2,4,"123"'));
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.reason).toMatch(/"MSI"/);
  });

  it('detaches on a QR model the canvas does not draw', () => {
    expect(importTspl(body('QRCODE 0,0,M,4,A,0,M1,S1,"x"')).mode).toBe('detached');
  });

  it('detaches on a PDF417 option the model has no room for', () => {
    expect(importTspl(body('PDF417 0,0,300,120,0,W2,R10,"x"')).mode).toBe('detached');
  });

  it('detaches on a job that prints more than one label', () => {
    const result = importTspl(
      tspl(
        'SIZE 60 mm, 40 mm',
        'CLS',
        'BAR 0,0,10,10',
        'PRINT 1,1',
        'CLS',
        'BAR 0,20,10,10',
        'PRINT 1,1',
      ),
    );
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.reason).toMatch(/more than one label/);
  });

  it('detaches when part of the source could not even be parsed', () => {
    const result = importTspl(body('TEXT 0,0,"0",0,24,24,1,"unterminated'));
    expect(result.mode).toBe('detached');
    expect(result.diagnostics[0]!.severity).toBe('error');
  });

  it('still returns the elements it did understand when detached', () => {
    const result = importTspl(body('BAR 8,8,80,40', 'PUTBMP 10,10,"logo.bmp"'));
    expect(result.document.elements).toHaveLength(1);
  });
});

/**
 * Both directions of the round trip, checked the way that matters: the label
 * has to come out the same, not the text.
 */
describe('round trip', () => {
  const source = tspl(
    'SIZE 60 mm, 40 mm',
    'GAP 2 mm, 0 mm',
    'DIRECTION 0',
    'SPEED 4',
    'DENSITY 8',
    'CLS',
    'BOX 8,8,471,311,3,12',
    'TEXT 240,26,"0",0,32,32,2,"Кабель USB-C 2 м"',
    'REVERSE 16,16,447,48',
    'BAR 32,76,416,3',
    'TEXT 32,88,"3",0,1,1,1,"SKU 4820-117-A"',
    'BARCODE 32,136,"128",88,1,0,2,4,"4820-117-A"',
    'QRCODE 320,120,M,4,A,0,"https://example.com/p/4820-117-A"',
    'BLOCK 32,264,272,48,"0",0,19,19,3,1,"Партия 2026-09"',
    'PRINT 1,1',
  );

  const render = (code: string) =>
    renderTspl(code, { fonts: fonts(), dpi: 203 }).labels[0]!.bitmap;

  it('links a realistic job', () => {
    const result = importTspl(source);
    expect(result.unmapped).toEqual([]);
    expect(result.mode).toBe('linked');
    expect(result.document.elements).toHaveLength(8);
  });

  it('prints the same label after a trip through the model', () => {
    const imported = importTspl(source);
    const regenerated = generateTspl(imported.document, { dpi: 203, copies: imported.copies });
    // This job puts Russian through the scalable font, which the printer draws
    // in Latin only; the warning is the point, and it changes nothing here.
    expect(regenerated.issues.map((issue) => issue.code)).toEqual([
      'generate.tspl-scalable-not-cyrillic',
      'generate.tspl-scalable-not-cyrillic',
    ]);
    expect(render(regenerated.source).equals(render(source))).toBe(true);
  });

  it('keeps the setup lines in the regenerated job', () => {
    const imported = importTspl(source);
    const regenerated = generateTspl(imported.document, { dpi: 203 });
    expect(regenerated.source).toContain('SPEED 4');
    expect(regenerated.source).toContain('DENSITY 8');
    // One direction line, not two contradictory ones.
    expect(regenerated.source.match(/DIRECTION/g)).toHaveLength(1);
  });

  it('settles after one trip, so the second changes nothing', () => {
    const once = generateTspl(importTspl(source).document, { dpi: 203 }).source;
    const twice = generateTspl(importTspl(once).document, { dpi: 203 }).source;
    expect(twice).toBe(once);
  });

  it('brings a designed document back unchanged in every measurement', () => {
    const original: LabelDocument = createDocument({
      width: 60,
      height: 40,
      gap: { height: 2, offset: 0 },
      elements: [
        { id: 'a', type: 'rectangle', x: 1, y: 1, width: 58, height: 38, fill: 'outline', lineWidth: 0.38 },
        { id: 'b', type: 'text', x: 4, y: 5, content: 'Cable', style: { heightMm: 4 }, align: 'center' },
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
        { id: 'd', type: 'matrix', x: 40, y: 15, symbology: 'qr', data: 'https://example.com', moduleWidth: 0.5, errorCorrection: 'M' },
      ],
    });

    const back = importTspl(generateTspl(original, { dpi: 203 }).source).document;
    expect(back.width).toBe(original.width);
    expect(back.height).toBe(original.height);
    expect(back.elements).toHaveLength(original.elements.length);

    original.elements.forEach((element, index) => {
      const returned = back.elements[index]!;
      expect(returned.type).toBe(element.type);
      // Within a tenth of a millimetre, which is less than one dot at 203 dpi.
      expect(returned.x).toBeCloseTo(element.x, 1);
      expect(returned.y).toBeCloseTo(element.y, 1);
    });
  });

  it('keeps a line as a bar, which is the same picture under a different name', () => {
    // The model has both a line and a solid rectangle; TSPL has only BAR, so a
    // line comes back as a rectangle. The label is identical, and saying so
    // here is cheaper than pretending the model can tell them apart.
    const withLine = createDocument({
      elements: [{ id: 'l', type: 'line', x: 4, y: 10, x2: 56, y2: 10, thickness: 0.4 }],
    });
    const code = generateTspl(withLine, { dpi: 203 }).source;
    const back = importTspl(code);
    expect(back.mode).toBe('linked');
    expect(back.document.elements[0]!.type).toBe('rectangle');
    expect(render(generateTspl(back.document, { dpi: 203 }).source).equals(render(code))).toBe(true);
  });
});
