/**
 * @btpd/core — the language-agnostic rendering core.
 *
 * Everything a printer language needs in order to turn commands into the
 * one-bit image a thermal head will burn, and nothing about any particular
 * language. ZPL, TSPL and CPCL front-ends all sit on top of this.
 */

export { Bitmap1 } from './bitmap/Bitmap1.js';
export type { DrawMode, Rotation } from './bitmap/Bitmap1.js';
export { encodePng } from './bitmap/png.js';
export type { PngOptions } from './bitmap/png.js';

export { encodeCode128, FNC1, FNC2, FNC3, FNC4 } from './barcode/code128.js';
export type { Code128Options } from './barcode/code128.js';
export { encodeCode39 } from './barcode/code39.js';
export type { Code39Options } from './barcode/code39.js';
export { encodeItf, encodeItf14, itfCheckDigit } from './barcode/itf.js';
export type { ItfOptions } from './barcode/itf.js';
export {
  eanCheckDigit,
  encodeEan13,
  encodeEan8,
  encodeUpcA,
  encodeUpcE,
  upcEToUpcA,
} from './barcode/ean.js';
export type { UpcEOptions } from './barcode/ean.js';
export { drawLinear, linearWidthDots, renderLinear } from './barcode/render.js';
export { drawMatrix, matrixModule, renderMatrix } from './barcode/matrix.js';
export type { MatrixRenderOptions, MatrixSymbol, MatrixSymbology } from './barcode/matrix.js';
export { encodePdf417 } from './barcode/pdf417/encode.js';
export type { Pdf417ErrorCorrection, Pdf417Options } from './barcode/pdf417/encode.js';
export { encodeDataMatrix } from './barcode/datamatrix/encode.js';
export type { DataMatrixOptions } from './barcode/datamatrix/encode.js';
export type { SymbolShape, SymbolSize } from './barcode/datamatrix/tables.js';
export { encodeQr } from './barcode/qr/encode.js';
export type { QrMode, QrOptions } from './barcode/qr/encode.js';
export type { ErrorCorrectionLevel } from './barcode/qr/tables.js';
export { GaloisField, QR_FIELD, DATA_MATRIX_FIELD, reedSolomonRemainder } from './barcode/galois.js';
export type { LinearRenderOptions } from './barcode/render.js';
export { BarcodeError, patternToModules } from './barcode/types.js';
export type { HriGroup, LinearSymbol, LinearSymbology, QuietZone } from './barcode/types.js';

export { CoverageAccumulator } from './raster/CoverageAccumulator.js';
export { Path } from './raster/Path.js';
export type { PathCommand } from './raster/Path.js';
export { fillPath, rasterizePath } from './raster/fill.js';
export type { FillOptions } from './raster/fill.js';
export {
  drawLine,
  ellipsePath,
  fillCircle,
  fillEllipse,
  fillRectangle,
  fillRoundedRectangle,
  roundedRectPath,
  roundedRectangle,
  strokeCircle,
  strokeEllipse,
  strokeRectangle,
} from './raster/primitives.js';
export type { StrokeOptions } from './raster/primitives.js';

export { Font } from './text/Font.js';
export type { Glyph } from './text/Font.js';
export { drawText, drawTextWithMode, measureText, textToPath } from './text/text.js';
export type { DrawTextOptions, TextAnchor, TextMetrics, TextStyle } from './text/text.js';

export * from './tspl/index.js';

export {
  applyMatrix,
  clamp,
  compose,
  IDENTITY,
  multiply,
  rotation,
  scaling,
  translation,
} from './util/geometry.js';
export type { Matrix, Point, Rect } from './util/geometry.js';

export {
  dotsPerMm,
  dotsToInch,
  dotsToMm,
  inchToDots,
  isDpi,
  MM_PER_INCH,
  mmToDots,
  mmToDotsAtLeastOne,
  mmToDotsRounded,
  SUPPORTED_DPI,
} from './util/units.js';
export type { Dpi } from './util/units.js';
