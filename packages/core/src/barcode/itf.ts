import { BarcodeError, patternToModules, requireDigits, type LinearSymbol } from './types.js';

/**
 * Interleaved 2 of 5, including ITF-14 (ISO/IEC 16390).
 *
 * Digits are encoded in pairs, the first digit in the bars and the second in
 * the spaces between them, which is where the density comes from and also
 * where the danger comes from: the symbol carries no self-checking, so a
 * partial scan can read as a valid shorter number. That is why ITF-14 fixes the
 * length and why bearer bars exist.
 */

/** Five elements per digit; `true` marks a wide element. */
const PATTERNS: readonly string[] = [
  'nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw',
  'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn',
];

export interface ItfOptions {
  /** Append the modulo 10 check digit. */
  readonly checkDigit?: boolean;
  /**
   * Prefix a zero when the digit count is odd.
   *
   * Without this an odd count is an error, which is usually what the user wants
   * to hear: a silently added digit changes the number the label claims.
   */
  readonly padOdd?: boolean;
  readonly wideRatio?: 2 | 3;
}

/** Modulo 10 check digit, weights 3 and 1 from the right. */
export function itfCheckDigit(digits: readonly number[]): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i]! * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function encodeItf(data: string, options: ItfOptions = {}): LinearSymbol {
  const wide = options.wideRatio ?? 3;
  if (wide !== 2 && wide !== 3) throw new BarcodeError('ITF wide ratio must be 2 or 3');

  let digits = requireDigits(data, 'ITF');
  if (digits.length === 0) throw new BarcodeError('ITF needs at least one digit');

  if (options.checkDigit) digits = [...digits, itfCheckDigit(digits)];

  if (digits.length % 2 !== 0) {
    if (!options.padOdd) {
      throw new BarcodeError(
        `ITF encodes digits in pairs, so it needs an even count; got ${digits.length}. ` +
          'Add a leading zero or turn on padding.',
      );
    }
    digits = [0, ...digits];
  }

  const modules: boolean[] = [];
  modules.push(...patternToModules([1, 1, 1, 1])); // Start: four narrow elements.

  for (let i = 0; i < digits.length; i += 2) {
    const bars = PATTERNS[digits[i]!]!;
    const spaces = PATTERNS[digits[i + 1]!]!;
    const widths: number[] = [];
    for (let element = 0; element < 5; element++) {
      widths.push(bars[element] === 'w' ? wide : 1);
      widths.push(spaces[element] === 'w' ? wide : 1);
    }
    modules.push(...patternToModules(widths));
  }

  modules.push(...patternToModules([wide, 1, 1])); // Stop: wide bar, narrow space, narrow bar.

  return {
    symbology: 'itf',
    modules,
    quietZone: { left: 10, right: 10 },
    text: digits.join(''),
  };
}

/**
 * ITF-14, the shipping-container symbol: thirteen digits plus a check digit,
 * length fixed by the standard rather than by the caller.
 */
export function encodeItf14(data: string, options: Omit<ItfOptions, 'padOdd'> = {}): LinearSymbol {
  const digits = requireDigits(data, 'ITF-14');
  if (digits.length === 13) {
    return { ...encodeItf(data, { ...options, checkDigit: true }), symbology: 'itf' };
  }
  if (digits.length === 14) {
    const expected = itfCheckDigit(digits.slice(0, 13));
    if (digits[13] !== expected) {
      throw new BarcodeError(
        `ITF-14 check digit is ${digits[13]!}, but the first thirteen digits require ${expected}`,
      );
    }
    return encodeItf(data, { ...options, checkDigit: false });
  }
  throw new BarcodeError(`ITF-14 needs 13 or 14 digits, got ${digits.length}`);
}
