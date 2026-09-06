import type { MatrixSymbol } from '../matrix.js';
import { BarcodeError } from '../types.js';
import {
  CODEWORD_PATTERNS,
  MODULES_PER_CODEWORD,
  START_PATTERN,
  STOP_PATTERN,
} from './patterns.js';

/**
 * PDF417 (ISO/IEC 15438).
 *
 * A stack of linear rows rather than a matrix, which is why it reads on a
 * cheap laser scanner that could never see a QR Code, and why it is still the
 * symbology on shipping labels and driving licences. Each row carries its own
 * row number, dimensions and error-correction level, so a scanner can stitch a
 * symbol together from several passes across it.
 */

const FIELD = 929;
const TEXT_LATCH = 900;
const BYTE_LATCH = 901;
const NUMERIC_LATCH = 902;
const BYTE_LATCH_SIX = 924;
const PAD = TEXT_LATCH;

const MIN_ROWS = 3;
const MAX_ROWS = 90;
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 30;
const MAX_CODEWORDS = 928;

/** Row height as a multiple of module width, as the standard recommends. */
const ROW_HEIGHT = 3;

export type Pdf417ErrorCorrection = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface Pdf417Options {
  /** 0 to 8; each level doubles the correction codewords, from 2 to 512. */
  readonly errorCorrection?: Pdf417ErrorCorrection;
  /** Data columns, 1 to 30. Chosen for a readable shape when omitted. */
  readonly columns?: number;
  /** Rows, 3 to 90. Derived from the data and columns when omitted. */
  readonly rows?: number;
  /** Width to height ratio aimed for when choosing columns. */
  readonly aspectRatio?: number;
}

// Text compaction sub-modes. Each character is a value under thirty, and two
// values ride in one codeword.
const ALPHA = 0;
const LOWER = 1;
const MIXED = 2;
const PUNCT = 3;

const SUB_MODE_CHARS: readonly string[] = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
  'abcdefghijklmnopqrstuvwxyz ',
  '0123456789&\r\t,:#-.$/+%*=^',
  ';<>@[\\]_`~!\r\t,:\n-.$/"|*()?{}\'',
];

/** Position of each character within its sub-mode, or undefined. */
const SUB_MODE_INDEX: readonly Map<string, number>[] = SUB_MODE_CHARS.map((characters, mode) => {
  const map = new Map<string, number>();
  Array.from(characters).forEach((character, index) => {
    // Mixed mode's space sits at 26, past the punctuation latch at 25.
    const value = mode === MIXED && index >= 25 ? index + 1 : index;
    if (!map.has(character)) map.set(character, value);
  });
  if (mode === MIXED) map.set(' ', 26);
  return map;
});

function textValue(character: string, subMode: number): number | undefined {
  return SUB_MODE_INDEX[subMode]!.get(character);
}

function isTextCharacter(character: string): boolean {
  return [ALPHA, LOWER, MIXED, PUNCT].some((mode) => textValue(character, mode) !== undefined);
}

/**
 * Encodes a run of text, switching sub-modes as needed.
 *
 * Latches persist and shifts last one character, so a lone capital in a lower
 * case run costs one value rather than two latches. The values are packed two
 * to a codeword at the end.
 */
function encodeText(text: string, values: number[], startMode: number): number {
  let subMode = startMode;
  for (const character of text) {
    let value = textValue(character, subMode);
    if (value !== undefined) {
      values.push(value);
      continue;
    }

    // A single character from punctuation is cheaper shifted than latched, and
    // the shift is value 29 in all three other sub-modes.
    if (subMode !== PUNCT) {
      const punctuation = textValue(character, PUNCT);
      if (punctuation !== undefined) {
        values.push(29, punctuation);
        continue;
      }
    }
    if (subMode === LOWER) {
      const alpha = textValue(character, ALPHA);
      if (alpha !== undefined) {
        values.push(27, alpha); // shift to alpha
        continue;
      }
    }

    // Otherwise latch to whichever sub-mode holds the character.
    const target = [ALPHA, LOWER, MIXED, PUNCT].find(
      (mode) => textValue(character, mode) !== undefined,
    );
    if (target === undefined) {
      throw new BarcodeError(`PDF417 text compaction cannot hold "${character}"`);
    }
    values.push(...latchTo(subMode, target));
    subMode = target;
    value = textValue(character, subMode)!;
    values.push(value);
  }
  return subMode;
}

