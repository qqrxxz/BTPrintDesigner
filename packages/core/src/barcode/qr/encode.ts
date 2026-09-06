import { QR_FIELD, reedSolomonRemainder } from '../galois.js';
import type { MatrixSymbol } from '../matrix.js';
import { BarcodeError } from '../types.js';
import {
  alignmentPatternPositions,
  blockLayout,
  dataCodewords,
  MAX_VERSION,
  MIN_VERSION,
  moduleCount,
  totalCodewords,
  type ErrorCorrectionLevel,
} from './tables.js';

/**
 * QR Code (ISO/IEC 18004).
 *
 * The encoder picks one mode for the whole payload rather than splitting it
 * into mixed-mode segments. Segment optimisation can shave a few percent off
 * dense payloads, but on a label the payload is usually a URL, a GTIN or a
 * serial — uniform by nature — and a single mode is far easier to reason about
 * when a symbol misbehaves in the field.
 */

export type QrMode = 'numeric' | 'alphanumeric' | 'byte';

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const MODE_INDICATOR: Record<QrMode, number> = {
  numeric: 0b0001,
  alphanumeric: 0b0010,
  byte: 0b0100,
};

/** Bits in the character count field, by mode and version group. */
const COUNT_BITS: Record<QrMode, readonly [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

const EC_FORMAT_BITS: Record<ErrorCorrectionLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

function countBits(mode: QrMode, version: number): number {
  const group = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  return COUNT_BITS[mode][group];
}

class BitBuffer {
  readonly bits: number[] = [];

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }
}

function chooseMode(data: string): QrMode {
  if (/^[0-9]*$/.test(data)) return 'numeric';
  if (Array.from(data).every((character) => ALPHANUMERIC.includes(character))) {
    return 'alphanumeric';
  }
  return 'byte';
}

function utf8Bytes(data: string): Uint8Array {
  return new TextEncoder().encode(data);
}

/** Payload length in bits, excluding the mode indicator and count field. */
function payloadBits(mode: QrMode, data: string, bytes: Uint8Array): number {
  switch (mode) {
    case 'numeric': {
      const groups = Math.floor(data.length / 3);
      const remainder = data.length % 3;
      return groups * 10 + (remainder === 0 ? 0 : remainder === 1 ? 4 : 7);
    }
    case 'alphanumeric':
      return Math.floor(data.length / 2) * 11 + (data.length % 2) * 6;
    case 'byte':
      return bytes.length * 8;
  }
}

function writePayload(buffer: BitBuffer, mode: QrMode, data: string, bytes: Uint8Array): void {
  switch (mode) {
    case 'numeric': {
      let i = 0;
      for (; i + 3 <= data.length; i += 3) buffer.append(Number(data.slice(i, i + 3)), 10);
      const remaining = data.length - i;
      if (remaining === 2) buffer.append(Number(data.slice(i)), 7);
      else if (remaining === 1) buffer.append(Number(data.slice(i)), 4);
      return;
    }
    case 'alphanumeric': {
      let i = 0;
      for (; i + 2 <= data.length; i += 2) {
        const high = ALPHANUMERIC.indexOf(data[i]!);
        const low = ALPHANUMERIC.indexOf(data[i + 1]!);
        buffer.append(high * 45 + low, 11);
      }
      if (i < data.length) buffer.append(ALPHANUMERIC.indexOf(data[i]!), 6);
      return;
    }
    case 'byte':
      for (const byte of bytes) buffer.append(byte, 8);
  }
}

export interface QrOptions {
  readonly errorCorrection?: ErrorCorrectionLevel;
  /** Force a version. Without it, the smallest version that fits is used. */
  readonly version?: number;
  /** Force a mask, 0 to 7. Without it, the lowest-penalty mask is chosen. */
  readonly mask?: number;
  /**
   * Extended Channel Interpretation.
   *
   * 'auto' declares ECI 26 (UTF-8) as soon as the payload leaves ASCII, which
   * is what the standard asks for and what makes a Cyrillic payload decode the
   * same way everywhere. Set false for scanners that predate ECI.
   */
  readonly eci?: 'auto' | number | false;
}

