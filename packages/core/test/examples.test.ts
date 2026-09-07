import { describe, expect, it } from 'vitest';
import { importCpcl } from '../src/import/cpcl.js';
import { importTspl } from '../src/import/tspl.js';
import { importZpl } from '../src/import/zpl.js';
import { commandExamples, commandsIn, exampleFor } from '../src/printer/examples.js';

describe('command examples', () => {
  it('covers the commands each language writes', () => {
    expect([...commandExamples('tspl').keys()]).toEqual(
      expect.arrayContaining(['SIZE', 'TEXT', 'BLOCK', 'BARCODE', 'QRCODE', 'DMATRIX', 'PDF417', 'BAR', 'BOX']),
    );
    expect([...commandExamples('zpl').keys()]).toEqual(
      expect.arrayContaining(['^FO', '^FD', '^BC', '^BQ', '^BX', '^B7', '^GB', '^BY', '^FB']),
    );
    expect([...commandExamples('cpcl').keys()]).toEqual(
      expect.arrayContaining(['TEXT', 'BARCODE', 'B QR', 'LINE', 'BOX', 'PAGE-WIDTH']),
    );
  });

  it('shows an example that this program itself can read back', () => {
    // The example is only worth showing if following it works, so each set is
    // fed through the importer that rejected the reader's line in the first
    // place. Nothing here may come back as unmapped.
    for (const [language, importer] of [
      ['tspl', importTspl],
      ['zpl', importZpl],
      ['cpcl', importCpcl],
    ] as const) {
      const lines = [...new Set(commandExamples(language).values())].join('\n');
      const result = importer(lines, { dpi: 203 });
      expect(result.unmapped, language).toEqual([]);
    }
  });

  it('finds the example from a line the reader typed', () => {
    expect(exampleFor('tspl', 'BARCODE 1,2,"128"')).toContain('BARCODE ');
    expect(exampleFor('tspl', '  barcode 1,2')).toContain('BARCODE ');
    expect(exampleFor('zpl', '^FO10,10^BCN,50')).toContain('^BC');
    expect(exampleFor('cpcl', 'B QR 1 2 M 2 U 4')).toContain('B QR');
  });

  it('says nothing about a command this program does not write', () => {
    expect(exampleFor('tspl', 'SOUND 3,200')).toBeUndefined();
    expect(exampleFor('zpl', '^SN001,1,Y')).toBeUndefined();
    expect(exampleFor('tspl', '')).toBeUndefined();
  });

  it('reads the commands out of a line', () => {
    expect(commandsIn('zpl', '^FO32,32^A0N,24,24^FDText^FS')).toEqual(['^FO', '^A0', '^FD', '^FS']);
    expect(commandsIn('tspl', 'TEXT 32,32,"0"')).toEqual(['TEXT']);
    expect(commandsIn('cpcl', 'B PDF-417 32 32')).toEqual(['B PDF-417', 'B']);
    expect(commandsIn('tspl', 'PDF417 1,2')).toEqual(['PDF417']);
  });
});
