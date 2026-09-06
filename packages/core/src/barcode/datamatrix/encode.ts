import { DATA_MATRIX_FIELD, reedSolomonRemainder } from '../galois.js';
import type { MatrixSymbol } from '../matrix.js';
import { BarcodeError } from '../types.js';
import {
  candidateSizes,
  mappingSize,
  regionsHorizontal,
  regionsVertical,
  type SymbolShape,
  type SymbolSize,
} from './tables.js';

/**
 * Data Matrix ECC 200 (ISO/IEC 16022).
 *
 * Data is encoded in ASCII mode, with the standard's two compactions that cost
 * nothing to support: a pair of digits packs into one codeword, and a byte
 * above 127 travels behind an upper shift. The denser C40, Text, X12 and
 * EDIFACT modes are not implemented — they buy roughly a third on long
 * alphabetic payloads, which is not what a label carries, and each is another
 * mode-switching state machine that can go subtly wrong in the field.
 */

const ASCII_ECI = 241;
const ASCII_PAD = 129;
const ASCII_DIGIT_PAIR_BASE = 130;
const ASCII_UPPER_SHIFT = 235;
/** Roots of the generator polynomial start at alpha^1 for Data Matrix. */
const GENERATOR_BASE = 1;

export interface DataMatrixOptions {
  /** Square by default; rectangles suit a wide, shallow space on a label. */
  readonly shape?: SymbolShape;
  /** Force a symbol size by its module dimensions, e.g. 16 by 48. */
  readonly rows?: number;
  readonly columns?: number;
  /**
   * Extended Channel Interpretation.
   *
   * 'auto' declares ECI 26 (UTF-8) as soon as the payload leaves ASCII.
   * Without it a decoder is entitled to read the bytes as Latin-1 — and ZXing
   * does — turning Cyrillic into mojibake. Set false for scanners that predate
   * ECI.
   */
  readonly eci?: 'auto' | number | false;
}

/**
 * Encodes the payload as ASCII-mode codewords.
 *
 * The payload is treated as UTF-8 bytes, so anything outside ASCII costs two
 * codewords per byte. That is the honest price of not implementing Base 256;
 * the symbol still decodes correctly everywhere.
 */
function encodeAscii(data: string, eci: number | undefined): number[] {
  const bytes = new TextEncoder().encode(data);
  const codewords: number[] = [];

  if (eci !== undefined) {
    codewords.push(ASCII_ECI);
    if (eci <= 126) {
      codewords.push(eci + 1);
    } else {
      throw new BarcodeError(`Data Matrix ECI values above 126 are not supported, got ${eci}`);
    }
  }

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    const next = bytes[i + 1];
    const isDigit = byte >= 0x30 && byte <= 0x39;
    const nextIsDigit = next !== undefined && next >= 0x30 && next <= 0x39;

    if (isDigit && nextIsDigit) {
      codewords.push((byte - 0x30) * 10 + (next - 0x30) + ASCII_DIGIT_PAIR_BASE);
      i++;
    } else if (byte < 128) {
      codewords.push(byte + 1);
    } else {
      codewords.push(ASCII_UPPER_SHIFT);
      codewords.push(byte - 128 + 1);
    }
  }
  return codewords;
}

/**
 * Pads out to the symbol's capacity.
 *
 * The first pad is a plain 129; the rest are scrambled by the standard's 253
 * state algorithm so a run of padding does not print as a repeating texture
 * that a scanner could mistake for structure.
 */
function pad(codewords: number[], capacity: number): number[] {
  const padded = [...codewords];
  if (padded.length < capacity) padded.push(ASCII_PAD);
  while (padded.length < capacity) {
    const position = padded.length + 1;
    const pseudoRandom = ((149 * position) % 253) + 1;
    const value = ASCII_PAD + pseudoRandom;
    padded.push(value <= 254 ? value : value - 254);
  }
  return padded;
}

function resolveEci(data: string, option: DataMatrixOptions['eci']): number | undefined {
  if (option === false) return undefined;
  if (typeof option === 'number') return option;
  return /^[\x00-\x7f]*$/.test(data) ? undefined : 26;
}

function chooseSize(options: DataMatrixOptions, needed: number): SymbolSize {
  if (options.rows !== undefined || options.columns !== undefined) {
    const match = candidateSizes('any').find(
      (size) =>
        (options.rows === undefined || size.rows === options.rows) &&
        (options.columns === undefined || size.columns === options.columns),
    );
    if (!match) {
      throw new BarcodeError(
        `${options.rows ?? '?'} by ${options.columns ?? '?'} is not a Data Matrix symbol size`,
      );
    }
    if (match.dataCodewords < needed) {
      throw new BarcodeError(
        `This payload needs ${needed} codewords, but a ${match.rows} by ${match.columns} ` +
          `symbol holds ${match.dataCodewords}`,
      );
    }
    return match;
  }

  const shape = options.shape ?? 'square';
  const match = candidateSizes(shape).find((size) => size.dataCodewords >= needed);
  if (!match) {
    throw new BarcodeError(
      `This payload needs ${needed} codewords, more than the largest Data Matrix symbol holds`,
    );
  }
  return match;
}

