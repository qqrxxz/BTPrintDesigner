import { Bitmap1, type DrawMode, type Rotation } from '../bitmap/Bitmap1.js';
import { BarcodeError } from './types.js';

export type MatrixSymbology = 'qr' | 'datamatrix' | 'pdf417';

/**
 * A two-dimensional symbol as a grid of modules.
 *
 * PDF417 is the reason `moduleAspect` exists: its rows are conventionally three
 * times as tall as a module is wide, and a symbol printed square scans badly.
 */
export interface MatrixSymbol {
  readonly symbology: MatrixSymbology;
  readonly width: number;
  readonly height: number;
  /** Row-major, true meaning a dark module. */
  readonly modules: readonly boolean[];
  /** Blank margin the standard requires, in modules, on every side. */
  readonly quietZone: number;
  /** Row height as a multiple of module width. One for square symbologies. */
  readonly moduleAspect: number;
  /** The data as encoded, for the caller to show or log. */
  readonly text: string;
}

export function matrixModule(symbol: MatrixSymbol, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= symbol.width || y >= symbol.height) return false;
  return symbol.modules[y * symbol.width + x]!;
}

export interface MatrixRenderOptions {
  /** Dots per module. Whole numbers only, for the same reason as 1D symbols. */
  readonly moduleWidth?: number;
  /**
   * Dots per module row. Defaults to `moduleWidth * moduleAspect`, rounded up
   * to a whole dot.
   */
  readonly moduleHeight?: number;
  readonly quietZone?: boolean;
  readonly rotation?: Rotation;
  readonly mode?: DrawMode;
}

export function renderMatrix(symbol: MatrixSymbol, options: MatrixRenderOptions = {}): Bitmap1 {
  const moduleWidth = options.moduleWidth ?? 3;
  if (!Number.isInteger(moduleWidth) || moduleWidth < 1) {
    throw new BarcodeError(
      `Module width must be a whole number of dots, got ${moduleWidth}. ` +
        'Snap the requested size to the dot grid before rendering.',
    );
  }
  const moduleHeight = options.moduleHeight ?? Math.max(1, Math.round(moduleWidth * symbol.moduleAspect));
  if (!Number.isInteger(moduleHeight) || moduleHeight < 1) {
    throw new BarcodeError(`Module height must be a whole number of dots, got ${moduleHeight}`);
  }

  const quiet = (options.quietZone ?? true) ? symbol.quietZone : 0;
  const bitmap = new Bitmap1(
    (symbol.width + quiet * 2) * moduleWidth,
    symbol.height * moduleHeight + quiet * 2 * moduleHeight,
  );

  for (let y = 0; y < symbol.height; y++) {
    for (let x = 0; x < symbol.width; x++) {
      if (!matrixModule(symbol, x, y)) continue;
      bitmap.fillRect(
        (quiet + x) * moduleWidth,
        (quiet + y) * moduleHeight,
        moduleWidth,
        moduleHeight,
      );
    }
  }

  return options.rotation ? bitmap.rotated(options.rotation) : bitmap;
}

export function drawMatrix(
  target: Bitmap1,
  symbol: MatrixSymbol,
  x: number,
  y: number,
  options: MatrixRenderOptions = {},
): Bitmap1 {
  const rendered = renderMatrix(symbol, options);
  target.blit(rendered, Math.round(x), Math.round(y), options.mode ?? 'or');
  return rendered;
}
