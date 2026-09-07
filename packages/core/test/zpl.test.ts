import { describe, expect, it } from 'vitest';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { importZpl } from '../src/import/zpl.js';
import { createDocument, type LabelDocument, type LabelElement } from '../src/model/document.js';
import { renderZpl } from '../src/zpl/execute.js';
import { parseZpl } from '../src/zpl/parse.js';
import { BarcodeFormat, decode, decodeRegion } from './helpers/decode.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

const render = (source: string, width = 812, height = 406) =>
  renderZpl(source, { fonts: fonts(), defaultWidthDots: width, defaultHeightDots: height });

const label = (source: string, width?: number, height?: number) =>
  render(source, width, height).labels[0]!.bitmap;

const errors = (result: ReturnType<typeof render>) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

const perMm = 203 / 25.4;
const dots = (millimetres: number) => Math.round(millimetres * perMm);
const mm = (dotCount: number) => Math.round((dotCount / perMm) * 100) / 100;

describe('parsing', () => {
  it('splits a run-together stream on its prefixes', () => {
    const { commands } = parseZpl('^XA^FO50,60^GB10,20,3^FS^XZ');
    expect(commands.map((command) => command.name)).toEqual(['XA', 'FO', 'GB', 'FS', 'XZ']);
    expect(commands[1]!.parameters).toEqual(['50', '60']);
  });

  it('reads the font command, whose name is one letter and its font the next', () => {
    const { commands } = parseZpl('^A0N,30,25');
    expect(commands[0]).toMatchObject({ name: 'A', parameters: ['0N', '30', '25'] });
  });

  it('keeps field data in one piece, commas and all', () => {
    const { commands } = parseZpl('^FDCable, 2 m, black^FS');
    expect(commands[0]!.parameters).toEqual(['Cable, 2 m, black']);
  });

  it('ignores the line structure, because a printer does', () => {
    const oneLine = parseZpl('^XA^FO1,2^FDhi^FS^XZ');
    const manyLines = parseZpl('^XA\n^FO1,2\n^FDhi^FS\n^XZ');
    expect(manyLines.commands.map((command) => command.name)).toEqual(
      oneLine.commands.map((command) => command.name),
    );
  });

  it('still records which line a command was written on', () => {
    const { commands } = parseZpl('^XA\n^FO10,20\n^FDhi^FS\n^XZ');
    expect(commands[1]!.span.line).toBe(2);
  });

  it('warns about text before the first command instead of dropping it silently', () => {
    const { diagnostics } = parseZpl('rubbish^XA^XZ');
    expect(diagnostics[0]).toMatchObject({ severity: 'warning', code: 'zpl.leading-text' });
  });

  it('handles an empty source', () => {
    expect(parseZpl('').commands).toEqual([]);
  });
});

describe('the interpreter', () => {
  it('takes the label size from ^PW and ^LL', () => {
    const image = label('^XA^PW400^LL200^XZ');
    expect(image.width).toBe(400);
    expect(image.height).toBe(200);
  });

  it('commits a field that never got its separator', () => {
    // Real files leave ^FS out more often than not, and losing the field would
    // be a worse answer than drawing it.
    const withSeparator = label('^XA^FO10,10^GB50,50,5^FS^XZ');
    const without = label('^XA^FO10,10^GB50,50,5^XZ');
    expect(without.equals(withSeparator)).toBe(true);
  });

  it('offsets everything by ^LH', () => {
    const shifted = label('^XA^LH20,10^FO10,10^GB50,50,50^FS^XZ');
    expect(shifted.get(30, 20)).toBe(1);
    expect(shifted.get(10, 10)).toBe(0);
  });

  it('reports the copies ^PQ asks for', () => {
    expect(render('^XA^PQ7^XZ').labels[0]!.copies).toBe(7);
  });

  it('produces one label per format', () => {
    const result = render('^XA^FO0,0^GB10,10,10^FS^XZ^XA^FO0,0^GB20,20,20^FS^XZ');
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]!.bitmap.countSet()).toBe(100);
    expect(result.labels[1]!.bitmap.countSet()).toBe(400);
  });

  it('reverses a field over what is under it', () => {
    const image = label('^XA^FO0,0^GB100,50,50^FS^FO10,10^FR^A0N,30,30^FDX^FS^XZ');
    // The solid box is there and the reversed glyph has punched through it.
    expect(image.get(2, 2)).toBe(1);
    expect(image.countSet()).toBeLessThan(100 * 50);
  });

  it('warns about an image command and renders the rest', () => {
    const result = render('^XA^FO0,0^GFA,100,100,10,^FS^FO0,0^GB20,20,20^FS^XZ');
    expect(result.diagnostics.some((entry) => entry.code === 'zpl.image-not-drawn')).toBe(true);
    expect(result.labels[0]!.bitmap.countSet()).toBe(400);
  });

  it('warns about an unknown command', () => {
    const result = render('^XA^ZZ1,2^XZ');
    expect(result.diagnostics[0]).toMatchObject({ code: 'zpl.unknown-command' });
  });

  it('never throws, whatever it is handed', () => {
    expect(() => render('^^^~~^XA^FO^A^FD^FS^GB^BC^XZ^')).not.toThrow();
    expect(() => render('')).not.toThrow();
  });

  it('reports a payload the symbology cannot hold', () => {
    const result = render('^XA^FO10,10^BEN,100,N,N^FDnot digits^FS^XZ');
    expect(errors(result)[0]!.code).toBe('zpl.barcode-failed');
  });
});