/**
 * Appends error correction, interleaving blocks where the symbol calls for it.
 *
 * Data codewords keep their order; only the correction codewords are woven
 * together. Block membership is every n-th codeword, which is what spreads a
 * local smudge across several blocks' budgets.
 */
function addErrorCorrection(data: number[], symbol: SymbolSize): number[] {
  const stream = [...data];
  if (symbol.blocks === 1) {
    const ecc = reedSolomonRemainder(
      DATA_MATRIX_FIELD,
      Uint8Array.from(data),
      symbol.errorCodewords,
      GENERATOR_BASE,
    );
    stream.push(...ecc);
    return stream;
  }

  const eccPerBlock = symbol.errorCodewords / symbol.blocks;
  const interleaved = new Array<number>(symbol.errorCodewords);
  for (let block = 0; block < symbol.blocks; block++) {
    const blockData: number[] = [];
    for (let i = block; i < data.length; i += symbol.blocks) blockData.push(data[i]!);
    const ecc = reedSolomonRemainder(
      DATA_MATRIX_FIELD,
      Uint8Array.from(blockData),
      eccPerBlock,
      GENERATOR_BASE,
    );
    for (let i = 0; i < eccPerBlock; i++) interleaved[i * symbol.blocks + block] = ecc[i]!;
  }
  stream.push(...interleaved);
  return stream;
}

/** Marks the two modules of the fixed corner pattern some symbols need. */
export const ALWAYS_DARK = -2;
export const UNSET = -1;

/**
 * The ECC 200 placement algorithm from the standard's Annex F.
 *
 * Codewords are laid out as an L-shaped "utah" of eight modules that walks the
 * data area diagonally and wraps around the edges, with four special cases for
 * the corners where the walk does not fit. It looks arbitrary; the point is
 * that consecutive bits of one codeword end up spread over two rows, so a
 * scratch along a row damages several codewords lightly rather than one badly.
 *
 * Each entry is the codeword index times eight plus the bit position, so the
 * caller can fill in the modules once the codewords are known.
 */
export function computePlacement(rows: number, columns: number): Int32Array {
  const array = new Int32Array(rows * columns).fill(UNSET);

  const put = (row: number, column: number, codeword: number, bit: number): void => {
    let r = row;
    let c = column;
    if (r < 0) {
      r += rows;
      c += 4 - ((rows + 4) % 8);
    }
    if (c < 0) {
      c += columns;
      r += 4 - ((columns + 4) % 8);
    }
    array[r * columns + c] = codeword * 8 + bit;
  };

  const utah = (row: number, column: number, codeword: number): void => {
    put(row - 2, column - 2, codeword, 7);
    put(row - 2, column - 1, codeword, 6);
    put(row - 1, column - 2, codeword, 5);
    put(row - 1, column - 1, codeword, 4);
    put(row - 1, column, codeword, 3);
    put(row, column - 2, codeword, 2);
    put(row, column - 1, codeword, 1);
    put(row, column, codeword, 0);
  };

  const cornerA = (codeword: number): void => {
    put(rows - 1, 0, codeword, 7);
    put(rows - 1, 1, codeword, 6);
    put(rows - 1, 2, codeword, 5);
    put(0, columns - 2, codeword, 4);
    put(0, columns - 1, codeword, 3);
    put(1, columns - 1, codeword, 2);
    put(2, columns - 1, codeword, 1);
    put(3, columns - 1, codeword, 0);
  };

  const cornerB = (codeword: number): void => {
    put(rows - 3, 0, codeword, 7);
    put(rows - 2, 0, codeword, 6);
    put(rows - 1, 0, codeword, 5);
    put(0, columns - 4, codeword, 4);
    put(0, columns - 3, codeword, 3);
    put(0, columns - 2, codeword, 2);
    put(0, columns - 1, codeword, 1);
    put(1, columns - 1, codeword, 0);
  };

  const cornerC = (codeword: number): void => {
    put(rows - 3, 0, codeword, 7);
    put(rows - 2, 0, codeword, 6);
    put(rows - 1, 0, codeword, 5);
    put(0, columns - 2, codeword, 4);
    put(0, columns - 1, codeword, 3);
    put(1, columns - 1, codeword, 2);
    put(2, columns - 1, codeword, 1);
    put(3, columns - 1, codeword, 0);
  };

  const cornerD = (codeword: number): void => {
    put(rows - 1, 0, codeword, 7);
    put(rows - 1, columns - 1, codeword, 6);
    put(0, columns - 3, codeword, 5);
    put(0, columns - 2, codeword, 4);
    put(0, columns - 1, codeword, 3);
    put(1, columns - 3, codeword, 2);
    put(1, columns - 2, codeword, 1);
    put(1, columns - 1, codeword, 0);
  };

  let codeword = 0;
  let row = 4;
  let column = 0;

  do {
    if (row === rows && column === 0) cornerA(codeword++);
    if (row === rows - 2 && column === 0 && columns % 4 !== 0) cornerB(codeword++);
    if (row === rows - 2 && column === 0 && columns % 8 === 4) cornerC(codeword++);
    if (row === rows + 4 && column === 2 && columns % 8 === 0) cornerD(codeword++);

    do {
      if (row < rows && column >= 0 && array[row * columns + column] === UNSET) {
        utah(row, column, codeword++);
      }
      row -= 2;
      column += 2;
    } while (row >= 0 && column < columns);
    row += 1;
    column += 3;

    do {
      if (row >= 0 && column < columns && array[row * columns + column] === UNSET) {
        utah(row, column, codeword++);
      }
      row += 2;
      column -= 2;
    } while (row < rows && column >= 0);
    row += 3;
    column += 1;
  } while (row < rows || column < columns);

  // Symbols whose walk leaves the far corner empty get a fixed two-module mark.
  if (array[rows * columns - 1] === UNSET) {
    array[rows * columns - 1] = ALWAYS_DARK;
    array[(rows - 1) * columns - 2] = ALWAYS_DARK;
  }
  return array;
}

