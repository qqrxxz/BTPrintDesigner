import type { Bitmap1, DrawMode } from '../bitmap/Bitmap1.js';
import { fillPath, type FillOptions } from './fill.js';
import { Path } from './Path.js';

export interface StrokeOptions extends FillOptions {
  /** Line width in dots. Rounded up to one dot: printers cannot draw less. */
  thickness?: number;
}

/** Control-point offset that turns a cubic into a quarter of an ellipse. */
const KAPPA = 0.5522847498307936;

function drawMode(options: FillOptions): DrawMode {
  return options.mode ?? 'or';
}

function usableThickness(thickness: number | undefined): number {
  return Math.max(1, Math.round(thickness ?? 1));
}

/** Solid rectangle. Integer-exact, no coverage maths involved. */
export function fillRectangle(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  options: FillOptions = {},
): void {
  target.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height), drawMode(options));
}

/**
 * Rectangular outline drawn inward from the given rectangle.
 *
 * Inward, not centred, because that is what ZPL's ^GB and TSPL's BOX both do:
 * the rectangle you specify is the outer edge, and thickening the border eats
 * into it rather than growing the label footprint.
 */
export function strokeRectangle(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  options: StrokeOptions = {},
): void {
  const t = usableThickness(options.thickness);
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(width);
  const rh = Math.round(height);
  const mode = drawMode(options);

  if (rw <= 0 || rh <= 0) return;
  if (t * 2 >= rw || t * 2 >= rh) {
    // The border has swallowed the interior; the box is solid.
    target.fillRect(rx, ry, rw, rh, mode);
    return;
  }
  target.fillRect(rx, ry, rw, t, mode); // top
  target.fillRect(rx, ry + rh - t, rw, t, mode); // bottom
  target.fillRect(rx, ry + t, t, rh - 2 * t, mode); // left
  target.fillRect(rx + rw - t, ry + t, t, rh - 2 * t, mode); // right
}

/**
 * Rectangle with rounded corners, as ZPL's ^GB rounding and TSPL's BOX radius
 * produce. A radius of zero delegates to the exact integer path.
 */
export function roundedRectangle(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: StrokeOptions = {},
): void {
  const t = usableThickness(options.thickness);
  if (radius <= 0) {
    strokeRectangle(target, x, y, width, height, options);
    return;
  }
  const outerRadius = Math.min(radius, width / 2, height / 2);
  const path = roundedRectPath(x, y, width, height, outerRadius, false);
  const innerWidth = width - 2 * t;
  const innerHeight = height - 2 * t;
  if (innerWidth > 0 && innerHeight > 0) {
    const innerRadius = Math.max(0, Math.min(outerRadius - t, innerWidth / 2, innerHeight / 2));
    // Wound the other way so it cancels the outer contour and leaves a hole.
    path.append(roundedRectPath(x + t, y + t, innerWidth, innerHeight, innerRadius, true));
  }
  fillPath(target, path, options);
}

/** Solid rounded rectangle. */
export function fillRoundedRectangle(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  options: FillOptions = {},
): void {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  fillPath(target, roundedRectPath(x, y, width, height, r, false), options);
}

/**
 * Straight line of a given thickness between two points, with butt ends.
 *
 * Axis-aligned lines take the exact integer path, both because it is faster and
 * because a horizontal rule must land on precise dot rows — a rule that drifts
 * half a dot looks like a rendering bug to anyone comparing against a printout.
 */
