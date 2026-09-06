import { BarcodeError, patternToModules, type LinearSymbol } from './types.js';

/**
 * Code 39 (ISO/IEC 16388).
 *
 * Two element widths instead of Code 128's four, which makes it forgiving of
 * worn print heads and bad media — the reason it survives in industry long
 * after denser symbologies arrived. It pays for that in width: every character
 * costs 13 to 16 modules against Code 128's 11, and there is no digit packing.
 */

/** Nine elements per character, bar first; `true` marks a wide element. */
const PATTERNS: Readonly<Record<string, string>> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw',
  C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

/** Values for the modulo 43 check character, in the order the standard lists. */
const CHECK_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

export interface Code39Options {
  /** Append the modulo 43 check character. Off by default, as the standard has it optional. */
  readonly checkDigit?: boolean;
  /**
   * Width of a wide element in modules. The standard allows 2.0 to 3.0; only
   * whole numbers are useful here, because a module is a dot.
   */
  readonly wideRatio?: 2 | 3;
  /** Show the check character in the human-readable text. */
  readonly showCheckDigit?: boolean;
}

export function encodeCode39(data: string, options: Code39Options = {}): LinearSymbol {
  const wide = options.wideRatio ?? 3;
  if (wide !== 2 && wide !== 3) {
    throw new BarcodeError('Code 39 wide ratio must be 2 or 3');
  }
  if (data.length === 0) throw new BarcodeError('Code 39 needs at least one character');

  const payload = data.toUpperCase();
  for (const character of payload) {
    if (character === '*') {
      throw new BarcodeError('"*" is the Code 39 start and stop character and cannot appear in data');
    }
    if (PATTERNS[character] === undefined) {
      throw new BarcodeError(
        `Code 39 cannot encode "${character}". It covers 0-9, A-Z, space and - . $ / + % only.`,
      );
    }
  }

  let encoded = payload;
  if (options.checkDigit) {
    let sum = 0;
    for (const character of payload) sum += CHECK_ALPHABET.indexOf(character);
    encoded += CHECK_ALPHABET[sum % 43]!;
  }

  const modules: boolean[] = [];
  const characters = `*${encoded}*`;
  Array.from(characters).forEach((character, index) => {
    if (index > 0) modules.push(false); // Narrow gap between characters.
    const widths = Array.from(PATTERNS[character]!, (element) => (element === 'w' ? wide : 1));
    modules.push(...patternToModules(widths));
  });

  const text = options.checkDigit && options.showCheckDigit === false ? payload : encoded;
  return {
    symbology: 'code39',
    modules,
    // The standard asks for ten narrow elements of quiet zone.
    quietZone: { left: 10, right: 10 },
    text,
  };
}
