import { describe, expect, it } from 'vitest';
import { renderTspl, type TsplRenderResult } from '../src/tspl/execute.js';
import { BarcodeFormat, decode } from './helpers/decode.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

function render(source: string, dpi: 203 | 300 | 600 = 203): TsplRenderResult {
  return renderTspl(source, { fonts: fonts(), dpi });
}

const label = (source: string, dpi: 203 | 300 | 600 = 203) => render(source, dpi).labels[0]!;

const errors = (result: TsplRenderResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

/** Joins command lines, so the sources below read as they would in a file. */
const tspl = (...lines: string[]): string => lines.join('\n');

describe('label size', () => {
  it('reads a bare SIZE as inches, which is the standard default', () => {
    const image = label(tspl('SIZE 4,3', 'CLS')).bitmap;
    expect(image.width).toBe(4 * 203);
    expect(image.height).toBe(3 * 203);
  });

  it('reads a millimetre suffix', () => {
    const image = label(tspl('SIZE 60 mm, 40 mm', 'CLS')).bitmap;
    expect(image.width).toBe(Math.round(60 * (203 / 25.4)));
  });

  it('reads a dot suffix', () => {
    expect(label(tspl('SIZE 400 dot, 200 dot', 'CLS')).bitmap.width).toBe(400);
  });

  it('scales with the printer resolution', () => {
    expect(label(tspl('SIZE 50 mm, 25 mm', 'CLS'), 600).bitmap.width).toBe(
      Math.round(50 * (600 / 25.4)),
    );
  });

  it('falls back to a default when the source never says SIZE', () => {
    expect(label(tspl('CLS', 'BAR 0,0,10,10')).bitmap.width).toBeGreaterThan(0);
  });

  it('refuses a size beyond the dot limit and says so', () => {
    const huge = renderTspl(tspl('SIZE 40,40', 'CLS'), { fonts: fonts(), maxDots: 1000 });
    expect(huge.diagnostics.some((diagnostic) => /exceeds/.test(diagnostic.message))).toBe(true);
  });
});

describe('drawing primitives land on exact dots', () => {
  it('fills exactly the rectangle BAR names', () => {
    const image = label(tspl('SIZE 100 dot, 50 dot', 'CLS', 'BAR 10,20,30,5')).bitmap;
    expect(image.countSet()).toBe(30 * 5);
    expect(image.get(10, 20)).toBe(1);
    expect(image.get(39, 24)).toBe(1);
    expect(image.get(40, 24)).toBe(0);
    expect(image.get(9, 20)).toBe(0);
  });

  it('treats BOX arguments as inclusive opposite corners', () => {
    const image = label(tspl('SIZE 100 dot, 50 dot', 'CLS', 'BOX 10,10,19,19,1')).bitmap;
    expect(image.get(10, 10)).toBe(1);
    expect(image.get(19, 19)).toBe(1);
    expect(image.get(20, 19)).toBe(0);
    expect(image.get(15, 15)).toBe(0);
    expect(image.countSet()).toBe(10 * 4 - 4);
  });

  it('accepts BOX corners given in either order', () => {
    const forwards = label(tspl('SIZE 60 dot, 60 dot', 'CLS', 'BOX 10,10,40,40,2')).bitmap;
    const backwards = label(tspl('SIZE 60 dot, 60 dot', 'CLS', 'BOX 40,40,10,10,2')).bitmap;
    expect(forwards.equals(backwards)).toBe(true);
  });

  it('cuts the corners of a rounded box without moving its edges', () => {
    const image = label(tspl('SIZE 60 dot, 60 dot', 'CLS', 'BOX 5,5,54,54,2,10')).bitmap;
    expect(image.get(5, 5)).toBe(0);
    expect(image.get(30, 5)).toBe(1);
    expect(image.get(5, 30)).toBe(1);
  });

  it('clears a region with ERASE', () => {
    const image = label(
      tspl('SIZE 60 dot, 60 dot', 'CLS', 'BAR 0,0,60,60', 'ERASE 10,10,20,20'),
    ).bitmap;
    expect(image.get(15, 15)).toBe(0);
    expect(image.get(5, 5)).toBe(1);
    expect(image.countSet()).toBe(60 * 60 - 400);
  });

  it('inverts a region with REVERSE, which is how white text is made', () => {
    const image = label(
      tspl('SIZE 60 dot, 60 dot', 'CLS', 'BAR 10,10,20,20', 'REVERSE 0,0,60,60'),
    ).bitmap;
    expect(image.get(15, 15)).toBe(0);
    expect(image.get(0, 0)).toBe(1);
  });

  it('offsets everything by REFERENCE', () => {
    const plain = label(tspl('SIZE 80 dot, 80 dot', 'CLS', 'BAR 10,10,10,10')).bitmap;
    const shifted = label(
      tspl('SIZE 80 dot, 80 dot', 'CLS', 'REFERENCE 5,7', 'BAR 10,10,10,10'),
    ).bitmap;
    expect(shifted.get(15, 17)).toBe(1);
    expect(shifted.get(10, 10)).toBe(0);
    expect(shifted.countSet()).toBe(plain.countSet());
  });

  it('clips drawing that runs off the label instead of failing', () => {
    const result = render(tspl('SIZE 40 dot, 40 dot', 'CLS', 'BAR 30,30,100,100'));
    expect(errors(result)).toHaveLength(0);
    expect(result.labels[0]!.bitmap.countSet()).toBe(10 * 10);
  });
});

describe('text', () => {
  it('places a line below and right of its anchor', () => {
    const image = label(tspl('SIZE 200 dot, 100 dot', 'CLS', 'TEXT 20,30,"3",0,1,1,"AB"')).bitmap;
    expect(image.crop(0, 0, 200, 30).countSet()).toBe(0);
    expect(image.crop(0, 0, 20, 100).countSet()).toBe(0);
    expect(image.countSet()).toBeGreaterThan(0);
  });

  it('advances fixed-pitch fonts by their cell width', () => {
    // Font 3 is a 16 by 24 cell, so the fourth character starts 48 dots along.
    const one = label(tspl('SIZE 300 dot, 60 dot', 'CLS', 'TEXT 10,10,"3",0,1,1,"M"')).bitmap;
    const four = label(tspl('SIZE 300 dot, 60 dot', 'CLS', 'TEXT 10,10,"3",0,1,1,"MMMM"')).bitmap;
    expect(four.crop(10 + 48, 0, 16, 60).equals(one.crop(10, 0, 16, 60))).toBe(true);
  });

  it('multiplies the cell by the multiplication arguments', () => {
    const single = label(tspl('SIZE 300 dot, 80 dot', 'CLS', 'TEXT 10,10,"2",0,1,1,"X"')).bitmap;
    const double = label(tspl('SIZE 300 dot, 80 dot', 'CLS', 'TEXT 10,10,"2",0,2,2,"X"')).bitmap;
    expect(double.countSet()).toBeGreaterThan(single.countSet() * 2);
  });

  it('centres on the anchor when alignment is 2', () => {
    const left = label(tspl('SIZE 300 dot, 60 dot', 'CLS', 'TEXT 150,10,"3",0,1,1,1,"WIDE"'))
      .bitmap;
    const centred = label(tspl('SIZE 300 dot, 60 dot', 'CLS', 'TEXT 150,10,"3",0,1,1,2,"WIDE"'))
      .bitmap;
    expect(centred.crop(0, 0, 150, 60).countSet()).toBeGreaterThan(0);
    expect(left.crop(0, 0, 150, 60).countSet()).toBe(0);
  });

  it('rotates about the anchor', () => {
    const image = label(tspl('SIZE 200 dot, 200 dot', 'CLS', 'TEXT 100,20,"3",90,1,1,"AB"'))
      .bitmap;
    expect(image.countSet()).toBeGreaterThan(0);
    // Turned a quarter clockwise, the run travels down the label, not across.
    expect(image.crop(0, 20, 100, 180).countSet()).toBeGreaterThan(0);
  });

  it('warns about a font the printer does not have, and still draws', () => {
    const result = render(
      tspl('SIZE 200 dot, 60 dot', 'CLS', 'TEXT 10,10,"ARIAL.TTF",0,20,20,"Hi"'),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
    expect(result.labels[0]!.bitmap.countSet()).toBeGreaterThan(0);
  });

  it('wraps BLOCK content and reports what did not fit', () => {
    const result = render(
      tspl(
        'SIZE 300 dot, 200 dot',
        'CLS',
        'BLOCK 10,10,200,30,"1",0,1,1,"one two three four five six seven eight nine ten ' +
          'eleven twelve thirteen fourteen fifteen sixteen"',
      ),
    );
    expect(
      result.diagnostics.some((diagnostic) => /taller than the block/.test(diagnostic.message)),
    ).toBe(true);
    expect(result.labels[0]!.bitmap.countSet()).toBeGreaterThan(0);
  });
});

describe('barcodes', () => {
  const readLabel = (source: string, formats: BarcodeFormat[]): string =>
    decode(label(source).bitmap, formats);

  it('renders a Code 128 that decodes', () => {
    expect(
      readLabel(
        tspl('SIZE 800 dot, 200 dot', 'CLS', 'BARCODE 30,40,"128",80,0,0,3,6,"4820-117-A"'),
        [BarcodeFormat.CODE_128],
      ),
    ).toBe('4820-117-A');
  });

  it('renders an EAN-13 that decodes', () => {
    expect(
      readLabel(
        tspl('SIZE 400 dot, 200 dot', 'CLS', 'BARCODE 40,40,"EAN13",80,0,0,3,6,"400638133393"'),
        [BarcodeFormat.EAN_13],
      ),
    ).toBe('4006381333931');
  });

  it('renders Code 39 that decodes', () => {
    expect(
      readLabel(tspl('SIZE 600 dot, 200 dot', 'CLS', 'BARCODE 30,40,"39",80,0,0,2,6,"ABC-123"'), [
        BarcodeFormat.CODE_39,
      ]),
    ).toBe('ABC-123');
  });

  it('renders interleaved 2 of 5 that decodes', () => {
    expect(
      readLabel(tspl('SIZE 600 dot, 200 dot', 'CLS', 'BARCODE 30,40,"25",80,0,0,3,9,"12345678"'), [
        BarcodeFormat.ITF,
      ]),
    ).toBe('12345678');
  });

  it('adds a human-readable line when asked', () => {
    const without = label(
      tspl('SIZE 400 dot, 200 dot', 'CLS', 'BARCODE 30,40,"128",80,0,0,3,6,"ABC"'),
    ).bitmap;
    const withText = label(
      tspl('SIZE 400 dot, 200 dot', 'CLS', 'BARCODE 30,40,"128",80,1,0,3,6,"ABC"'),
    ).bitmap;
    expect(withText.countSet()).toBeGreaterThan(without.countSet());
  });

  it('scales the bars by the narrow width', () => {
    const narrow = label(
      tspl('SIZE 600 dot, 200 dot', 'CLS', 'BARCODE 10,40,"128",80,0,0,2,4,"ABC"'),
    ).bitmap;
    const wide = label(
      tspl('SIZE 600 dot, 200 dot', 'CLS', 'BARCODE 10,40,"128",80,0,0,4,8,"ABC"'),
    ).bitmap;
    expect(wide.countSet()).toBe(narrow.countSet() * 2);
  });

  it('reports a payload the symbology cannot hold, and keeps the rest', () => {
    const result = render(
      tspl(
        'SIZE 400 dot, 200 dot',
        'CLS',
        'BAR 0,0,20,20',
        'BARCODE 30,40,"EAN13",80,0,0,3,6,"not digits"',
      ),
    );
    expect(errors(result)).toHaveLength(1);
    expect(result.labels[0]!.bitmap.countSet()).toBe(400);
  });

  it('reports a symbology it does not know', () => {
    const result = render(
      tspl('SIZE 400 dot, 200 dot', 'CLS', 'BARCODE 30,40,"MSI",80,0,0,3,6,"123"'),
    );
    expect(errors(result)[0]!.message).toMatch(/not supported/);
  });
});

describe('two-dimensional symbols', () => {
  it('renders a QR code that decodes', () => {
    const source = tspl(
      'SIZE 400 dot, 400 dot',
      'CLS',
      'QRCODE 40,40,M,5,A,0,"https://example.com/p/4820"',
    );
    expect(decode(label(source).bitmap, [BarcodeFormat.QR_CODE])).toBe(
      'https://example.com/p/4820',
    );
  });

  it('honours the error correction level', () => {
    const low = label(tspl('SIZE 400 dot, 400 dot', 'CLS', 'QRCODE 40,40,L,4,A,0,"SKU-4820"'))
      .bitmap;
    const high = label(tspl('SIZE 400 dot, 400 dot', 'CLS', 'QRCODE 40,40,H,4,A,0,"SKU-4820"'))
      .bitmap;
    expect(high.countSet()).not.toBe(low.countSet());
  });

  it('scales by the cell width argument', () => {
    const small = label(tspl('SIZE 400 dot, 400 dot', 'CLS', 'QRCODE 40,40,M,3,A,0,"SKU"')).bitmap;
    const large = label(tspl('SIZE 400 dot, 400 dot', 'CLS', 'QRCODE 40,40,M,6,A,0,"SKU"')).bitmap;
    expect(large.countSet()).toBe(small.countSet() * 4);
  });

  it('renders a Data Matrix that decodes', () => {
    const source = tspl('SIZE 400 dot, 400 dot', 'CLS', 'DMATRIX 40,40,200,200,"SKU-4820-117-A"');
    expect(decode(label(source).bitmap, [BarcodeFormat.DATA_MATRIX])).toBe('SKU-4820-117-A');
  });

  it('renders a PDF417 that decodes', () => {
    const source = tspl(
      'SIZE 600 dot, 400 dot',
      'CLS',
      'PDF417 40,40,500,300,0,W2,H6,"SKU-4820-117-A"',
    );
    expect(decode(label(source).bitmap, [BarcodeFormat.PDF_417])).toBe('SKU-4820-117-A');
  });

  it('warns about QR model 1 rather than pretending to draw it', () => {
    const result = render(
      tspl('SIZE 400 dot, 400 dot', 'CLS', 'QRCODE 40,40,M,4,A,0,M1,S1,"X"'),
    );
    expect(result.diagnostics.some((diagnostic) => /model 1/.test(diagnostic.message))).toBe(true);
  });

  it('warns about a PDF417 option it does not understand', () => {
    const result = render(tspl('SIZE 600 dot, 400 dot', 'CLS', 'PDF417 40,40,500,300,0,ZZ,"X"'));
    expect(
      result.diagnostics.some((diagnostic) =>
        /Unrecognised PDF417 option/.test(diagnostic.message),
      ),
    ).toBe(true);
  });
});

describe('print behaviour', () => {
  it('produces one label per PRINT', () => {
    const result = render(
      tspl(
        'SIZE 100 dot, 100 dot',
        'CLS',
        'BAR 0,0,10,10',
        'PRINT 1,1',
        'CLS',
        'BAR 0,0,20,20',
        'PRINT 2,3',
      ),
    );
    expect(result.labels).toHaveLength(2);
    expect(result.labels[0]!.bitmap.countSet()).toBe(100);
    expect(result.labels[1]!.bitmap.countSet()).toBe(400);
    expect(result.labels[1]!.copies).toBe(6);
  });

  it('produces the buffer as one label when the source never prints', () => {
    const result = render(tspl('SIZE 100 dot, 100 dot', 'CLS', 'BAR 0,0,10,10'));
    expect(result.labels).toHaveLength(1);
  });

  it('turns the label end for end under DIRECTION 1', () => {
    const upright = label(tspl('SIZE 100 dot, 100 dot', 'DIRECTION 0', 'CLS', 'BAR 0,0,10,10'))
      .bitmap;
    const turned = label(tspl('SIZE 100 dot, 100 dot', 'DIRECTION 1', 'CLS', 'BAR 0,0,10,10'))
      .bitmap;
    expect(turned.equals(upright.rotated(180))).toBe(true);
  });

  it('mirrors when the second DIRECTION argument is set', () => {
    const image = label(tspl('SIZE 100 dot, 100 dot', 'DIRECTION 0,1', 'CLS', 'BAR 0,0,10,10'))
      .bitmap;
    expect(image.get(99, 5)).toBe(1);
    expect(image.get(0, 5)).toBe(0);
  });

  it('clears the buffer on CLS', () => {
    const image = label(tspl('SIZE 100 dot, 100 dot', 'CLS', 'BAR 0,0,50,50', 'CLS')).bitmap;
    expect(image.countSet()).toBe(0);
  });
});

describe('robustness', () => {
  it('warns about an unknown command and renders the rest', () => {
    const result = render(
      tspl('SIZE 100 dot, 100 dot', 'CLS', 'FROBNICATE 1,2', 'BAR 0,0,10,10'),
    );
    expect(
      result.diagnostics.some((diagnostic) => /Unknown command "FROBNICATE"/.test(diagnostic.message)),
    ).toBe(true);
    expect(result.labels[0]!.bitmap.countSet()).toBe(100);
  });

  it('accepts the setup commands that do not change the picture', () => {
    const result = render(
      tspl(
        'SIZE 100 dot, 100 dot',
        'GAP 2 mm,0',
        'SPEED 4',
        'DENSITY 8',
        'SET TEAR ON',
        'CODEPAGE UTF-8',
        'CLS',
        'BAR 0,0,10,10',
        'PRINT 1',
      ),
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('says an image command is not rendered rather than failing', () => {
    const result = render(tspl('SIZE 100 dot, 100 dot', 'CLS', 'PUTBMP 10,10,"logo.bmp"'));
    expect(result.diagnostics[0]!.severity).toBe('warning');
  });

  it('reports missing arguments and keeps going', () => {
    const result = render(tspl('SIZE 100 dot, 100 dot', 'CLS', 'BAR 10,20', 'BAR 0,0,5,5'));
    expect(errors(result)).toHaveLength(1);
    expect(result.labels[0]!.bitmap.countSet()).toBe(25);
  });

  it('reports a non-numeric coordinate', () => {
    const result = render(tspl('SIZE 100 dot, 100 dot', 'CLS', 'BAR ten,20,30,40'));
    expect(errors(result)[0]!.message).toMatch(/must be a number/);
  });

  it('never throws, whatever it is handed', () => {
    const nonsense = tspl(
      '',
      'SIZE',
      'TEXT',
      'BARCODE 1',
      'QRCODE 1,2',
      '"just a string"',
      'BOX 1,1,1,1,1,1,1,1,1',
      'PRINT -5',
      ' ',
      'SIZE 1e9 dot, 1e9 dot',
    );
    expect(() => render(nonsense)).not.toThrow();
  });

  it('sorts diagnostics by position', () => {
    const result = render(tspl('BAR 1', 'CLS', 'BOX 1'));
    const lines = result.diagnostics.map((diagnostic) => diagnostic.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });
});
