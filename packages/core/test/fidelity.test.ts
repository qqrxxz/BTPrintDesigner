import { describe, expect, it } from 'vitest';
import { Bitmap1 } from '../src/bitmap/Bitmap1.js';
import { generateCpcl } from '../src/generate/cpcl.js';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { importCpcl } from '../src/import/cpcl.js';
import { importZpl } from '../src/import/zpl.js';
import type { TextElement } from '../src/model/document.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';
import { principalLabel } from '../src/printer/principal.js';
import { renderZpl } from '../src/zpl/execute.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

describe('which label is the design', () => {
  it('skips a job that drew nothing', () => {
    const blank = new Bitmap1(8, 8);
    const inked = new Bitmap1(8, 8);
    inked.set(1, 1, true);
    expect(principalLabel([{ bitmap: blank }, { bitmap: inked }])?.bitmap).toBe(inked);
  });

  it('falls back on the first when none has anything on it', () => {
    const first = new Bitmap1(8, 8);
    expect(principalLabel([{ bitmap: first }, { bitmap: new Bitmap1(8, 8) }])?.bitmap).toBe(first);
  });
});

describe('ZPL text placed by its baseline', () => {
  const source = '^XA\n^PW400\n^LL200\n^FT20,60^A0N,30,30^FDНаименование^FS\n^XZ\n';

  it('keeps ^FT, rather than reading the baseline as the top', () => {
    // Read as ^FO, every ^FT line of a template moved down by its own height
    // the first time the template was edited.
    const text = importZpl(source).document.elements[0] as TextElement;
    expect(text.anchor).toBe('baseline');
    expect(generateZpl(importZpl(source).document, { dpi: 203 }).source).toContain('^FT20,60^A0N,30,30');
  });

  it('is placed by its top when the design moves to a language without baselines', () => {
    const text = importZpl(source).document.elements[0] as TextElement;
    const tspl = generateTspl({ ...importZpl(source).document, elements: [text] }, { dpi: 203 }).source;
    // Thirty dots of text whose baseline is at 60 starts at 30.
    expect(tspl).toMatch(/TEXT 20,30,/);
  });

  it('survives a saved project', () => {
    const read = parseDocument(JSON.parse(serializeDocument(importZpl(source).document))).document!;
    expect((read.elements[0] as TextElement).anchor).toBe('baseline');
  });
});

describe('a size the file did not state', () => {
  it('is not written into ZPL', () => {
    // Writing the editor's assumed 4 by 2 inches told a 58 mm printer to
    // expect a label twice its size.
    const out = generateZpl(importZpl('^XA\n^FO10,10^GB80,8,8^FS\n^XZ\n').document, { dpi: 203 }).source;
    expect(out).not.toContain('^PW');
    expect(out).not.toContain('^LL');
  });

  it('is written when the file stated it', () => {
    const out = generateZpl(importZpl('^XA\n^PW464\n^LL320\n^FO10,10^GB80,8,8^FS\n^XZ\n').document, {
      dpi: 203,
    }).source;
    expect(out).toContain('^PW464');
    expect(out).toContain('^LL320');
  });

  it('is not written into CPCL either, where the page width is optional', () => {
    const out = generateCpcl(importCpcl('! 0 200 200 210 1\nLINE 8 8 80 8 3\nFORM\nPRINT\n').document, {
      dpi: 203,
    }).source;
    expect(out).not.toContain('PAGE-WIDTH');
  });
});

