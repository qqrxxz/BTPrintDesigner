import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { encodeEan13, encodeUpcE } from '../src/barcode/ean.js';

/**
 * Cross-checks our EAN/UPC tables against ZXing's own constants.
 *
 * ZXing's UPC-E *reader* cannot be used for a round trip — the JavaScript port
 * is marked experimental and loses the number system and check digit, because
 * `decodeMiddle` appends to a local string and then discards the StringBuilder
 * it fills in. Its *tables*, though, are a genuine independent source, and
 * comparing against them catches exactly what a hand-typed table gets wrong.
 */
const require_ = createRequire(import.meta.url);
const upcEReader = require_('@zxing/library/cjs/core/oned/UPCEReader.js');
const upcEanReader = require_('@zxing/library/cjs/core/oned/UPCEANReader.js');
const ean13Reader = require_('@zxing/library/cjs/core/oned/EAN13Reader.js');

const NUMSYS: number[][] = Array.from(
  (upcEReader.default ?? upcEReader).NUMSYS_AND_CHECK_DIGIT_PATTERNS,
  (row: Iterable<number>) => Array.from(row),
);
const L_WIDTHS: number[][] = Array.from(
  (upcEanReader.default ?? upcEanReader).L_PATTERNS,
  (row: Iterable<number>) => Array.from(row),
);
const FIRST_DIGIT: number[] = Array.from((ean13Reader.default ?? ean13Reader).FIRST_DIGIT_ENCODINGS);

/** ZXing stores digit patterns as four run lengths, space first. */
function widthsToBits(widths: readonly number[]): string {
  let bits = '';
  widths.forEach((width, index) => {
    bits += (index % 2 === 0 ? '0' : '1').repeat(width);
  });
  return bits;
}

const complement = (bits: string): string =>
  Array.from(bits, (bit) => (bit === '1' ? '0' : '1')).join('');
const reversed = (bits: string): string => Array.from(bits).reverse().join('');

/** Six-position parity mask, most significant bit first, 1 meaning even set. */
function maskToParity(mask: number): string {
  let parity = '';
  for (let bit = 5; bit >= 0; bit--) parity += (mask >> bit) & 1 ? 'E' : 'O';
  return parity;
}

// The module tables are private to the encoder, so read them back out of the
// symbols it produces: digits sit seven modules in, after the 101 guard.
function leftDigitBits(symbolModules: readonly boolean[], index: number): string {
  return symbolModules
    .slice(3 + index * 7, 3 + (index + 1) * 7)
    .map((module) => (module ? '1' : '0'))
    .join('');
}

/** Right-hand digits start after the guard, six digits and the centre guard. */
function rightDigitBits(symbolModules: readonly boolean[], index: number): string {
  return symbolModules
    .slice(50 + index * 7, 50 + (index + 1) * 7)
    .map((module) => (module ? '1' : '0'))
    .join('');
}

describe('digit sets match ZXing', () => {
  for (let digit = 0; digit < 10; digit++) {
    it(`encodes digit ${digit} identically in all three sets`, () => {
      const odd = widthsToBits(L_WIDTHS[digit]!);
      const right = complement(odd);
      const even = reversed(right);

      // Leading digit 0 gives parity OOOOOO, so every left-hand digit uses the
      // odd set and every right-hand one the right set.
      const allOdd = encodeEan13(`0${String(digit).repeat(6)}${String(digit).repeat(5)}`);
      expect(leftDigitBits(allOdd.modules, 0)).toBe(odd);
      expect(leftDigitBits(allOdd.modules, 5)).toBe(odd);
      expect(rightDigitBits(allOdd.modules, 0)).toBe(right);

      // Leading digit 9 gives OEEOEO, so the second left-hand digit is even.
      const mixed = encodeEan13(`9${String(digit).repeat(6)}${String(digit).repeat(5)}`);
      expect(leftDigitBits(mixed.modules, 1)).toBe(even);
    });
  }
});

describe('parity tables match ZXing', () => {
  it('uses ZXing\'s EAN-13 first-digit parity patterns', () => {
    for (let leading = 0; leading < 10; leading++) {
      const symbol = encodeEan13(`${leading}00000000000`);
      let observed = '';
      for (let position = 0; position < 6; position++) {
        const bits = leftDigitBits(symbol.modules, position);
        // Digit 0 in the odd set starts with three spaces; in the even set it
        // starts with one.
        observed += bits === widthsToBits(L_WIDTHS[0]!) ? 'O' : 'E';
      }
      expect(observed).toBe(maskToParity(FIRST_DIGIT[leading]!));
    }
  });

  it('uses ZXing\'s UPC-E parity patterns for number system 0', () => {
    for (let check = 0; check < 10; check++) {
      // Find a six-digit payload whose check digit is the one we want.
      let payload: string | undefined;
      for (let candidate = 0; candidate < 1000 && payload === undefined; candidate++) {
        const trial = String(candidate).padStart(5, '0') + '5';
        if (Number(encodeUpcE(trial).text.slice(-1)) === check) payload = trial;
      }
      expect(payload, `no payload found with check digit ${check}`).toBeDefined();

      const symbol = encodeUpcE(payload!);
      let observed = 0;
      for (let position = 0; position < 6; position++) {
        const digit = Number(payload![position]);
        const isOdd = leftDigitBits(symbol.modules, position) === widthsToBits(L_WIDTHS[digit]!);
        if (!isOdd) observed |= 1 << (5 - position);
      }
      expect(observed).toBe(NUMSYS[0]![check]!);
    }
  });

  it('inverts the parity for number system 1', () => {
    // Changing the number system changes the expanded UPC-A and therefore the
    // check digit, so this is not simply the mirror of the system-0 symbol for
    // the same payload: it is the mirror of the pattern for whatever check
    // digit results. ZXing's own system-1 table agrees, except at check digit
    // 9, where the JavaScript port carries 1 instead of 0x1A — a transcription
    // slip in the library. That entry is checked against the rule instead.
    for (let candidate = 0; candidate < 200; candidate++) {
      const payload = String(candidate).padStart(6, '0');
      const symbol = encodeUpcE(payload, { numberSystem: 1 });
      const check = Number(symbol.text.slice(-1));

      let observed = 0;
      for (let position = 0; position < 6; position++) {
        const digit = Number(payload[position]);
        const isOdd = leftDigitBits(symbol.modules, position) === widthsToBits(L_WIDTHS[digit]!);
        if (!isOdd) observed |= 1 << (5 - position);
      }

      expect(observed).toBe(~NUMSYS[0]![check]! & 0b111111);
      if (check !== 9) expect(observed).toBe(NUMSYS[1]![check]!);
    }
  });
});