describe('the default Code 128 mode', () => {
  const width = (mode: string, data: string): number => {
    const image = label(`^XA^BY2^FO10,10^BCN,80,N,N,N,${mode}^FD${data}^FS^XZ`, 1200, 200);
    let last = 0;
    for (let x = 0; x < image.width; x++) {
      for (let y = 0; y < image.height; y++) if (image.get(x, y)) last = x;
    }
    return last;
  };

  it('stays in subset B by default, however many digits it is given', () => {
    // Twenty digits pack into ten characters in subset C, so a printer that
    // switched would draw a much narrower symbol. ZPL's default mode does not,
    // and showing the narrow one would answer "does it fit" wrongly.
    expect(width('N', '12345678901234567890')).toBeGreaterThan(
      width('A', '12345678901234567890'),
    );
  });

  it('looks for the shortest encoding in automatic mode', () => {
    expect(width('A', '12345678901234567890')).toBeLessThan(width('N', '12345678901234567890'));
  });

  it('reads back the same string either way', () => {
    for (const mode of ['N', 'A']) {
      const image = label(`^XA^BY3^FO20,20^BCN,100,N,N,N,${mode}^FD4820117^FS^XZ`, 900, 200);
      expect(decode(image, [BarcodeFormat.CODE_128])).toBe('4820117');
    }
  });
});

describe('generating ZPL', () => {
  const document = (elements: LabelElement[], overrides: Partial<LabelDocument> = {}) =>
    createDocument({ width: 60, height: 40, elements, ...overrides });

  const generate = (elements: LabelElement[], overrides = {}) =>
    generateZpl(document(elements, overrides), { dpi: 203 });

  it('opens with the size in dots and closes with the quantity', () => {
    const lines = generate([]).source.trimEnd().split('\n');
    expect(lines[0]).toBe('^XA');
    expect(lines[1]).toBe(`^PW${dots(60)}`);
    expect(lines[2]).toBe(`^LL${dots(40)}`);
    expect(lines.at(-1)).toBe('^XZ');
  });

  it('draws a solid rectangle as a box as thick as it is tall', () => {
    const { source } = generate([
      { id: 'r', type: 'rectangle', x: 5, y: 5, width: 10, height: 5, fill: 'solid' },
    ]);
    expect(source).toContain(`^GB${dots(10)},${dots(5)},${dots(5)}^FS`);
  });

  it('draws an erase as a white box', () => {
    expect(
      generate([{ id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 5, fill: 'erase' }])
        .source,
    ).toContain(',W^FS');
  });

  it('refuses to invert an area, because ZPL cannot, and says what to do instead', () => {
    const { issues, source } = generate([
      { id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 5, fill: 'invert' },
    ]);
    expect(issues[0]).toMatchObject({ severity: 'error', code: 'generate.zpl-no-invert' });
    expect(issues[0]!.message).toMatch(/reversed text/);
    expect(source).not.toContain('^GB');
  });

  it('draws a diagonal line, which is where ZPL is richer than TSPL', () => {
    const diagonal: LabelElement = {
      id: 'l',
      type: 'line',
      x: 5,
      y: 5,
      x2: 25,
      y2: 20,
      thickness: 0.4,
    };
    expect(generate([diagonal]).source).toContain('^GD');
    // The same element is an error in TSPL, which has no such command.
    expect(generateTspl(document([diagonal]), { dpi: 203 }).issues[0]!.code).toBe(
      'generate.diagonal-line',
    );
  });

  it('escapes a caret in field data and turns on the hex prefix to do it', () => {
    const { source } = generate([
      { id: 't', type: 'text', x: 1, y: 1, content: 'A^B~C', style: { heightMm: 3 } },
    ]);
    expect(source).toContain('^FH^FDA_5EB_7EC^FS');
  });

  it('leaves data alone when it needs no escaping', () => {
    const { source } = generate([
      { id: 't', type: 'text', x: 1, y: 1, content: 'plain', style: { heightMm: 3 } },
    ]);
    expect(source).toContain('^FDplain^FS');
    expect(source).not.toContain('^FH');
  });

  it('puts the QR error correction in the field data, where ^BQ wants it', () => {
    const { source } = generate([
      {
        id: 'm',
        type: 'matrix',
        x: 5,
        y: 5,
        symbology: 'qr',
        data: 'https://example.com',
        moduleWidth: 0.5,
        errorCorrection: 'Q',
      },
    ]);
    expect(source).toContain('^FDQA,https://example.com^FS');
  });

  it('reports the line each element was written to', () => {
    const { origins, source } = generate([
      { id: 'r', type: 'rectangle', x: 1, y: 1, width: 10, height: 5, fill: 'solid' },
      { id: 't', type: 'text', x: 2, y: 8, content: 'Cable', style: { heightMm: 3 } },
    ]);
    const lines = source.trimEnd().split('\n');
    expect(lines[origins['r']! - 1]).toContain('^GB');
    expect(lines[origins['t']! - 1]).toContain('^FDCable');
  });
});

