import { describe, expect, it } from 'vitest';
import { Bitmap1 } from '../src/bitmap/Bitmap1.js';
import {
  drawLine,
  fillCircle,
  fillRectangle,
  roundedRectangle,
  strokeEllipse,
  strokeRectangle,
} from '../src/raster/primitives.js';

describe('rectangles', () => {
  it('strokes inward from the given rectangle', () => {
    const bitmap = new Bitmap1(6, 5);
    strokeRectangle(bitmap, 0, 0, 6, 5, { thickness: 1 });
    expect(bitmap.toAsciiArt()).toBe(
      ['######', '#....#', '#....#', '#....#', '######'].join('\n'),
    );
  });

  it('thickens inward without growing the footprint', () => {
    const bitmap = new Bitmap1(8, 6);
    strokeRectangle(bitmap, 0, 0, 8, 6, { thickness: 2 });
    expect(bitmap.toAsciiArt()).toBe(
      ['########', '########', '##....##', '##....##', '########', '########'].join('\n'),
    );
  });

  it('collapses to a solid box once the border meets in the middle', () => {
    const bitmap = new Bitmap1(6, 4);
    strokeRectangle(bitmap, 0, 0, 6, 4, { thickness: 3 });
    expect(bitmap.countSet()).toBe(24);
  });

  it('never draws a border thinner than one dot', () => {
    const bitmap = new Bitmap1(6, 5);
    strokeRectangle(bitmap, 0, 0, 6, 5, { thickness: 0 });
    expect(bitmap.get(0, 0)).toBe(1);
  });

  it('fills exactly', () => {
    const bitmap = new Bitmap1(6, 4);
    fillRectangle(bitmap, 1, 1, 4, 2);
    expect(bitmap.countSet()).toBe(8);
  });
});

describe('lines', () => {
  it('places a horizontal rule on exact dot rows', () => {
    const bitmap = new Bitmap1(8, 5);
    drawLine(bitmap, 0, 2, 8, 2, { thickness: 2 });
    expect(bitmap.toAsciiArt()).toBe(
      ['........', '########', '########', '........', '........'].join('\n'),
    );
  });

  it('places a vertical rule on exact dot columns', () => {
    const bitmap = new Bitmap1(5, 4);
    drawLine(bitmap, 2, 0, 2, 4, { thickness: 1 });
    expect(bitmap.toAsciiArt()).toBe(['..#..', '..#..', '..#..', '..#..'].join('\n'));
  });

  it('draws a diagonal that stays symmetric about its own centre', () => {
    const bitmap = new Bitmap1(16, 16);
    drawLine(bitmap, 0, 0, 16, 16, { thickness: 2 });
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        expect(bitmap.get(x, y)).toBe(bitmap.get(y, x));
      }
    }
    expect(bitmap.get(0, 0)).toBe(1);
    expect(bitmap.get(15, 15)).toBe(1);
    expect(bitmap.get(0, 15)).toBe(0);
  });
});

describe('curved shapes', () => {
  it('draws a circle symmetric in both axes', () => {
    const bitmap = new Bitmap1(20, 20);
    fillCircle(bitmap, 0, 0, 20);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        expect(bitmap.get(x, y)).toBe(bitmap.get(19 - x, y));
        expect(bitmap.get(x, y)).toBe(bitmap.get(x, 19 - y));
      }
    }
  });

  it('leaves the middle of a stroked ellipse empty', () => {
    const bitmap = new Bitmap1(30, 20);
    strokeEllipse(bitmap, 0, 0, 30, 20, { thickness: 2 });
    expect(bitmap.get(15, 10)).toBe(0);
    expect(bitmap.get(15, 0)).toBe(1);
    expect(bitmap.get(0, 10)).toBe(1);
  });

  it('rounds the corners of a box without touching its edges', () => {
    const bitmap = new Bitmap1(20, 20);
    roundedRectangle(bitmap, 0, 0, 20, 20, 6, { thickness: 1 });
    expect(bitmap.get(0, 0)).toBe(0); // corner cut away
    expect(bitmap.get(10, 0)).toBe(1); // top edge intact
    expect(bitmap.get(0, 10)).toBe(1); // left edge intact
    expect(bitmap.get(10, 10)).toBe(0); // hollow
  });
});
