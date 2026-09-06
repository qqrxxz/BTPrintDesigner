/**
 * Symbol sizes for Data Matrix ECC 200 (ISO/IEC 16022).
 *
 * Unlike QR, where one number drives everything, Data Matrix sizes are a plain
 * list: twenty-four square shapes and six rectangular ones, each with its own
 * data region geometry and error-correction budget. The region counts are
 * derived rather than listed, since a symbol is always a whole number of
 * regions plus their two-module borders.
 */

export interface SymbolSize {
  readonly rows: number;
  readonly columns: number;
  /** Data region size, excluding the finder and clock borders around it. */
  readonly regionRows: number;
  readonly regionColumns: number;
  readonly dataCodewords: number;
  readonly errorCodewords: number;
  /** Interleaved blocks; more than one only for the largest symbols. */
  readonly blocks: number;
}

function size(
  rows: number,
  columns: number,
  regionRows: number,
  regionColumns: number,
  dataCodewords: number,
  errorCodewords: number,
  blocks = 1,
): SymbolSize {
  return { rows, columns, regionRows, regionColumns, dataCodewords, errorCodewords, blocks };
}

export const SQUARE_SIZES: readonly SymbolSize[] = [
  size(10, 10, 8, 8, 3, 5),
  size(12, 12, 10, 10, 5, 7),
  size(14, 14, 12, 12, 8, 10),
  size(16, 16, 14, 14, 12, 12),
  size(18, 18, 16, 16, 18, 14),
  size(20, 20, 18, 18, 22, 18),
  size(22, 22, 20, 20, 30, 20),
  size(24, 24, 22, 22, 36, 24),
  size(26, 26, 24, 24, 44, 28),
  size(32, 32, 14, 14, 62, 36),
  size(36, 36, 16, 16, 86, 42),
  size(40, 40, 18, 18, 114, 48),
  size(44, 44, 20, 20, 144, 56),
  size(48, 48, 22, 22, 174, 68),
  size(52, 52, 24, 24, 204, 84, 2),
  size(64, 64, 14, 14, 280, 112, 2),
  size(72, 72, 16, 16, 368, 144, 4),
  size(80, 80, 18, 18, 456, 192, 4),
  size(88, 88, 20, 20, 576, 224, 4),
  size(96, 96, 22, 22, 696, 272, 4),
  size(104, 104, 24, 24, 816, 336, 6),
  size(120, 120, 18, 18, 1050, 408, 6),
  size(132, 132, 20, 20, 1304, 496, 8),
  size(144, 144, 22, 22, 1558, 620, 10),
];

export const RECTANGULAR_SIZES: readonly SymbolSize[] = [
  size(8, 18, 6, 16, 5, 7),
  size(8, 32, 6, 14, 10, 11),
  size(12, 26, 10, 24, 16, 14),
  size(12, 36, 10, 16, 22, 18),
  size(16, 36, 14, 16, 32, 24),
  size(16, 48, 14, 22, 49, 28),
];

export type SymbolShape = 'square' | 'rectangle' | 'any';

export function candidateSizes(shape: SymbolShape): readonly SymbolSize[] {
  if (shape === 'square') return SQUARE_SIZES;
  if (shape === 'rectangle') return RECTANGULAR_SIZES;
  return [...SQUARE_SIZES, ...RECTANGULAR_SIZES].sort(
    (a, b) => a.dataCodewords - b.dataCodewords || a.rows * a.columns - b.rows * b.columns,
  );
}

export function regionsHorizontal(symbol: SymbolSize): number {
  return symbol.columns / (symbol.regionColumns + 2);
}

export function regionsVertical(symbol: SymbolSize): number {
  return symbol.rows / (symbol.regionRows + 2);
}

/** Data area with the finder and clock borders removed. */
export function mappingSize(symbol: SymbolSize): { rows: number; columns: number } {
  return {
    rows: symbol.regionRows * regionsVertical(symbol),
    columns: symbol.regionColumns * regionsHorizontal(symbol),
  };
}