describe('CPCL text', () => {
  const job = (...lines: string[]) => ['! 0 200 200 210 1', ...lines, 'FORM', 'PRINT', ''].join('\n');

  it('reads the size as an index, not a height in dots', () => {
    // Size 0 is the smallest cell of the font, twelve dots tall — not zero.
    const text = importCpcl(job('T 0 0 20 10 Hello')).document.elements[0] as TextElement;
    expect(text.style.heightMm).toBeGreaterThan(1);
  });

  it('keeps the font the job named, stored fonts included', () => {
    const out = generateCpcl(importCpcl(job('T Ari10pt.cpf 1 8 88 @Attr2@')).document, { dpi: 203 }).source;
    expect(out).toContain('TEXT Ari10pt.cpf 1 8 88 @Attr2@');
  });

  it('keeps a bare CENTER bare, because the edge belongs to the printer', () => {
    // A span as wide as the editor assumed would centre the line elsewhere on
    // a narrower printer.
    const out = generateCpcl(importCpcl(job('CENTER', 'T 0 0 20 10 ООО Игрушка', 'LEFT')).document, {
      dpi: 203,
    }).source;
    expect(out).toMatch(/^CENTER$/m);
    expect(out).toContain('TEXT 0 0 20 10 ООО Игрушка');
  });

  it('keeps the font and gap of the line under a barcode', () => {
    const out = generateCpcl(
      importCpcl(job('BT 7 0 6', 'B EAN13 3 20 107 0 168 4006381333931', 'BT OFF')).document,
      { dpi: 203 },
    ).source;
    expect(out).toContain('BARCODE-TEXT 7 0 6');
  });

  it('keeps a UTILITIES session as the job it was', () => {
    const source = ['! UTILITIES', 'SET-TOF 0', 'ON-FEED FEED', 'PRINT', job('LINE 8 8 80 8 3')].join('\n');
    const document = importCpcl(source).document;
    expect(document.setupJob).toEqual(['SET-TOF 0', 'ON-FEED FEED']);
    const out = generateCpcl(document, { dpi: 203 }).source;
    expect(out.indexOf('! UTILITIES')).toBeLessThan(out.indexOf('! 0 200 200'));
    expect(out.slice(out.indexOf('! 0 200 200'))).not.toContain('SET-TOF');
  });
});

describe('a font belongs to one language', () => {
  it('is not written into the code of another printer', () => {
    // A CPCL "Ari10pt.cpf" means nothing to a TSC, and a TSPL "2" nothing to a
    // Zebra; each generator sizes such text by its height instead.
    const cpcl = importCpcl('! 0 200 200 210 1\nT Ari10pt.cpf 1 8 88 Кабель\nFORM\nPRINT\n').document;
    expect(generateTspl(cpcl, { dpi: 203 }).source).not.toContain('Ari10pt');
    expect(generateZpl(cpcl, { dpi: 203 }).source).not.toContain('Ari10pt');
  });

  it('keeps a ZPL stored font by its file', () => {
    const source = '^XA\n^PW400\n^LL200\n^FO0,20^A@N,10,10,E:ARI003.FNT^FD@Name1@^FS\n^XZ\n';
    expect(generateZpl(importZpl(source).document, { dpi: 203 }).source).toContain('^A@N,10,10,E:ARI003.FNT');
  });
});

describe('ZPL field data under ^FH', () => {
  it('is read as the text it spells, both for the preview and on import', () => {
    // This program writes a caret as _5E; read back as three characters, the
    // next export printed "_5E" on the label.
    const source = '^XA\n^PW400\n^LL200\n^FO10,10^A0N,24,24^FH^FDA_5EB_7EC_5FD^FS\n^XZ\n';
    const text = importZpl(source).document.elements[0] as TextElement;
    expect(text.content).toBe('A^B~C_D');
  });

  it('comes back from its own output unchanged, underscores included', () => {
    const source = '^XA\n^PW400\n^LL200\n^FO10,10^A0N,24,24^FH^FDA_5EB_7EC_5FD^FS\n^XZ\n';
    const once = generateZpl(importZpl(source).document, { dpi: 203 }).source;
    const text = importZpl(once).document.elements[0] as TextElement;
    expect(text.content).toBe('A^B~C_D');
  });

  it('reads an escaped Cyrillic letter as the letter', () => {
    // К is D0 9A in UTF-8.
    const source = '^XA\n^CI28\n^FO10,10^A0N,24,24^FH^FD_D0_9A^FS\n^XZ\n';
    expect((importZpl(source).document.elements[0] as TextElement).content).toBe('К');
  });
});

describe('the ZPL preview under ^FH', () => {
  it('draws the text the escapes spell, not the escapes', () => {
    const fonts = { scalable: condensedBoldFont(), fixed: monoFont() };
    const draw = (field: string) =>
      renderZpl(`^XA\n^PW300\n^LL100\n^FO10,10^A0N,40,40${field}^FS\n^XZ\n`, { fonts, dpi: 203 })
        .labels[0]!.bitmap;
    expect(draw('^FH^FD_41_42').equals(draw('^FDAB'))).toBe(true);
  });
});
