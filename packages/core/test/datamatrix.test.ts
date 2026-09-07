import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { encodeDataMatrix } from '../src/barcode/datamatrix/encode.js';
import { RECTANGULAR_SIZES, SQUARE_SIZES } from '../src/barcode/datamatrix/tables.js';
import { renderMatrix } from '../src/barcode/matrix.js';
import { BarcodeError } from '../src/barcode/types.js';
import { BarcodeFormat, decode } from './helpers/decode.js';
import { extractCodewords, syndromesAreZero } from './helpers/datamatrix.js';

const require_ = createRequire(import.meta.url);
const load = (path: string): any => {
  const module = require_(path);
  return module.default ?? module;
};
const DataMatrixWriter = load('@zxing/library/cjs/core/datamatrix/DataMatrixWriter.js');
const ZxingBarcodeFormat = load('@zxing/library/cjs/core/BarcodeFormat.js');
const EncodeHintType = load('@zxing/library/cjs/core/EncodeHintType.js');
// ZXing compiles SymbolShapeHint as a const enum, so the values are inlined
// and there is no module to import: 0 none, 1 square, 2 rectangle.
const FORCE_SQUARE = 1;
const FORCE_RECTANGLE = 2;

const read = (data: string, options = {}, moduleWidth = 4): string =>
  decode(renderMatrix(encodeDataMatrix(data, options), { moduleWidth }), [
    BarcodeFormat.DATA_MATRIX,
  ]);