/**
 * The latch values that move from one sub-mode to another.
 *
 * Not every pair is one step. There is no latch from punctuation to anything
 * but alpha, and none from lower case to alpha at all — the way out of lower
 * case is through mixed. Assuming a direct latch exists produces a symbol that
 * decodes to the wrong characters rather than failing outright, which is why
 * the random-payload tests matter.
 */
function latchTo(from: number, to: number): number[] {
  if (from === to) return [];
  switch (from) {
    case ALPHA:
      if (to === LOWER) return [27];
      if (to === MIXED) return [28];
      return [28, 25]; // via mixed to punctuation
    case LOWER:
      if (to === MIXED) return [28];
      if (to === ALPHA) return [28, 28]; // via mixed
      return [28, 25]; // via mixed to punctuation
    case MIXED:
      if (to === ALPHA) return [28];
      if (to === LOWER) return [27];
      return [25];
    default: {
      // Punctuation latches only to alpha; everything else goes through it.
      if (to === ALPHA) return [29];
      if (to === LOWER) return [29, 27];
      return [29, 28];
    }
  }
}

function encodeNumeric(digits: string, codewords: number[]): void {
  for (let offset = 0; offset < digits.length; offset += 44) {
    const chunk = digits.slice(offset, offset + 44);
    // A leading one keeps any leading zeros of the chunk significant.
    let value = BigInt(`1${chunk}`);
    const group: number[] = [];
    while (value > 0n) {
      group.unshift(Number(value % 900n));
      value /= 900n;
    }
    codewords.push(...group);
  }
}

function encodeBytes(bytes: Uint8Array, codewords: number[]): void {
  codewords.push(bytes.length % 6 === 0 ? BYTE_LATCH_SIX : BYTE_LATCH);
  let offset = 0;
  for (; offset + 6 <= bytes.length; offset += 6) {
    let value = 0n;
    for (let i = 0; i < 6; i++) value = value * 256n + BigInt(bytes[offset + i]!);
    const group = new Array<number>(5);
    for (let i = 4; i >= 0; i--) {
      group[i] = Number(value % 900n);
      value /= 900n;
    }
    codewords.push(...group);
  }
  // A tail shorter than six bytes travels one byte per codeword.
  for (; offset < bytes.length; offset++) codewords.push(bytes[offset]!);
}

/** Digits available from `at`, which decides whether numeric mode pays. */
function digitRun(data: string, at: number): number {
  let length = 0;
  while (at + length < data.length && data[at + length]! >= '0' && data[at + length]! <= '9') {
    length++;
  }
  return length;
}

/**
 * Splits the payload into compaction modes.
 *
 * Numeric compaction packs about three digits per codeword against text's two
 * characters, but costs a latch, so it only pays from thirteen digits up — the
 * threshold the standard suggests. Anything text compaction cannot hold falls
 * to byte compaction, which takes any byte at all.
 */
