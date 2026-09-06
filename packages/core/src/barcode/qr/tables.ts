/**
 * Version-dependent constants for QR Code (ISO/IEC 18004).
 *
 * Only the two tables that genuinely cannot be derived are written out: the
 * error-correction codewords per block and the number of blocks. Everything
 * else — total codeword capacity, alignment pattern positions, block sizes —
 * follows from those by the rules in the standard, and deriving it is safer
 * than transcribing another 160 numbers by hand.
 *
 * Both tables are cross-checked against ZXing's own version table in the tests.
 */

export type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export const EC_LEVELS: readonly ErrorCorrectionLevel[] = ['L', 'M', 'Q', 'H'];

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/** Error-correction codewords per block, indexed by level then version. */
const ECC_PER_BLOCK: Record<ErrorCorrectionLevel, readonly number[]> = {
  L: [
    0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
    28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  M: [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
    26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  Q: [
    0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30,
    28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  H: [
    0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28,
    30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
};

/** Number of error-correction blocks, indexed by level then version. */
const BLOCK_COUNT: Record<ErrorCorrectionLevel, readonly number[]> = {
  L: [
    0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
    8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  M: [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  Q: [
    0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20,
    23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  H: [
    0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25,
    25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
};

export function eccPerBlock(version: number, level: ErrorCorrectionLevel): number {
  return ECC_PER_BLOCK[level][version]!;
}

export function blockCount(version: number, level: ErrorCorrectionLevel): number {
  return BLOCK_COUNT[level][version]!;
}

export function moduleCount(version: number): number {
  return version * 4 + 17;
}

/**
 * Modules available for data and error correction, before the format, version
 * and function patterns are subtracted out.
 */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    modules -= (25 * alignCount - 10) * alignCount - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

/** Total codewords in the symbol, data plus error correction. */
export function totalCodewords(version: number): number {
  return rawDataModules(version) >>> 3;
}

/** Codewords left for data once error correction has taken its share. */
export function dataCodewords(version: number, level: ErrorCorrectionLevel): number {
  return totalCodewords(version) - eccPerBlock(version, level) * blockCount(version, level);
}

export interface BlockLayout {
  /** Blocks in the first group, each one codeword shorter than the second. */
  readonly shortBlocks: number;
  readonly shortBlockDataLength: number;
  readonly longBlocks: number;
  readonly longBlockDataLength: number;
  readonly eccLength: number;
}

/**
 * How data codewords divide into blocks.
 *
 * The standard never splits data unevenly by more than one codeword, so the
 * layout falls out of the division: the remainder tells you how many blocks
 * carry the extra codeword.
 */
export function blockLayout(version: number, level: ErrorCorrectionLevel): BlockLayout {
  const blocks = blockCount(version, level);
  const data = dataCodewords(version, level);
  const shortLength = Math.floor(data / blocks);
  const longBlocks = data % blocks;
  return {
    shortBlocks: blocks - longBlocks,
    shortBlockDataLength: shortLength,
    longBlocks,
    longBlockDataLength: shortLength + 1,
    eccLength: eccPerBlock(version, level),
  };
}

/**
 * Centres of the alignment patterns.
 *
 * The standard prints these as a table, but they follow a rule: the first is
 * always at 6, the last is always seven modules from the far edge, and the rest
 * are spaced as evenly as an even number allows. Version 32 is the one case the
 * rule does not fit, and the standard simply fixes its spacing at 26.
 */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step =
    version === 32
      ? 26
      : Math.floor((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2;
  const size = moduleCount(version);
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}
