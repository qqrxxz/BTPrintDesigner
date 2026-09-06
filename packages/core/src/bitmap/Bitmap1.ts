import type { Rect } from '../util/geometry.js';

/**
 * How a drawing operation combines with what is already on the bitmap.
 *
 * Thermal printers only know "burn a dot", so `or` is the normal mode. `xor`
 * exists because ZPL's field reverse (^FR) and TSPL's REVERSE both invert the
 * area they cover, and `and`/`replace` are useful when compositing a rendered
 * run of text that has already been thresholded.
 */
export type DrawMode = 'or' | 'and' | 'xor' | 'replace';

/** Quarter-turn rotations, the only ones printer languages offer. */
export type Rotation = 0 | 90 | 180 | 270;

const BIT_MASKS = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01] as const;

/**
 * A one-bit-per-pixel raster, packed MSB-first into whole bytes per row.
 *
 * The packing is not an implementation detail: it is exactly the layout ZPL's
 * ^GF and TSPL's BITMAP expect, so a label can be handed to a printer without
 * a repacking step, and a printer's own graphic field can be read back in.
 *
 * A set bit means a burnt dot, which is black on the label.
 */
export class Bitmap1 {
  readonly width: number;
  readonly height: number;
  /** Bytes per row, always ceil(width / 8). Rows are byte-aligned. */
  readonly rowBytes: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, data?: Uint8Array) {
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new RangeError('Bitmap1 dimensions must be integers');
    }
    if (width < 0 || height < 0) {
      throw new RangeError('Bitmap1 dimensions must not be negative');
    }
    this.width = width;
    this.height = height;
    this.rowBytes = (width + 7) >> 3;
    const needed = this.rowBytes * height;
    if (data === undefined) {
      this.data = new Uint8Array(needed);
    } else {
      if (data.length !== needed) {
        throw new RangeError(
          `packed data is ${data.length} bytes, expected ${needed} for ${width}x${height}`,
        );
      }
      this.data = data;
    }
  }

  get bounds(): Rect {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Reads a dot. Everything outside the bitmap reads as blank. */
  get(x: number, y: number): 0 | 1 {
    if (!this.contains(x, y)) return 0;
    const byte = this.data[y * this.rowBytes + (x >> 3)]!;
    return (byte & BIT_MASKS[x & 7]!) === 0 ? 0 : 1;
  }

  /** Writes a dot. Coordinates outside the bitmap are dropped, not wrapped. */
  set(x: number, y: number, value: 0 | 1 | boolean): void {
    if (!this.contains(x, y)) return;
    const index = y * this.rowBytes + (x >> 3);
    const mask = BIT_MASKS[x & 7]!;
    if (value) this.data[index]! |= mask;
    else this.data[index]! &= ~mask;
  }

  /** Applies `value` at (x, y) through a draw mode. */
  put(x: number, y: number, value: 0 | 1, mode: DrawMode = 'or'): void {
    if (!this.contains(x, y)) return;
    switch (mode) {
      case 'or':
        if (value) this.set(x, y, 1);
        return;
      case 'and':
        if (!value) this.set(x, y, 0);
        return;
      case 'xor':
        if (value) this.set(x, y, this.get(x, y) ? 0 : 1);
        return;
      case 'replace':
        this.set(x, y, value);
        return;
    }
  }

  clear(): void {
    this.data.fill(0);
  }

  fill(): void {
    this.data.fill(0xff);
    this.maskPadding();
  }

  /**
   * Fills an axis-aligned rectangle. Integer-exact and byte-wise in the
   * interior, which keeps large filled bars — the most common label element
   * after text — cheap.
   */
  fillRect(x: number, y: number, width: number, height: number, mode: DrawMode = 'or'): void {
    const x0 = Math.max(0, Math.trunc(x));
    const y0 = Math.max(0, Math.trunc(y));
    const x1 = Math.min(this.width, Math.trunc(x) + Math.trunc(width));
    const y1 = Math.min(this.height, Math.trunc(y) + Math.trunc(height));
    if (x1 <= x0 || y1 <= y0) return;

    for (let row = y0; row < y1; row++) {
      const rowStart = row * this.rowBytes;
      let col = x0;
      // Leading partial byte.
      while (col < x1 && (col & 7) !== 0) {
        this.put(col, row, 1, mode);
        col++;
      }
      // Whole bytes.
      while (col + 8 <= x1) {
        const index = rowStart + (col >> 3);
        switch (mode) {
          case 'or':
          case 'replace':
            this.data[index] = 0xff;
            break;
          case 'and':
            break; // ANDing with all-ones is a no-op
          case 'xor':
            this.data[index]! ^= 0xff;
            break;
        }
        col += 8;
      }
      // Trailing partial byte.
      while (col < x1) {
        this.put(col, row, 1, mode);
        col++;
      }
    }
  }

  /** Flips every dot inside a rectangle; the primitive behind ZPL ^FR. */
  invertRect(x: number, y: number, width: number, height: number): void {
    this.fillRect(x, y, width, height, 'xor');
  }

  invert(): void {
    for (let i = 0; i < this.data.length; i++) this.data[i] = ~this.data[i]! & 0xff;
    this.maskPadding();
  }

  clone(): Bitmap1 {
    return new Bitmap1(this.width, this.height, this.data.slice());
  }

  /** Copies out a sub-rectangle. Areas outside the source come back blank. */
  crop(x: number, y: number, width: number, height: number): Bitmap1 {
    const out = new Bitmap1(width, height);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        if (this.get(x + col, y + row)) out.set(col, row, 1);
      }
    }
    return out;
  }

  /** Returns a quarter-turn-rotated copy. Clockwise, as printers count it. */
  rotated(rotation: Rotation): Bitmap1 {
    if (rotation === 0) return this.clone();
    const swap = rotation === 90 || rotation === 270;
    const out = new Bitmap1(swap ? this.height : this.width, swap ? this.width : this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.get(x, y)) continue;
        switch (rotation) {
          case 90:
            out.set(this.height - 1 - y, x, 1);
            break;
          case 180:
            out.set(this.width - 1 - x, this.height - 1 - y, 1);
            break;
          case 270:
            out.set(y, this.width - 1 - x, 1);
            break;
        }
      }
    }
    return out;
  }

  /**
   * Composites `source` at (dx, dy).
   *
   * Under `or` only set dots are written, so a glyph run never punches a hole
   * in the artwork beneath it. Under `replace` the source rectangle is copied
   * wholesale, blank dots included.
   */
  blit(source: Bitmap1, dx: number, dy: number, mode: DrawMode = 'or'): void {
    const x0 = Math.max(0, -dx);
    const y0 = Math.max(0, -dy);
    const x1 = Math.min(source.width, this.width - dx);
    const y1 = Math.min(source.height, this.height - dy);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const value = source.get(x, y);
        if (value === 0 && (mode === 'or' || mode === 'xor')) continue;
        this.put(dx + x, dy + y, value, mode);
      }
    }
  }

  countSet(): number {
    let count = 0;
    for (const byte of this.data) {
      let b = byte;
      while (b !== 0) {
        count += b & 1;
        b >>= 1;
      }
    }
    return count;
  }

  equals(other: Bitmap1): boolean {
    if (this.width !== other.width || this.height !== other.height) return false;
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== other.data[i]) return false;
    }
    return true;
  }

  /** Debug aid: '#' for a burnt dot, '.' for blank. Used heavily by tests. */
  toAsciiArt(on = '#', off = '.'): string {
    const lines: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let line = '';
      for (let x = 0; x < this.width; x++) line += this.get(x, y) ? on : off;
      lines.push(line);
    }
    return lines.join('\n');
  }

  /** Builds a bitmap from ASCII art; the inverse of `toAsciiArt`, for tests. */
  static fromAsciiArt(art: string, on = '#'): Bitmap1 {
    const lines = art.split('\n').filter((line) => line.length > 0);
    const height = lines.length;
    const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
    const bitmap = new Bitmap1(width, height);
    lines.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) {
        if (line[x] === on) bitmap.set(x, y, 1);
      }
    });
    return bitmap;
  }

  /**
   * Clears the bits past `width` in each row.
   *
   * Padding bits are invisible but not harmless: they reach the printer inside
   * a graphic field, and they would make two visually identical bitmaps compare
   * unequal. Anything that writes whole bytes must call this.
   */
  private maskPadding(): void {
    const spare = this.rowBytes * 8 - this.width;
    if (spare === 0) return;
    const mask = (0xff << spare) & 0xff;
    for (let row = 0; row < this.height; row++) {
      const last = row * this.rowBytes + this.rowBytes - 1;
      this.data[last]! &= mask;
    }
  }
}