function compact(data: string): number[] {
  const codewords: number[] = [];
  let mode: 'text' | 'byte' | 'numeric' | 'start' = 'start';
  let subMode = ALPHA;
  let textValues: number[] = [];

  const flushText = (): void => {
    if (textValues.length === 0) return;
    if (textValues.length % 2 === 1) textValues.push(29);
    for (let i = 0; i < textValues.length; i += 2) {
      codewords.push(textValues[i]! * 30 + textValues[i + 1]!);
    }
    textValues = [];
  };

  let at = 0;
  while (at < data.length) {
    const digits = digitRun(data, at);
    if (digits >= 13) {
      flushText();
      codewords.push(NUMERIC_LATCH);
      encodeNumeric(data.slice(at, at + digits), codewords);
      at += digits;
      mode = 'numeric';
      subMode = ALPHA;
      continue;
    }

    // Collect the longest run this mode can take.
    let end = at;
    const textable = isTextCharacter(data[at]!);
    while (end < data.length) {
      const character = data[end]!;
      if (isTextCharacter(character) !== textable) break;
      if (digitRun(data, end) >= 13) break;
      end++;
    }
    const run = data.slice(at, end);

    if (textable) {
      if (mode !== 'text' && mode !== 'start') {
        codewords.push(TEXT_LATCH);
        subMode = ALPHA;
      }
      subMode = encodeText(run, textValues, subMode);
      mode = 'text';
    } else {
      flushText();
      encodeBytes(new TextEncoder().encode(run), codewords);
      mode = 'byte';
      subMode = ALPHA;
    }
    at = end;
  }
  flushText();
  return codewords;
}

/** Error-correction codewords by level: two, four, eight and so on. */
function correctionCount(level: Pdf417ErrorCorrection): number {
  return 1 << (level + 1);
}

/**
 * The level the standard recommends for a payload of this size — enough
 * redundancy to survive handling without spending half the symbol on it.
 */
function recommendedLevel(dataCodewords: number): Pdf417ErrorCorrection {
  if (dataCodewords <= 40) return 2;
  if (dataCodewords <= 160) return 3;
  if (dataCodewords <= 320) return 4;
  return 5;
}

/** Generator polynomial coefficients over GF(929), roots 3^1 to 3^count. */
function generatorPolynomial(count: number): number[] {
  const coefficients = new Array<number>(count + 1).fill(0);
  coefficients[0] = 1;
  let root = 1;
  for (let i = 1; i <= count; i++) {
    root = (root * 3) % FIELD;
    for (let j = i; j > 0; j--) {
      coefficients[j] = (coefficients[j - 1]! + (FIELD - (coefficients[j]! * root) % FIELD)) % FIELD;
    }
    coefficients[0] = (FIELD - (coefficients[0]! * root) % FIELD) % FIELD;
  }
  return coefficients;
}

function errorCorrection(data: readonly number[], count: number): number[] {
  const factors = generatorPolynomial(count);
  const remainder = new Array<number>(count).fill(0);

  for (const codeword of data) {
    const t = (codeword + remainder[count - 1]!) % FIELD;
    for (let j = count - 1; j > 0; j--) {
      remainder[j] = (remainder[j - 1]! + FIELD - ((t * factors[j]!) % FIELD)) % FIELD;
    }
    remainder[0] = (FIELD - ((t * factors[0]!) % FIELD)) % FIELD;
  }
  return remainder.map((value) => (value === 0 ? 0 : FIELD - value)).reverse();
}

interface Shape {
  readonly rows: number;
  readonly columns: number;
}

function chooseShape(total: number, options: Pdf417Options): Shape {
  if (options.columns !== undefined) {
    const columns = options.columns;
    if (!Number.isInteger(columns) || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
      throw new BarcodeError(`PDF417 columns must be a whole number from 1 to 30, got ${columns}`);
    }
    const rows = options.rows ?? Math.max(MIN_ROWS, Math.ceil(total / columns));
    if (rows < MIN_ROWS || rows > MAX_ROWS || rows * columns < total) {
      throw new BarcodeError(
        `A ${rows} by ${columns} PDF417 holds ${rows * columns} codewords, but this ` +
          `payload needs ${total}`,
      );
    }
    return { rows, columns };
  }

  const target = options.aspectRatio ?? 2;
  let best: Shape | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns++) {
    const rows = Math.max(MIN_ROWS, Math.ceil(total / columns));
    if (rows > MAX_ROWS) continue;
    if (options.rows !== undefined && rows > options.rows) continue;
    const chosenRows = options.rows ?? rows;
    if (chosenRows * columns < total) continue;
    const width = MODULES_PER_CODEWORD * columns + 69;
    const distance = Math.abs(width / (chosenRows * ROW_HEIGHT) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { rows: chosenRows, columns };
    }
  }
  if (!best) {
    throw new BarcodeError(
      `This payload needs ${total} codewords, more than a PDF417 symbol can hold`,
    );
  }
  return best;
}

