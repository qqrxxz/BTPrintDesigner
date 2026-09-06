import { Bitmap1, type DrawMode } from '../bitmap/Bitmap1.js';
import { CoverageAccumulator } from './CoverageAccumulator.js';
import type { Path } from './Path.js';

export interface FillOptions {
  /** Coverage at which a dot is burnt. Half a dot is the honest default. */
  threshold?: number;
  /** Maximum curve-to-chord error when flattening, in dots. */
  tolerance?: number;
  mode?: DrawMode;
}

const DEFAULT_TOLERANCE = 0.1;
const DEFAULT_THRESHOLD = 0.5;

/**
 * Fills a path onto a bitmap.
 *
 * Only the part of the path that overlaps the bitmap is rasterised, so a glyph
 * pushed far off the label costs nothing. Geometry to the left of the bitmap is
 * still accounted for, because it decides whether the visible part of a row
 * sits inside the shape or outside it.
 */
export function fillPath(target: Bitmap1, path: Path, options: FillOptions = {}): void {
  const bounds = path.bounds();
  if (!bounds) return;

  const left = Math.max(0, Math.floor(bounds.x));
  const top = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(target.width, Math.ceil(bounds.x + bounds.width) + 1);
  const bottom = Math.min(target.height, Math.ceil(bounds.y + bounds.height) + 1);
  if (right <= left || bottom <= top) return;

  const region = rasterizePath(path, right - left, bottom - top, options, left, top);
  target.blit(region, left, top, options.mode ?? 'or');
}

/**
 * Rasterises a path into a standalone bitmap of the given size.
 *
 * `offsetX`/`offsetY` shift the path so a caller can rasterise a window onto a
 * larger coordinate space without building a transformed copy of the path.
 */
export function rasterizePath(
  path: Path,
  width: number,
  height: number,
  options: FillOptions = {},
  offsetX = 0,
  offsetY = 0,
): Bitmap1 {
  const accumulator = new CoverageAccumulator(width, height);
  path.flatten(options.tolerance ?? DEFAULT_TOLERANCE, (from, to) => {
    accumulator.addEdge(from.x - offsetX, from.y - offsetY, to.x - offsetX, to.y - offsetY);
  });
  return accumulator.toBitmap(options.threshold ?? DEFAULT_THRESHOLD);
}
