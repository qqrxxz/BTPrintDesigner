import { describe, expect, it } from 'vitest';
import { CoverageAccumulator } from '../src/raster/CoverageAccumulator.js';
import { Path } from '../src/raster/Path.js';
import { rasterizePath } from '../src/raster/fill.js';

function rectanglePath(x: number, y: number, w: number, h: number, reverse = false): Path {
  const path = new Path();
  if (!reverse) {
    path.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).close();
  } else {
    path.moveTo(x, y).lineTo(x, y + h).lineTo(x + w, y + h).lineTo(x + w, y).close();
  }
  return path;
}

function coverageOf(path: Path, width: number, height: number): Float32Array {
  const accumulator = new CoverageAccumulator(width, height);
  path.flatten(0.01, (from, to) => accumulator.addEdge(from.x, from.y, to.x, to.y));
  return accumulator.coverage();
}

describe('coverage accumulation', () => {
  it('gives a dot-aligned rectangle full coverage and nothing else', () => {
    const coverage = coverageOf(rectanglePath(1, 1, 2, 1), 4, 3);
    expect(Array.from(coverage, (c) => Math.round(c * 100))).toEqual([
      0, 0, 0, 0,
      0, 100, 100, 0,
      0, 0, 0, 0,
    ]);
  });

  it('reports partial coverage exactly for a half-covered dot', () => {
    const coverage = coverageOf(rectanglePath(0, 0, 0.5, 1), 2, 1);
    expect(coverage[0]).toBeCloseTo(0.5, 5);
    expect(coverage[1]).toBeCloseTo(0, 5);
  });

  it('splits coverage across a dot boundary', () => {
    const coverage = coverageOf(rectanglePath(0.75, 0, 0.5, 1), 2, 1);
    expect(coverage[0]).toBeCloseTo(0.25, 5);
    expect(coverage[1]).toBeCloseTo(0.25, 5);
  });

  it('subtracts a counter-wound contour, leaving a hole', () => {
    const path = rectanglePath(0, 0, 4, 4);
    path.append(rectanglePath(1, 1, 2, 2, true));
    const bitmap = rasterizePath(path, 4, 4);
    expect(bitmap.toAsciiArt()).toBe(['####', '#..#', '#..#', '####'].join('\n'));
  });

  it('keeps geometry left of the bitmap in the winding', () => {
    // A rectangle starting far off the left edge must still fill what is visible.
    const bitmap = rasterizePath(rectanglePath(-100, 0, 102, 2), 4, 2);
    expect(bitmap.toAsciiArt()).toBe(['##..', '##..'].join('\n'));
  });

  it('ignores geometry entirely right of the bitmap', () => {
    const bitmap = rasterizePath(rectanglePath(50, 0, 10, 2), 4, 2);
    expect(bitmap.countSet()).toBe(0);
  });

  it('does not bleed a clipped path into the next row', () => {
    // A shape clipped by the right edge leaves residue in the row it was cut
    // from; that residue must not survive into the row below.
    const bitmap = rasterizePath(rectanglePath(2, 0, 100, 1), 4, 3);
    expect(bitmap.toAsciiArt()).toBe(['..##', '....', '....'].join('\n'));
  });

  it('survives a path far outside the bitmap without huge loops', () => {
    const started = Date.now();
    const bitmap = rasterizePath(rectanglePath(-1e6, -1e6, 2e6, 2e6), 8, 8);
    expect(bitmap.countSet()).toBe(64);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('thresholding', () => {
  it('drops a bar too thin for the printer to burn', () => {
    const bitmap = rasterizePath(rectanglePath(0, 0, 0.4, 2), 2, 2);
    expect(bitmap.countSet()).toBe(0);
  });

  it('burns a bar that covers most of the dot', () => {
    const bitmap = rasterizePath(rectanglePath(0, 0, 0.6, 2), 2, 2);
    expect(bitmap.toAsciiArt()).toBe(['#.', '#.'].join('\n'));
  });

  it('respects a custom threshold', () => {
    const path = rectanglePath(0, 0, 0.4, 1);
    expect(rasterizePath(path, 2, 1, { threshold: 0.3 }).countSet()).toBe(1);
    expect(rasterizePath(path, 2, 1, { threshold: 0.5 }).countSet()).toBe(0);
  });
});

describe('curve flattening', () => {
  it('closes an unclosed subpath instead of smearing the row', () => {
    const open = new Path().moveTo(0, 0).lineTo(4, 0).lineTo(4, 4).lineTo(0, 4);
    const bitmap = rasterizePath(open, 4, 4);
    expect(bitmap.countSet()).toBe(16);
  });

  it('produces a symmetric circle', () => {
    const path = new Path();
    const r = 8;
    const steps = 256;
    path.moveTo(8 + r, 8);
    for (let i = 1; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      path.lineTo(8 + r * Math.cos(angle), 8 + r * Math.sin(angle));
    }
    path.close();
    const bitmap = rasterizePath(path, 16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(bitmap.get(x, y)).toBe(bitmap.get(15 - x, y));
        expect(bitmap.get(x, y)).toBe(bitmap.get(x, 15 - y));
      }
    }
  });
});