/**
 * Row indicator codewords.
 *
 * Each row states the row number, and one of three facts about the symbol —
 * total rows, total columns, error-correction level — rotating by cluster. A
 * scanner that catches three consecutive rows knows the whole shape, which is
 * what lets it read a symbol swiped at an angle.
 */
function rowIndicators(
  row: number,
  rows: number,
  columns: number,
  level: Pdf417ErrorCorrection,
): { left: number; right: number } {
  const group = 30 * Math.floor(row / 3);
  const cluster = row % 3;
  const totalRows = Math.floor((rows - 1) / 3);
  const levelPart = level * 3 + ((rows - 1) % 3);
  const totalColumns = columns - 1;

  switch (cluster) {
    case 0:
      return { left: group + totalRows, right: group + totalColumns };
    case 1:
      return { left: group + levelPart, right: group + totalRows };
    default:
      return { left: group + totalColumns, right: group + levelPart };
  }
}

function appendPattern(modules: boolean[], pattern: number, width: number): void {
  for (let bit = width - 1; bit >= 0; bit--) modules.push(((pattern >> bit) & 1) === 1);
}

export function encodePdf417(data: string, options: Pdf417Options = {}): MatrixSymbol {
  if (data.length === 0) throw new BarcodeError('PDF417 needs at least one character');

  const payload = compact(data);
  const level = options.errorCorrection ?? recommendedLevel(payload.length + 1);
  if (!Number.isInteger(level) || level < 0 || level > 8) {
    throw new BarcodeError(`PDF417 error correction level must be 0 to 8, got ${level}`);
  }
  const correction = correctionCount(level);

  const total = payload.length + 1 + correction;
  if (total > MAX_CODEWORDS) {
    throw new BarcodeError(
      `This payload needs ${total} codewords at level ${level}, more than the 928 a ` +
        'PDF417 symbol can hold',
    );
  }

  const shape = chooseShape(total, options);
  const capacity = shape.rows * shape.columns;
  const dataLength = capacity - correction;

  // The first codeword counts everything but the error correction, so padding
  // is part of the count.
  const codewords = [dataLength, ...payload];
  while (codewords.length < dataLength) codewords.push(PAD);
  codewords.push(...errorCorrection(codewords, correction));

  const width = MODULES_PER_CODEWORD * shape.columns + 69;
  const modules: boolean[] = [];

  for (let row = 0; row < shape.rows; row++) {
    const cluster = row % 3;
    const patterns = CODEWORD_PATTERNS[cluster]!;
    const indicators = rowIndicators(row, shape.rows, shape.columns, level);

    const rowModules: boolean[] = [];
    appendPattern(rowModules, START_PATTERN, MODULES_PER_CODEWORD);
    appendPattern(rowModules, patterns[indicators.left]!, MODULES_PER_CODEWORD);
    for (let column = 0; column < shape.columns; column++) {
      const codeword = codewords[row * shape.columns + column]!;
      appendPattern(rowModules, patterns[codeword]!, MODULES_PER_CODEWORD);
    }
    appendPattern(rowModules, patterns[indicators.right]!, MODULES_PER_CODEWORD);
    appendPattern(rowModules, STOP_PATTERN, 18);

    if (rowModules.length !== width) {
      throw new Error(`row ${row} came out ${rowModules.length} modules, expected ${width}`);
    }
    modules.push(...rowModules);
  }

  return {
    symbology: 'pdf417',
    width,
    height: shape.rows,
    modules,
    quietZone: 2,
    moduleAspect: ROW_HEIGHT,
    text: data,
  };
}