export function drawLine(
  target: Bitmap1,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  options: StrokeOptions = {},
): void {
  const t = usableThickness(options.thickness);
  const half = t / 2;

  if (Math.abs(y0 - y1) < 1e-9) {
    const left = Math.round(Math.min(x0, x1));
    const right = Math.round(Math.max(x0, x1));
    target.fillRect(left, Math.round(y0 - half), right - left, t, drawMode(options));
    return;
  }
  if (Math.abs(x0 - x1) < 1e-9) {
    const top = Math.round(Math.min(y0, y1));
    const bottom = Math.round(Math.max(y0, y1));
    target.fillRect(Math.round(x0 - half), top, t, bottom - top, drawMode(options));
    return;
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;

  const path = new Path()
    .moveTo(x0 + nx, y0 + ny)
    .lineTo(x1 + nx, y1 + ny)
    .lineTo(x1 - nx, y1 - ny)
    .lineTo(x0 - nx, y0 - ny)
    .close();
  fillPath(target, path, options);
}

/** Ellipse outline inscribed in the given box, thickened inward. */
export function strokeEllipse(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  options: StrokeOptions = {},
): void {
  const t = usableThickness(options.thickness);
  const path = ellipsePath(x, y, width, height, false);
  const innerWidth = width - 2 * t;
  const innerHeight = height - 2 * t;
  if (innerWidth > 0 && innerHeight > 0) {
    path.append(ellipsePath(x + t, y + t, innerWidth, innerHeight, true));
  }
  fillPath(target, path, options);
}

export function fillEllipse(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  options: FillOptions = {},
): void {
  fillPath(target, ellipsePath(x, y, width, height, false), options);
}

export function strokeCircle(
  target: Bitmap1,
  x: number,
  y: number,
  diameter: number,
  options: StrokeOptions = {},
): void {
  strokeEllipse(target, x, y, diameter, diameter, options);
}

export function fillCircle(
  target: Bitmap1,
  x: number,
  y: number,
  diameter: number,
  options: FillOptions = {},
): void {
  fillEllipse(target, x, y, diameter, diameter, options);
}

/** Ellipse inscribed in a box, as four cubic arcs. */
export function ellipsePath(
  x: number,
  y: number,
  width: number,
  height: number,
  reverse: boolean,
): Path {
  const rx = width / 2;
  const ry = height / 2;
  const cx = x + rx;
  const cy = y + ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  const path = new Path();
  if (!reverse) {
    path
      .moveTo(cx, y)
      .cubicTo(cx + ox, y, x + width, cy - oy, x + width, cy)
      .cubicTo(x + width, cy + oy, cx + ox, y + height, cx, y + height)
      .cubicTo(cx - ox, y + height, x, cy + oy, x, cy)
      .cubicTo(x, cy - oy, cx - ox, y, cx, y)
      .close();
  } else {
    path
      .moveTo(cx, y)
      .cubicTo(cx - ox, y, x, cy - oy, x, cy)
      .cubicTo(x, cy + oy, cx - ox, y + height, cx, y + height)
      .cubicTo(cx + ox, y + height, x + width, cy + oy, x + width, cy)
      .cubicTo(x + width, cy - oy, cx + ox, y, cx, y)
      .close();
  }
  return path;
}

/** Rounded rectangle outline as a path, clockwise unless reversed. */
export function roundedRectPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  reverse: boolean,
): Path {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const o = r * KAPPA;
  const right = x + width;
  const bottom = y + height;
  const path = new Path();
  if (!reverse) {
    path
      .moveTo(x + r, y)
      .lineTo(right - r, y)
      .cubicTo(right - r + o, y, right, y + r - o, right, y + r)
      .lineTo(right, bottom - r)
      .cubicTo(right, bottom - r + o, right - r + o, bottom, right - r, bottom)
      .lineTo(x + r, bottom)
      .cubicTo(x + r - o, bottom, x, bottom - r + o, x, bottom - r)
      .lineTo(x, y + r)
      .cubicTo(x, y + r - o, x + r - o, y, x + r, y)
      .close();
  } else {
    path
      .moveTo(x + r, y)
      .cubicTo(x + r - o, y, x, y + r - o, x, y + r)
      .lineTo(x, bottom - r)
      .cubicTo(x, bottom - r + o, x + r - o, bottom, x + r, bottom)
      .lineTo(right - r, bottom)
      .cubicTo(right - r + o, bottom, right, bottom - r + o, right, bottom - r)
      .lineTo(right, y + r)
      .cubicTo(right, y + r - o, right - r + o, y, right - r, y)
      .close();
  }
  return path;
}