interface Encoded {
  readonly version: number;
  readonly level: ErrorCorrectionLevel;
  readonly codewords: Uint8Array;
}

function needsEci(data: string, option: QrOptions['eci']): number | undefined {
  if (option === false) return undefined;
  if (typeof option === 'number') return option;
  return /^[\x00-\x7f]*$/.test(data) ? undefined : 26;
}

function encodeData(data: string, options: QrOptions): Encoded {
  const level = options.errorCorrection ?? 'M';
  const mode = chooseMode(data);
  const bytes = mode === 'byte' ? utf8Bytes(data) : new Uint8Array(0);
  const eci = mode === 'byte' ? needsEci(data, options.eci) : undefined;
  const characterCount = mode === 'byte' ? bytes.length : data.length;

  const eciBits = eci === undefined ? 0 : eci < 128 ? 12 : eci < 16384 ? 20 : 28;
  const bodyBits = payloadBits(mode, data, bytes);

  const fits = (version: number): boolean =>
    4 + countBits(mode, version) + bodyBits + eciBits <= dataCodewords(version, level) * 8;

  let version = options.version;
  if (version === undefined) {
    version = MIN_VERSION;
    while (version <= MAX_VERSION && !fits(version)) version++;
    if (version > MAX_VERSION) {
      throw new BarcodeError(
        `This payload does not fit in a QR Code at error correction level ${level}: ` +
          `${characterCount} characters need more than version 40 allows.`,
      );
    }
  } else {
    if (version < MIN_VERSION || version > MAX_VERSION || !Number.isInteger(version)) {
      throw new BarcodeError(`QR version must be a whole number from 1 to 40, got ${version}`);
    }
    if (!fits(version)) {
      throw new BarcodeError(
        `This payload does not fit in QR version ${version} at level ${level}`,
      );
    }
  }

  const capacityBits = dataCodewords(version, level) * 8;
  const buffer = new BitBuffer();
  if (eci !== undefined) {
    buffer.append(0b0111, 4);
    if (eci < 128) buffer.append(eci, 8);
    else if (eci < 16384) buffer.append(0b10_00000000000000 | eci, 16);
    else buffer.append(0b110_00000000000000000000 | eci, 24);
  }
  buffer.append(MODE_INDICATOR[mode], 4);
  buffer.append(characterCount, countBits(mode, version));
  writePayload(buffer, mode, data, bytes);

  // Terminator, then pad to a whole codeword, then the standard pad pattern.
  buffer.append(0, Math.min(4, capacityBits - buffer.length));
  buffer.append(0, (8 - (buffer.length % 8)) % 8);
  for (let pad = 0xec; buffer.length < capacityBits; pad ^= 0xec ^ 0x11) buffer.append(pad, 8);

  const dataWords = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < dataWords.length; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | buffer.bits[i * 8 + bit]!;
    dataWords[i] = byte;
  }

  return { version, level, codewords: interleave(dataWords, version, level) };
}

/**
 * Splits data into blocks, appends each block's error correction, and
 * interleaves the result.
 *
 * Interleaving is what makes a QR Code survive a smudge: consecutive codewords
 * on the symbol belong to different blocks, so damage in one place is spread
 * thinly across every block's correction budget instead of destroying one.
 */
function interleave(
  data: Uint8Array,
  version: number,
  level: ErrorCorrectionLevel,
): Uint8Array {
  const layout = blockLayout(version, level);
  const blocks: { data: Uint8Array; ecc: Uint8Array }[] = [];

  let offset = 0;
  const totalBlocks = layout.shortBlocks + layout.longBlocks;
  for (let index = 0; index < totalBlocks; index++) {
    const length =
      index < layout.shortBlocks ? layout.shortBlockDataLength : layout.longBlockDataLength;
    const blockData = data.subarray(offset, offset + length);
    offset += length;
    blocks.push({
      data: blockData,
      ecc: reedSolomonRemainder(QR_FIELD, blockData, layout.eccLength),
    });
  }

  const result = new Uint8Array(totalCodewords(version));
  let at = 0;
  for (let i = 0; i < layout.longBlockDataLength; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result[at++] = block.data[i]!;
    }
  }
  for (let i = 0; i < layout.eccLength; i++) {
    for (const block of blocks) result[at++] = block.ecc[i]!;
  }
  return result;
}

