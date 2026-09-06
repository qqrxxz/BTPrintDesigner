/**
 * Minimal geometry helpers shared by the rasteriser.
 *
 * All coordinates are in printer dots unless a name says otherwise: x grows to
 * the right, y grows downward, and the origin is the top-left corner of the
 * label. This matches how every printer language we target addresses the media.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Affine transform laid out as in the canvas/PostScript convention:
 *
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translation(tx: number, ty: number): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

export function scaling(sx: number, sy: number = sx): Matrix {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** Rotation by `radians`, clockwise on screen because y points down. */
export function rotation(radians: number): Matrix {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** `m` applied after `n` — i.e. the result maps p to m(n(p)). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** Composes left to right: `compose(a, b, c)` applies a, then b, then c. */
export function compose(...matrices: readonly Matrix[]): Matrix {
  let result = IDENTITY;
  for (const m of matrices) result = multiply(m, result);
  return result;
}

export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
