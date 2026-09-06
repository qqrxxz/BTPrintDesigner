import { Bitmap1, type DrawMode, type Rotation } from '../bitmap/Bitmap1.js';
import { BarcodeError, type LinearSymbol } from './types.js';

export interface LinearRenderOptions {
  /**
   * Dots per narrow module. A whole number by necessity, not by convenience:
   * printer languages express it in dots, and a symbol whose modules land on
   * fractional dot boundaries scans badly or not at all.
   */
  readonly moduleWidth?: number;
  /** Bar height in dots, excluding any guard descenders. */
  readonly height: number;
  /** Include the symbology's quiet zone in the rendered image. */
  readonly quietZone?: boolean;
  /** Extra dots that guard bars run past the others, for EAN and UPC. */
  readonly descenderExtension?: number;
  readonly rotation?: Rotation;
  readonly mode?: DrawMode;
}

function moduleWidthOf(options: LinearRenderOptions): number {
  const requested = options.moduleWidth ?? 2;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new BarcodeError(
      `Module width must be a whole number of dots, got ${requested}. ` +
        'Snap the requested size to the dot grid before rendering.',
    );
  }
  return requested;
}

/** Width the symbol will occupy, in dots. */
export function linearWidthDots(symbol: LinearSymbol, options: LinearRenderOptions): number {
  const moduleWidth = moduleWidthOf(options);
  const quiet = (options.quietZone ?? true) ? symbol.quietZone.left + symbol.quietZone.right : 0;
  return (symbol.modules.length + quiet) * moduleWidth;
}

/**
 * Draws a symbol as exact rectangles.
 *
 * Nothing here goes through coverage or thresholding: every bar is a whole
 * number of dots wide and lands on a dot boundary, which is the only way a
 * printed symbol scans reliably. A barcode is the one element on a label where
 * "close enough" is indistinguishable from broken.
 */
export function renderLinear(symbol: LinearSymbol, options: LinearRenderOptions): Bitmap1 {
  const moduleWidth = moduleWidthOf(options);
  const withQuietZone = options.quietZone ?? true;
  const quietLeft = withQuietZone ? symbol.quietZone.left : 0;
  const quietRight = withQuietZone ? symbol.quietZone.right : 0;
  const extension = symbol.descenders ? (options.descenderExtension ?? 0) : 0;

  if (options.height < 1) throw new BarcodeError('Barcode height must be at least one dot');

  const width = (symbol.modules.length + quietLeft + quietRight) * moduleWidth;
  const height = Math.round(options.height) + extension;
  const bitmap = new Bitmap1(width, height);

  symbol.modules.forEach((isBar, index) => {
    if (!isBar) return;
    const barHeight = symbol.descenders?.[index] ? height : height - extension;
    bitmap.fillRect((quietLeft + index) * moduleWidth, 0, moduleWidth, barHeight);
  });

  return options.rotation ? bitmap.rotated(options.rotation) : bitmap;
}

/** Renders a symbol and composites it onto a label. */
export function drawLinear(
  target: Bitmap1,
  symbol: LinearSymbol,
  x: number,
  y: number,
  options: LinearRenderOptions,
): Bitmap1 {
  const rendered = renderLinear(symbol, options);
  target.blit(rendered, Math.round(x), Math.round(y), options.mode ?? 'or');
  return rendered;
}