type Grid = Uint8Array;

const DARK = 1;
const LIGHT = 0;

class MatrixBuilder {
  readonly size: number;
  readonly modules: Grid;
  readonly isFunction: Uint8Array;

  constructor(readonly version: number) {
    this.size = moduleCount(version);
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }

  private index(x: number, y: number): number {
    return y * this.size + x;
  }

  get(x: number, y: number): number {
    return this.modules[this.index(x, y)]!;
  }

  set(x: number, y: number, value: number): void {
    this.modules[this.index(x, y)] = value;
  }

  setFunction(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.set(x, y, value);
    this.isFunction[this.index(x, y)] = 1;
  }

  functionAt(x: number, y: number): boolean {
    return this.isFunction[this.index(x, y)] === 1;
  }
}

function drawFinderPattern(builder: MatrixBuilder, centreX: number, centreY: number): void {
  // Includes the separator ring, which is why the loop reaches four modules out.
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      builder.setFunction(centreX + dx, centreY + dy, distance !== 2 && distance !== 4 ? DARK : LIGHT);
    }
  }
}

function drawAlignmentPattern(builder: MatrixBuilder, centreX: number, centreY: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      builder.setFunction(
        centreX + dx,
        centreY + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? DARK : LIGHT,
      );
    }
  }
}

/** Fifteen bits of BCH-protected format information, in both of its copies. */
function drawFormatInfo(builder: MatrixBuilder, level: ErrorCorrectionLevel, mask: number): void {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (index: number): number => (bits >> index) & 1;

  for (let i = 0; i <= 5; i++) builder.setFunction(8, i, bit(i));
  builder.setFunction(8, 7, bit(6));
  builder.setFunction(8, 8, bit(7));
  builder.setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) builder.setFunction(14 - i, 8, bit(i));

  const size = builder.size;
  for (let i = 0; i < 8; i++) builder.setFunction(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) builder.setFunction(8, size - 15 + i, bit(i));
  builder.setFunction(8, size - 8, DARK); // The one module that is always dark.
}

function drawVersionInfo(builder: MatrixBuilder): void {
  if (builder.version < 7) return;
  let remainder = builder.version;
  for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1f25);
  const bits = (builder.version << 12) | remainder;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const a = builder.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    builder.setFunction(a, b, bit);
    builder.setFunction(b, a, bit);
  }
}

function drawFunctionPatterns(builder: MatrixBuilder, level: ErrorCorrectionLevel): void {
  const size = builder.size;

  for (let i = 0; i < size; i++) {
    const value = i % 2 === 0 ? DARK : LIGHT;
    builder.setFunction(6, i, value);
    builder.setFunction(i, 6, value);
  }

  drawFinderPattern(builder, 3, 3);
  drawFinderPattern(builder, size - 4, 3);
  drawFinderPattern(builder, 3, size - 4);

  const positions = alignmentPatternPositions(builder.version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      // The three corners belong to the finder patterns.
      const isCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!isCorner) drawAlignmentPattern(builder, positions[i]!, positions[j]!);
    }
  }

  // Drawn with mask 0 for now; the chosen mask overwrites it later.
  drawFormatInfo(builder, level, 0);
  drawVersionInfo(builder);
}

/**
 * Lays the codewords into the symbol.
 *
 * The path runs in two-module-wide columns from the bottom right, alternating
 * upward and downward, skipping the vertical timing column. Function modules
 * are stepped over rather than written.
 */