describe('importing ZPL', () => {
  const source = [
    '^XA',
    '^PW480',
    '^LL320',
    '^MD10',
    '^FO8,8^GB464,304,3,B,2^FS',
    '^FO24,76^A0N,32,32^FDCable USB-C^FS',
    '^FO24,150^GB416,3,3^FS',
    '^BY2,3^FO24,170^BCN,88,Y,N,N,A^FD4820-117-A^FS',
    '^FO320,60^BQN,2,4^FDMA,https://example.com^FS',
    '^PQ1',
    '^XZ',
  ].join('\n');

  it('links a job it holds completely', () => {
    const result = importZpl(source);
    expect(result.unmapped).toEqual([]);
    expect(result.mode).toBe('linked');
    expect(result.document.elements).toHaveLength(5);
  });

  it('takes the size from ^PW and ^LL', () => {
    const { document } = importZpl(source);
    expect(document.width).toBeCloseTo(480 / perMm, 1);
    expect(document.height).toBeCloseTo(320 / perMm, 1);
  });

  it('keeps printer settings verbatim', () => {
    expect(importZpl(source).document.preamble).toEqual(['^MD10']);
  });

  it('reads a box as an outline and a thick one as solid', () => {
    expect(importZpl('^XA^FO0,0^GB100,50,3^FS^XZ').document.elements[0]).toMatchObject({
      type: 'rectangle',
      fill: 'outline',
    });
    expect(importZpl('^XA^FO0,0^GB100,50,50^FS^XZ').document.elements[0]).toMatchObject({
      fill: 'solid',
    });
  });

  it('reads a diagonal as a line with both ends', () => {
    const element = importZpl('^XA^FO80,40^GD160,80,4,B,R^FS^XZ').document.elements[0]!;
    expect(element.type).toBe('line');
    expect(element).toMatchObject({ x: mm(80), y: mm(120) });
  });

  it('detaches on a circle, which the canvas has no element for', () => {
    const result = importZpl('^XA^FO10,10^GC100,4,B^FS^XZ');
    expect(result.mode).toBe('detached');
    expect(result.unmapped[0]!.reason).toMatch(/circle or ellipse/);
  });

  it('detaches on an image', () => {
    expect(importZpl('^XA^FO0,0^GFA,10,10,1,AA^FS^XZ').mode).toBe('detached');
  });

  it('detaches on a job with two labels in it', () => {
    expect(importZpl('^XA^FO0,0^GB10,10,10^FS^XZ^XA^XZ').mode).toBe('detached');
  });

  it('still returns what it did understand when detached', () => {
    const result = importZpl('^XA^FO0,0^GB10,10,10^FS^FO20,20^GC50,3,B^FS^XZ');
    expect(result.document.elements).toHaveLength(1);
  });
});

describe('the ZPL round trip', () => {
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

  it('prints the same label after a trip through the model', () => {
    const first = generateZpl(original, { dpi: 203 });
    expect(first.issues).toEqual([]);
    const back = importZpl(first.source, { dpi: 203 });
    expect(back.mode).toBe('linked');
    const second = generateZpl(back.document, { dpi: 203 });
    expect(label(second.source, 480, 320).equals(label(first.source, 480, 320))).toBe(true);
  });

  it('settles after one trip, so the second changes nothing', () => {
    const once = generateZpl(importZpl(generateZpl(original, { dpi: 203 }).source).document, {
      dpi: 203,
    }).source;
    const twice = generateZpl(importZpl(once).document, { dpi: 203 }).source;
    expect(twice).toBe(once);
  });

  it('carries the barcode through the whole loop readably', () => {
    const generated = generateZpl(original, { dpi: 203 });
    const rendered = render(generated.source, 480, 320);
    // A one-dimensional reader scans straight across the image, so the border
    // box either side of the barcode breaks its quiet zone. The renderer says
    // where the element landed, which is exactly what is needed to look at it
    // on its own.
    const outline = rendered.bounds.find((entry) => entry.line === generated.origins['c'])!;
    expect(decodeRegion(rendered.labels[0]!.bitmap, outline, [BarcodeFormat.CODE_128])).toBe(
      '4820-117-A',
    );
  });

  it('sends one document to both languages', () => {
    // The point of a language-neutral model: the same design, two dialects,
    // each saying what it can.
    const zpl = generateZpl(original, { dpi: 203 });
    const tspl = generateTspl(original, { dpi: 203 });
    expect(zpl.source).toContain('^XA');
    expect(tspl.source).toContain('SIZE 60 mm, 40 mm');
    expect(zpl.issues).toEqual([]);
    expect(tspl.issues).toEqual([]);
  });
});
