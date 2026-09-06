import { Bitmap1 } from '../bitmap/Bitmap1.js';

/**
 * Signed-area coverage accumulator.
 *
 * This is the rasterisation approach popularised by font-rs: instead of testing
 * scanline crossings, every edge deposits the *signed area* it sweeps through
 * each cell it touches. A running sum along the row then turns those deposits
 * into exact per-pixel coverage in one pass, with no supersampling and no
 * sorting of edges.
 *
 * Two properties matter for a label preview. It is exact — a 0.5-dot-wide bar
 * yields exactly 0.5 coverage, so the threshold decides whether the printer
 * burns it, which is the question the user is actually asking. And it is
 * deterministic: the same input gives the same bits on macOS and Windows,
 * because nothing here depends on a platform text or graphics engine.
 */
export class CoverageAccumulator {
  readonly width: number;
  readonly height: number;
  /** Two spare cells per row absorb deposits that land past the right edge. */
  private readonly stride: number;
  private readonly area: Float32Array;

  constructor(width: number, height: number) {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.stride = this.width + 2;
    this.area = new Float32Array(this.stride * this.height);
  }

  /**
   * Deposits one edge of a closed polygon.
   *
   * Direction carries the winding: an edge running down deposits positive area
   * and one running up deposits negative, so a counter-wound inner contour
   * cancels the outer one and leaves a hole — which is how the counter of an
   * "o" and the ring of a QR finder pattern both come out right.
   */
  addEdge(ax: number, ay: number, bx: number, by: number): void {
    if (Math.abs(ay - by) < 1e-9) return; // Horizontal edges sweep no area.

    const downwards = ay < by;
    const dir = downwards ? 1 : -1;
    const p0x = downwards ? ax : bx;
    const p0y = downwards ? ay : by;
    const p1x = downwards ? bx : ax;
    const p1y = downwards ? by : ay;

    if (p1y <= 0 || p0y >= this.height) return; // Entirely above or below.

    const dxdy = (p1x - p0x) / (p1y - p0y);
    let x = p0x;
    let yStart = Math.floor(p0y);
    if (p0y < 0) {
      // Walk the edge down to the first visible scanline.
      x -= p0y * dxdy;
      yStart = 0;
    }
    const yEnd = Math.min(this.height, Math.ceil(p1y));

    for (let y = yStart; y < yEnd; y++) {
      const row = y * this.stride;
      const dy = Math.min(y + 1, p1y) - Math.max(y, p0y);
      const xNext = x + dxdy * dy;
      const d = dy * dir;

      const xa = x < xNext ? x : xNext;
      const xb = x < xNext ? xNext : x;

      if (xb < 0) {
        // Everything left of the bitmap still sets the winding for the whole
        // row, so its area collapses onto the first column.
        this.area[row]! += d;
      } else if (xa <= this.width) {
        this.depositSpan(row, x, xNext, xa, xb, d);
      }
      // A span entirely right of the bitmap is invisible: the running sum never
      // reaches it.

      x = xNext;
    }
  }

  /** Spreads the area `d` swept between x and xNext across the cells it covers. */
  private depositSpan(
    row: number,
    x: number,
    xNext: number,
    xa: number,
    xb: number,
    d: number,
  ): void {
    const x0floor = Math.floor(xa);
    const x0i = x0floor;
    const x1ceil = Math.ceil(xb);
    const x1i = x1ceil;

    if (x1i <= x0i + 1) {
      // The span stays within one cell pair: split by the midpoint.
      const xmf = 0.5 * (x + xNext) - x0floor;
      this.deposit(row, x0i, d - d * xmf);
      this.deposit(row, x0i + 1, d * xmf);
      return;
    }

    const s = 1 / (xb - xa);
    const x0f = xa - x0floor;
    const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
    const x1f = xb - x1ceil + 1;
    const am = 0.5 * s * x1f * x1f;

    this.deposit(row, x0i, d * a0);

    if (x1i === x0i + 2) {
      this.deposit(row, x0i + 1, d * (1 - a0 - am));
    } else {
      const a1 = s * (1.5 - x0f);
      this.deposit(row, x0i + 1, d * (a1 - a0));

      // Interior cells each take a full slice. Clipped-away cells on the left
      // fold into column 0 in bulk rather than looping over them.
      const first = x0i + 2;
      const last = x1i - 1; // exclusive
      if (first < 0) this.area[row]! += d * s * (Math.min(last, 0) - first);
      const from = Math.max(first, 0);
      const to = Math.min(last, this.width + 1);
      for (let xi = from; xi < to; xi++) this.area[row + xi]! += d * s;

      const a2 = a1 + (x1i - x0i - 3) * s;
      this.deposit(row, x1i - 1, d * (1 - a2 - am));
    }

    this.deposit(row, x1i, d * am);
  }

  private deposit(row: number, xi: number, value: number): void {
    const index = xi < 0 ? 0 : xi > this.width ? this.width + 1 : xi;
    this.area[row + index]! += value;
  }

  /**
   * Resolves deposits into per-pixel coverage in [0, 1].
   *
   * The sum restarts on every row: a closed path's deposits cancel out within
   * a row, but a path clipped by the bitmap edge need not, and carrying that
   * residue into the next row would paint a stripe across the label.
   */
  coverage(): Float32Array {
    const out = new Float32Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      const row = y * this.stride;
      const outRow = y * this.width;
      let accumulated = 0;
      for (let x = 0; x < this.width; x++) {
        accumulated += this.area[row + x]!;
        const value = Math.abs(accumulated);
        out[outRow + x] = value > 1 ? 1 : value;
      }
    }
    return out;
  }

  /**
   * Thresholds coverage into dots.
   *
   * A thermal head has no grey: a dot is burnt or it is not. Half coverage is
   * the honest cut-off, and it is what makes the preview refuse to flatter thin
   * strokes that a real printer would drop.
   */
  toBitmap(threshold = 0.5): Bitmap1 {
    const bitmap = new Bitmap1(this.width, this.height);
    const coverage = this.coverage();
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      for (let x = 0; x < this.width; x++) {
        if (coverage[row + x]! >= threshold) bitmap.set(x, y, 1);
      }
    }
    return bitmap;
  }
}