function drawCodewords(builder: MatrixBuilder, codewords: Uint8Array): void {
  const size = builder.size;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    const column = right <= 6 ? right - 1 : right;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let offset = 0; offset < 2; offset++) {
        const x = column - offset;
        const upward = ((column + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (builder.functionAt(x, y)) continue;
        if (bitIndex >= codewords.length * 8) continue;
        const bit = (codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1;
        builder.set(x, y, bit);
        bitIndex++;
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(builder: MatrixBuilder, mask: number): void {
  const test = MASKS[mask]!;
  for (let y = 0; y < builder.size; y++) {
    for (let x = 0; x < builder.size; x++) {
      if (builder.functionAt(x, y)) continue;
      if (test(x, y)) builder.set(x, y, builder.get(x, y) ^ 1);
    }
  }
}

/**
 * The four penalty rules from the standard, used to pick a mask.
 *
 * Any mask produces a decodable symbol; the score only chooses the one least
 * likely to confuse a scanner with runs, blocks or finder-like sequences. The
 * third rule is the one implementations read differently — this follows the
 * common reading, where the 1:1:3:1:1 core counts if the four modules on
 * *either* side are light, with the symbol edge treated as light.
 */
function penaltyScore(builder: MatrixBuilder): number {
  const size = builder.size;
  let score = 0;

  const scanLine = (read: (i: number) => number): void => {
    let runColour = read(0);
    let runLength = 1;
    for (let i = 1; i < size; i++) {
      const value = read(i);
      if (value === runColour) {
        runLength++;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColour = value;
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
  };

  for (let y = 0; y < size; y++) scanLine((x) => builder.get(x, y));
  for (let x = 0; x < size; x++) scanLine((y) => builder.get(x, y));

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const value = builder.get(x, y);
      if (
        value === builder.get(x + 1, y) &&
        value === builder.get(x, y + 1) &&
        value === builder.get(x + 1, y + 1)
      ) {
        score += 3;
      }
    }
  }

  const core = [1, 0, 1, 1, 1, 0, 1];
  const allLight = (read: (i: number) => number, from: number, to: number): boolean => {
    for (let i = Math.max(from, 0); i < Math.min(to, size); i++) {
      if (read(i) === 1) return false;
    }
    return true;
  };
  const hasCore = (read: (i: number) => number, at: number): boolean =>
    core.every((bit, offset) => read(at + offset) === bit);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = (i: number): number => builder.get(i, y);
      const column = (i: number): number => builder.get(x, i);
      if (
        x + 6 < size &&
        hasCore(row, x) &&
        (allLight(row, x - 4, x) || allLight(row, x + 7, x + 11))
      ) {
        score += 40;
      }
      if (
        y + 6 < size &&
        hasCore(column, y) &&
        (allLight(column, y - 4, y) || allLight(column, y + 7, y + 11))
      ) {
        score += 40;
      }
    }
  }

  let dark = 0;
  for (const module of builder.modules) dark += module;
  const total = size * size;
  // Rule four: ten points for every five percent the dark share strays from
  // half. |2d - t| / t is that deviation as a fraction, so multiplying by ten
  // and truncating counts the whole five-percent steps.
  const fivePercentSteps = Math.floor((Math.abs(dark * 2 - total) * 10) / total);
  score += fivePercentSteps * 10;

  return score;
}

export function encodeQr(data: string, options: QrOptions = {}): MatrixSymbol {
  if (data.length === 0) throw new BarcodeError('QR Code needs at least one character');

  const { version, level, codewords } = encodeData(data, options);
  const builder = new MatrixBuilder(version);
  drawFunctionPatterns(builder, level);
  drawCodewords(builder, codewords);

  let chosenMask = options.mask;
  if (chosenMask === undefined) {
    let bestScore = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(builder, mask);
      drawFormatInfo(builder, level, mask);
      const score = penaltyScore(builder);
      if (score < bestScore) {
        bestScore = score;
        chosenMask = mask;
      }
      applyMask(builder, mask); // Masking is its own inverse.
    }
  } else if (!Number.isInteger(chosenMask) || chosenMask < 0 || chosenMask > 7) {
    throw new BarcodeError(`QR mask must be a whole number from 0 to 7, got ${chosenMask}`);
  }

  applyMask(builder, chosenMask!);
  drawFormatInfo(builder, level, chosenMask!);

  return {
    symbology: 'qr',
    width: builder.size,
    height: builder.size,
    modules: Array.from(builder.modules, (module) => module === 1),
    quietZone: 4,
    moduleAspect: 1,
    text: data,
  };
}
