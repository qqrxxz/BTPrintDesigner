import { describe, expect, it } from 'vitest';
import { renderMatrix } from '../src/barcode/matrix.js';
import { encodePdf417 } from '../src/barcode/pdf417/encode.js';
import { CODEWORD_PATTERNS } from '../src/barcode/pdf417/patterns.js';
import { BarcodeError } from '../src/barcode/types.js';
import { BarcodeFormat, decode } from './helpers/decode.js';

const read = (data: string, options = {}, moduleWidth = 3): string =>
  decode(renderMatrix(encodePdf417(data, options), { moduleWidth }), [BarcodeFormat.PDF_417]);

/** Deterministic generator, so a failing case is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('pattern table', () => {
  it('holds three clusters of 929 seventeen-module patterns', () => {
    expect(CODEWORD_PATTERNS).toHaveLength(3);
    for (const cluster of CODEWORD_PATTERNS) {
      expect(cluster).toHaveLength(929);
      for (const pattern of cluster) {
        expect(pattern).toBeGreaterThanOrEqual(0x10000);
        expect(pattern).toBeLessThanOrEqual(0x1ffff);
        // Every codeword starts with a bar and ends with a space.
        expect((pattern >> 16) & 1).toBe(1);
        expect(pattern & 1).toBe(0);
      }
    }
  });

  it('has no duplicate patterns within a cluster', () => {
    for (const cluster of CODEWORD_PATTERNS) {
      expect(new Set(cluster).size).toBe(cluster.length);
    }
  });
});

describe('PDF417 round trip', () => {
  const samples = [
    'PDF417',
    'HELLO WORLD',
    'SKU-4820-117-A',
    'https://example.com/p/4820',
    '1234567890123456789012345678901234567890123456',
    'Mixed Case 42',
    'Кабель USB-C 2 м',
    'x'.repeat(300),
    '@[\\]_`~!{}\'"|()?<>;',
  ];
  for (const sample of samples) {
    it(`reads back ${JSON.stringify(sample.slice(0, 32))}`, () => {
      expect(read(sample)).toBe(sample);
    });
  }

  it('reads back at every error correction level that fits', () => {
    for (let level = 0; level <= 6; level++) {
      expect(read('LEVEL TEST 42', { errorCorrection: level })).toBe('LEVEL TEST 42');
    }
  });

  it('reads back across column counts', () => {
    for (const columns of [1, 2, 5, 10, 20, 30]) {
      expect(read('COLUMN TEST 42', { columns })).toBe('COLUMN TEST 42');
    }
  });
});

/**
 * Text compaction has four sub-modes with latches and shifts between them, and
 * a wrong entry in one of those tables only shows on the characters it covers.
 * Random strings over the whole printable range are the cheapest way to walk
 * every path through it.
 */
describe('text compaction survives random payloads', () => {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ' +
    '&,:#-.$/+%*=^;<>@[\\]_`~!"|()?{}\'';

  for (let seed = 1; seed <= 60; seed++) {
    it(`seed ${seed}`, () => {
      const random = makeRandom(seed);
      const length = 4 + Math.floor(random() * 90);
      let payload = '';
      for (let i = 0; i < length; i++) {
        payload += alphabet[Math.floor(random() * alphabet.length)]!;
      }
      expect(read(payload)).toBe(payload);
    });
  }
});

describe('compaction choices', () => {
  it('packs long digit runs more tightly than text would', () => {
    const digits = '9'.repeat(60);
    const asDigits = encodePdf417(digits, { columns: 4, errorCorrection: 2 });
    const asLetters = encodePdf417('A'.repeat(60), { columns: 4, errorCorrection: 2 });
    expect(asDigits.height).toBeLessThan(asLetters.height);
  });

  it('starts paying for itself at the thirteen-digit threshold', () => {
    // Twelve digits stay in text compaction at two per codeword; thirteen
    // switch to numeric, and the latch is already cheaper than the characters
    // it replaces.
    const twelve = encodePdf417('1'.repeat(12), { columns: 4, errorCorrection: 2 });
    const thirteen = encodePdf417('1'.repeat(13), { columns: 4, errorCorrection: 2 });
    expect(thirteen.height).toBeLessThanOrEqual(twelve.height);
  });

  it('falls back to byte compaction outside the text alphabet', () => {
    expect(read('Кабель')).toBe('Кабель');
  });
});

describe('PDF417 shape', () => {
  it('is 86 modules wide with a single data column', () => {
    expect(encodePdf417('X', { columns: 1 }).width).toBe(86);
  });

  it('grows by seventeen modules per added column', () => {
    expect(encodePdf417('X', { columns: 5 }).width).toBe(86 + 4 * 17);
  });

  it('declares rows three times as tall as a module is wide', () => {
    expect(encodePdf417('X').moduleAspect).toBe(3);
  });

  it('asks for a two-module quiet zone', () => {
    expect(encodePdf417('X').quietZone).toBe(2);
  });

  it('aims for the requested aspect ratio', () => {
    const wide = encodePdf417('A'.repeat(100), { aspectRatio: 4 });
    const tall = encodePdf417('A'.repeat(100), { aspectRatio: 0.5 });
    expect(wide.width / (wide.height * 3)).toBeGreaterThan(tall.width / (tall.height * 3));
  });

  it('honours explicit rows and columns', () => {
    const symbol = encodePdf417('SHAPE', { rows: 10, columns: 4 });
    expect(symbol.height).toBe(10);
    expect(symbol.width).toBe(86 + 3 * 17);
  });

  it('says how many codewords a forced shape is short by', () => {
    expect(() => encodePdf417('A'.repeat(200), { rows: 3, columns: 1 })).toThrow(
      /holds 3 codewords, but this payload needs/,
    );
  });

  it('rejects an out-of-range column count', () => {
    expect(() => encodePdf417('X', { columns: 31 })).toThrow(/from 1 to 30/);
  });

  it('rejects an out-of-range error correction level', () => {
    expect(() => encodePdf417('X', { errorCorrection: 9 as 8 })).toThrow(/must be 0 to 8/);
  });

  it('refuses a payload beyond the symbol limit', () => {
    expect(() => encodePdf417('A'.repeat(4000))).toThrow(/more than the 928/);
  });

  it('rejects empty data', () => {
    expect(() => encodePdf417('')).toThrow(BarcodeError);
  });
});