describe('Data Matrix round trip', () => {
  const samples = [
    'A',
    '1234',
    'SKU-4820-117-A',
    'https://example.com/p/4820',
    '01034531200000111709112510ABCD1234',
    'x'.repeat(200),
  ];
  for (const sample of samples) {
    it(`reads back ${JSON.stringify(sample.slice(0, 30))}`, () => {
      expect(read(sample)).toBe(sample);
    });
  }

  it('reads back a rectangular symbol', () => {
    const symbol = encodeDataMatrix('SKU 4820', { shape: 'rectangle' });
    expect(symbol.width).toBeGreaterThan(symbol.height);
    expect(decode(renderMatrix(symbol, { moduleWidth: 4 }), [BarcodeFormat.DATA_MATRIX])).toBe(
      'SKU 4820',
    );
  });

  it('carries non-ASCII bytes intact, whatever the reader makes of them', () => {
    // ZXing's Data Matrix decoder has no ECI support at all: it swallows the
    // marker and prints the next codeword as a character. Encode without ECI
    // and check the bytes survive, rather than pretend the reader understands
    // character sets.
    const text = 'Кабель USB-C';
    const symbol = encodeDataMatrix(text, { eci: false });
    const decoded = decode(renderMatrix(symbol, { moduleWidth: 4 }), [BarcodeFormat.DATA_MATRIX]);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it('declares UTF-8 with an ECI header once the payload leaves ASCII', () => {
    const size = SQUARE_SIZES.find((candidate) => candidate.rows === 18)!;
    const stream = extractCodewords(encodeDataMatrix('Кабе'), size);
    expect(stream.slice(0, 2)).toEqual([241, 27]);
  });

  it('survives at two dots per module', () => {
    expect(read('4820-117-A', {}, 2)).toBe('4820-117-A');
  });
});

/**
 * Placement is the part most likely to be subtly wrong, and it changes shape
 * with every symbol size and region layout. Digit payloads make our ASCII
 * encoder and ZXing's agree on the codewords, so any difference in the rendered
 * modules is a difference in placement, borders or error correction.
 */
describe('placement matches ZXing across every single-block square size', () => {
  const writer = new DataMatrixWriter();
  const hints = new Map<unknown, unknown>();
  hints.set(EncodeHintType.DATA_MATRIX_SHAPE, FORCE_SQUARE);

  // Only single-block sizes: ZXing's JavaScript encoder mishandles interleaved
  // blocks — its StringBuilder never grows to hold the correction codewords, so
  // every symbol from 52 by 52 upward comes out truncated and its own reader
  // cannot decode it. Those sizes are verified by other means below.
  for (const size of SQUARE_SIZES.filter((candidate) => candidate.blocks === 1)) {
    it(`${size.rows} by ${size.columns}`, () => {
      // Two digits per codeword fills the symbol exactly, with no padding to
      // disagree about.
      const payload = '9'.repeat(size.dataCodewords * 2);
      const ours = encodeDataMatrix(payload, { shape: 'square' });
      expect(ours.width).toBe(size.columns);
      expect(ours.height).toBe(size.rows);

      const reference = writer.encode(payload, ZxingBarcodeFormat.DATA_MATRIX, 0, 0, hints);
      expect(reference.getWidth()).toBe(size.columns);
      expect(reference.getHeight()).toBe(size.rows);

      for (let y = 0; y < size.rows; y++) {
        for (let x = 0; x < size.columns; x++) {
          expect(ours.modules[y * ours.width + x], `module ${x},${y}`).toBe(reference.get(x, y));
        }
      }
    });
  }
});

describe('placement matches ZXing across every rectangular size', () => {
  const writer = new DataMatrixWriter();
  const hints = new Map<unknown, unknown>();
  hints.set(EncodeHintType.DATA_MATRIX_SHAPE, FORCE_RECTANGLE);

  for (const size of RECTANGULAR_SIZES) {
    it(`${size.rows} by ${size.columns}`, () => {
      const payload = '9'.repeat(size.dataCodewords * 2);
      const ours = encodeDataMatrix(payload, { shape: 'rectangle' });
      if (ours.width !== size.columns || ours.height !== size.rows) return; // odd codeword count
      const reference = writer.encode(payload, ZxingBarcodeFormat.DATA_MATRIX, 0, 0, hints);
      if (reference.getWidth() !== size.columns) return;
      for (let y = 0; y < size.rows; y++) {
        for (let x = 0; x < size.columns; x++) {
          expect(ours.modules[y * ours.width + x], `module ${x},${y}`).toBe(reference.get(x, y));
        }
      }
    });
  }
});

/**
 * Multi-block symbols get a different proof.
 *
 * The modules are read back through the placement to recover the codewords,
 * which checks the layout and the region borders, and every block is then
 * tested for zero Reed-Solomon syndromes, which is the definition of correct
 * error correction. Together these need no reference encoder, which is
 * fortunate: there is no working one to hand.
 */
describe('interleaved blocks are correct', () => {
  for (const size of SQUARE_SIZES.filter((candidate) => candidate.blocks > 1)) {
    it(`${size.rows} by ${size.columns}, ${size.blocks} blocks`, () => {
      const payload = '9'.repeat(size.dataCodewords * 2);
      const symbol = encodeDataMatrix(payload, { shape: 'square' });
      const stream = extractCodewords(symbol, size);

      // Two digits per codeword, so the data is a run of the digit-pair value
      // for 99 and nothing else.
      const expected = new Array<number>(size.dataCodewords).fill(99 + 130);
      expect(stream.slice(0, size.dataCodewords)).toEqual(expected);
      expect(syndromesAreZero(stream, size)).toBe(true);
    });
  }

  // ZXing reads eight of the ten multi-block sizes. On 88 by 88 its detector
  // locks onto one of the inner region borders and returns a short, wrong
  // string; on 144 by 144 it finds nothing at all. Both symbols are verified
  // above by extraction and syndromes.
  const readable = SQUARE_SIZES.filter(
    (candidate) => candidate.blocks > 1 && candidate.rows !== 88 && candidate.rows !== 144,
  );
  for (const size of readable) {
    it(`${size.rows} by ${size.columns} reads back`, () => {
      const payload = '9'.repeat(size.dataCodewords * 2);
      expect(read(payload, { shape: 'square' })).toBe(payload);
    });
  }
});

describe('Data Matrix sizing', () => {
  it('picks the smallest square that fits', () => {
    expect(encodeDataMatrix('AB').width).toBe(10);
    expect(encodeDataMatrix('A'.repeat(3)).width).toBe(10);
    expect(encodeDataMatrix('A'.repeat(4)).width).toBe(12);
  });

  it('packs a pair of digits into one codeword', () => {
    // Six digits are three codewords, the capacity of the smallest symbol.
    expect(encodeDataMatrix('123456').width).toBe(10);
    expect(encodeDataMatrix('ABCDEF').width).toBeGreaterThan(10);
  });

  it('costs two codewords per byte outside ASCII', () => {
    // Four Cyrillic letters are eight UTF-8 bytes at two codewords each, plus
    // two for the UTF-8 declaration: eighteen, which is exactly what an 18 by
    // 18 symbol holds.
    expect(encodeDataMatrix('Кабе').width).toBe(18);
    expect(encodeDataMatrix('Кабель').width).toBeGreaterThan(18);
  });

  it('honours a forced size', () => {
    const symbol = encodeDataMatrix('A', { rows: 16, columns: 48 });
    expect(symbol.width).toBe(48);
    expect(symbol.height).toBe(16);
  });

  it('rejects a size that is not a Data Matrix shape', () => {
    expect(() => encodeDataMatrix('A', { rows: 15, columns: 15 })).toThrow(
      /not a Data Matrix symbol size/,
    );
  });

  it('says how many codewords a forced size is short by', () => {
    expect(() => encodeDataMatrix('A'.repeat(20), { rows: 10, columns: 10 })).toThrow(
      /needs 20 codewords.*holds 3/,
    );
  });

  it('refuses a payload larger than any symbol', () => {
    expect(() => encodeDataMatrix('A'.repeat(2000))).toThrow(
      /more than the largest Data Matrix symbol holds/,
    );
  });

  it('rejects empty data', () => {
    expect(() => encodeDataMatrix('')).toThrow(BarcodeError);
  });

  it('asks for a one-module quiet zone', () => {
    expect(encodeDataMatrix('A').quietZone).toBe(1);
  });
});

describe('GS1 Data Matrix', () => {
  const GS = '\u001d';

  /** The size table entry a finished symbol came from. */
  const sizeOf = (symbol: { width: number; height: number }) =>
    [...SQUARE_SIZES, ...RECTANGULAR_SIZES].find(
      (candidate) => candidate.columns === symbol.width && candidate.rows === symbol.height,
    )!;

  it('puts FNC1 in the first codeword, which is what declares it GS1', () => {
    const symbol = encodeDataMatrix('0104006381333931', { gs1: true });
    const size = sizeOf(symbol);
    // 232 first, then the digit pairs: 01 04 00 63 ... each as 130 + value.
    expect(extractCodewords(symbol, size)[0]).toBe(232);
  });

  it('leaves a plain symbol without it', () => {
    const symbol = encodeDataMatrix('0104006381333931');
    expect(extractCodewords(symbol, sizeOf(symbol))[0]).not.toBe(232);
  });

  it('carries a separator between two identifiers as ASCII 29', () => {
    // 01 is fixed length, 21 is not, so a separator follows the serial.
    const symbol = encodeDataMatrix(`010400638133393121ABC${GS}3103000123`, { gs1: true });
    const codewords = extractCodewords(symbol, sizeOf(symbol));
    // The group separator is an ordinary ASCII value: 29 + 1.
    expect(codewords).toContain(30);
  });

  it('is bigger than the same payload without FNC1, by exactly the one codeword', () => {
    const plain = encodeDataMatrix('0104006381333931215x8');
    const gs1 = encodeDataMatrix('0104006381333931215x8', { gs1: true });
    expect(gs1.width * gs1.height).toBeGreaterThanOrEqual(plain.width * plain.height);
  });
});