export function encodeDataMatrix(data: string, options: DataMatrixOptions = {}): MatrixSymbol {
  if (data.length === 0) throw new BarcodeError('Data Matrix needs at least one character');

  const eci = resolveEci(data, options.eci);
  const encoded = encodeAscii(data, eci);
  const symbol = chooseSize(options, encoded.length);
  const codewords = addErrorCorrection(pad(encoded, symbol.dataCodewords), symbol);

  const mapping = mappingSize(symbol);
  const placement = computePlacement(mapping.rows, mapping.columns);
  const modules = new Array<boolean>(symbol.rows * symbol.columns).fill(false);

  const regionsAcross = regionsHorizontal(symbol);
  const regionsDown = regionsVertical(symbol);

  // Finder and clock borders: each region has a solid L on its left and bottom
  // and an alternating track along its top and right.
  for (let regionRow = 0; regionRow < regionsDown; regionRow++) {
    for (let regionColumn = 0; regionColumn < regionsAcross; regionColumn++) {
      const top = regionRow * (symbol.regionRows + 2);
      const left = regionColumn * (symbol.regionColumns + 2);
      const bottom = top + symbol.regionRows + 1;
      const right = left + symbol.regionColumns + 1;

      for (let r = top; r <= bottom; r++) {
        modules[r * symbol.columns + left] = true;
        modules[r * symbol.columns + right] = (r - top) % 2 === 1;
      }
      for (let c = left; c <= right; c++) {
        modules[bottom * symbol.columns + c] = true;
        modules[top * symbol.columns + c] = (c - left) % 2 === 0;
      }
    }
  }

  for (let mappingRow = 0; mappingRow < mapping.rows; mappingRow++) {
    const regionRow = Math.floor(mappingRow / symbol.regionRows);
    const symbolRow =
      regionRow * (symbol.regionRows + 2) + 1 + (mappingRow % symbol.regionRows);
    for (let mappingColumn = 0; mappingColumn < mapping.columns; mappingColumn++) {
      const regionColumn = Math.floor(mappingColumn / symbol.regionColumns);
      const symbolColumn =
        regionColumn * (symbol.regionColumns + 2) + 1 + (mappingColumn % symbol.regionColumns);

      const entry = placement[mappingRow * mapping.columns + mappingColumn]!;
      let dark: boolean;
      if (entry === ALWAYS_DARK) {
        dark = true;
      } else if (entry === UNSET) {
        dark = false;
      } else {
        const codeword = codewords[entry >> 3];
        dark = codeword !== undefined && ((codeword >> (entry & 7)) & 1) === 1;
      }
      modules[symbolRow * symbol.columns + symbolColumn] = dark;
    }
  }

  return {
    symbology: 'datamatrix',
    width: symbol.columns,
    height: symbol.rows,
    modules,
    quietZone: 1,
    moduleAspect: 1,
    text: data,
  };
}
