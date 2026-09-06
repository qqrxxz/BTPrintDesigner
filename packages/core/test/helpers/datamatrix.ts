import {
  ALWAYS_DARK,
  computePlacement,
  UNSET,
} from '../../src/barcode/datamatrix/encode.js';
import { mappingSize, type SymbolSize } from '../../src/barcode/datamatrix/tables.js';
import { DATA_MATRIX_FIELD } from '../../src/barcode/galois.js';
import type { MatrixSymbol } from '../../src/barcode/matrix.js';

/**
 * Reads the codeword stream back out of a finished symbol.
 *
 * Running the placement backwards turns the rendered modules into codewords
 * again, which is what lets a test check the assembly without a decoder.
 */
export function extractCodewords(symbol: MatrixSymbol, size: SymbolSize): number[] {
  const mapping = mappingSize(size);
  const placement = computePlacement(mapping.rows, mapping.columns);
  const codewords = new Array<number>(size.dataCodewords + size.errorCodewords).fill(0);

  for (let mappingRow = 0; mappingRow < mapping.rows; mappingRow++) {
    const regionRow = Math.floor(mappingRow / size.regionRows);
    const symbolRow = regionRow * (size.regionRows + 2) + 1 + (mappingRow % size.regionRows);
    for (let mappingColumn = 0; mappingColumn < mapping.columns; mappingColumn++) {
      const regionColumn = Math.floor(mappingColumn / size.regionColumns);
      const symbolColumn =
        regionColumn * (size.regionColumns + 2) + 1 + (mappingColumn % size.regionColumns);

      const entry = placement[mappingRow * mapping.columns + mappingColumn]!;
      if (entry === UNSET || entry === ALWAYS_DARK) continue;
      if (symbol.modules[symbolRow * symbol.width + symbolColumn]) {
        codewords[entry >> 3] = codewords[entry >> 3]! | (1 << (entry & 7));
      }
    }
  }
  return codewords;
}

/**
 * Checks that every interleaved block is a valid Reed-Solomon codeword.
 *
 * A block's data and correction codewords together form a polynomial that must
 * evaluate to zero at each root of the generator. This is the definition of the
 * error correction being right, and it needs no second implementation to
 * compare against — which matters here, because ZXing's own Data Matrix encoder
 * produces undecodable output for every multi-block size.
 */
export function syndromesAreZero(stream: readonly number[], size: SymbolSize): boolean {
  const data = stream.slice(0, size.dataCodewords);
  const ecc = stream.slice(size.dataCodewords);
  const eccPerBlock = size.errorCodewords / size.blocks;

  for (let block = 0; block < size.blocks; block++) {
    const blockWords: number[] = [];
    for (let i = block; i < data.length; i += size.blocks) blockWords.push(data[i]!);
    for (let i = 0; i < eccPerBlock; i++) blockWords.push(ecc[i * size.blocks + block]!);

    // Data Matrix generator roots start at alpha^1.
    for (let root = 1; root <= eccPerBlock; root++) {
      let sum = 0;
      for (const word of blockWords) {
        sum = DATA_MATRIX_FIELD.multiply(sum, DATA_MATRIX_FIELD.power(root)) ^ word;
      }
      if (sum !== 0) return false;
    }
  }
  return true;
}
