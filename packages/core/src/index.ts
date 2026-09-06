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
