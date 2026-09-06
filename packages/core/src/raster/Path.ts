import {
  applyMatrix,
  type Matrix,
  type Point,
  type Rect,
} from '../util/geometry.js';

export type PathCommand =
  | { readonly type: 'move'; readonly x: number; readonly y: number }
  | { readonly type: 'line'; readonly x: number; readonly y: number }
  | {
      readonly type: 'quad';
      readonly cx: number;
      readonly cy: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'cubic';
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'close' };

/**
 * An outline made of straight and Bézier segments.
 *
 * Paths carry curves rather than points because glyph outlines arrive as
 * curves and the flattening tolerance depends on the final dot size: at 600 dpi
 * a curve needs more segments than the same curve at 203 dpi, and deciding that
 * up front would either waste work or show visible faceting.
 */
export class Path {
  readonly commands: PathCommand[] = [];

  moveTo(x: number, y: number): this {
    this.commands.push({ type: 'move', x, y });
    return this;
  }

  lineTo(x: number, y: number): this {
    this.commands.push({ type: 'line', x, y });
    return this;
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    this.commands.push({ type: 'quad', cx, cy, x, y });
    return this;
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.commands.push({ type: 'cubic', c1x, c1y, c2x, c2y, x, y });
    return this;
  }

  close(): this {
    this.commands.push({ type: 'close' });
    return this;
  }

  get isEmpty(): boolean {
    return this.commands.length === 0;
  }

  /** Appends every command of `other`, unchanged. */
  append(other: Path): this {
    this.commands.push(...other.commands);
    return this;
  }

  transform(matrix: Matrix): Path {
    const out = new Path();
    for (const command of this.commands) {
      switch (command.type) {
        case 'move': {
          const p = applyMatrix(matrix, command.x, command.y);
          out.moveTo(p.x, p.y);
          break;
        }
        case 'line': {
          const p = applyMatrix(matrix, command.x, command.y);
          out.lineTo(p.x, p.y);
          break;
        }
        case 'quad': {
          const c = applyMatrix(matrix, command.cx, command.cy);
          const p = applyMatrix(matrix, command.x, command.y);
          out.quadTo(c.x, c.y, p.x, p.y);
          break;
        }
        case 'cubic': {
          const c1 = applyMatrix(matrix, command.c1x, command.c1y);
          const c2 = applyMatrix(matrix, command.c2x, command.c2y);
          const p = applyMatrix(matrix, command.x, command.y);
          out.cubicTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
          break;
        }
        case 'close':
          out.close();
          break;
      }
    }
    return out;
  }

  /**
   * Bounding box of the control points.
   *
   * Control points can sit outside the curve they steer, so this box can be
   * larger than the true outline. That is the safe direction to be wrong in:
   * it is used to size the coverage buffer.
   */
  bounds(): Rect | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const consider = (x: number, y: number): void => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const command of this.commands) {
      switch (command.type) {
        case 'move':
        case 'line':
          consider(command.x, command.y);
          break;
        case 'quad':
          consider(command.cx, command.cy);
          consider(command.x, command.y);
          break;
        case 'cubic':
          consider(command.c1x, command.c1y);
          consider(command.c2x, command.c2y);
          consider(command.x, command.y);
          break;
        case 'close':
          break;
      }
    }
    if (minX === Infinity) return undefined;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /**
   * Walks the path as closed polygons of straight edges.
   *
   * Every subpath is implicitly closed — an unclosed outline would leave the
   * coverage accumulator with a dangling winding and smear across the row — so
   * the callback always receives a loop.
   */
  flatten(tolerance: number, emit: (from: Point, to: Point) => void): void {
    let start: Point | undefined;
    let current: Point | undefined;

    const closeSubpath = (): void => {
      if (start && current && (current.x !== start.x || current.y !== start.y)) {
        emit(current, start);
      }
      current = start;
    };

    for (const command of this.commands) {
      switch (command.type) {
        case 'move':
          closeSubpath();
          start = { x: command.x, y: command.y };
          current = start;
          break;
        case 'line': {
          const to = { x: command.x, y: command.y };
          if (current) emit(current, to);
          else start = to;
          current = to;
          break;
        }
        case 'quad': {
          if (!current) {
            current = { x: command.x, y: command.y };
            start ??= current;
            break;
          }
          flattenQuad(
            current,
            { x: command.cx, y: command.cy },
            { x: command.x, y: command.y },
            tolerance,
            emit,
          );
          current = { x: command.x, y: command.y };
          break;
        }
        case 'cubic': {
          if (!current) {
            current = { x: command.x, y: command.y };
            start ??= current;
            break;
          }
          flattenCubic(
            current,
            { x: command.c1x, y: command.c1y },
            { x: command.c2x, y: command.c2y },
            { x: command.x, y: command.y },
            tolerance,
            emit,
          );
          current = { x: command.x, y: command.y };
          break;
        }
        case 'close':
          closeSubpath();
          break;
      }
    }
    closeSubpath();
  }
}

/**
 * Segment count for a quadratic, from its deviation from the chord.
 *
 * The control point's distance from the chord bounds the curve's error, and
 * doubling the step count quarters that error, so the count grows with the
 * square root of the deviation.
 */
function quadSegments(p0: Point, c: Point, p1: Point, tolerance: number): number {
  const dx = p0.x - 2 * c.x + p1.x;
  const dy = p0.y - 2 * c.y + p1.y;
  const deviation = Math.hypot(dx, dy);
  if (deviation <= tolerance) return 1;
  return Math.min(1000, Math.ceil(Math.sqrt(deviation / (4 * tolerance)) * 2));
}

function flattenQuad(
  p0: Point,
  c: Point,
  p1: Point,
  tolerance: number,
  emit: (from: Point, to: Point) => void,
): void {
  const steps = quadSegments(p0, c, p1, tolerance);
  let previous = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const point = {
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
    };
    emit(previous, point);
    previous = point;
  }
}

function flattenCubic(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  tolerance: number,
  emit: (from: Point, to: Point) => void,
): void {
  // Both halves of the control polygon bound the error; take the worse one.
  const d1 = Math.hypot(p0.x - 2 * c1.x + c2.x, p0.y - 2 * c1.y + c2.y);
  const d2 = Math.hypot(c1.x - 2 * c2.x + p1.x, c1.y - 2 * c2.y + p1.y);
  const deviation = Math.max(d1, d2);
  const steps =
    deviation <= tolerance
      ? 1
      : Math.min(1000, Math.ceil(Math.sqrt(deviation / (4 * tolerance)) * 3));
  let previous = p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const point = {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    };
    emit(previous, point);
    previous = point;
  }
}
