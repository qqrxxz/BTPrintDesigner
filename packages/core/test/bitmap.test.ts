import { describe, expect, it } from 'vitest';
import { Bitmap1 } from '../src/bitmap/Bitmap1.js';

describe('Bitmap1 packing', () => {
  it('packs rows MSB first into whole bytes', () => {
    const bitmap = new Bitmap1(12, 2);
    bitmap.set(0, 0, 1);
    bitmap.set(7, 0, 1);
    bitmap.set(8, 0, 1);
    expect(bitmap.rowBytes).toBe(2);
    expect(bitmap.data[0]).toBe(0b1000_0001);
    expect(bitmap.data[1]).toBe(0b1000_0000);
  });

  it('reads outside the bitmap as blank instead of wrapping', () => {
    const bitmap = new Bitmap1(8, 8);
    bitmap.set(0, 1, 1);
    expect(bitmap.get(8, 0)).toBe(0);
    expect(bitmap.get(-1, 1)).toBe(0);
  });

  it('drops writes outside the bitmap', () => {
    const bitmap = new Bitmap1(8, 8);
    bitmap.set(-1, 0, 1);
    bitmap.set(8, 0, 1);
    bitmap.set(0, 8, 1);
    expect(bitmap.countSet()).toBe(0);
  });

  it('rejects packed data of the wrong length', () => {
    expect(() => new Bitmap1(9, 1, new Uint8Array(1))).toThrow(/expected 2/);
  });
});

describe('Bitmap1 fillRect', () => {
  it('fills exactly the requested rectangle', () => {
    const bitmap = new Bitmap1(8, 4);
    bitmap.fillRect(2, 1, 3, 2);
    expect(bitmap.toAsciiArt()).toBe(
      ['........', '..###...', '..###...', '........'].join('\n'),
    );
  });

  it('agrees with itself across the byte-aligned fast path', () => {
    const wide = new Bitmap1(40, 1);
    wide.fillRect(3, 0, 30, 1);
    const reference = new Bitmap1(40, 1);
    for (let x = 3; x < 33; x++) reference.set(x, 0, 1);
    expect(wide.equals(reference)).toBe(true);
  });

  it('clips rather than throwing', () => {
    const bitmap = new Bitmap1(8, 4);
    bitmap.fillRect(-4, -4, 8, 8);
    expect(bitmap.toAsciiArt()).toBe(
      ['####....', '####....', '####....', '####....'].join('\n'),
    );
  });

  it('inverts under xor, which is how field reverse works', () => {
    const bitmap = new Bitmap1(8, 2);
    bitmap.fillRect(0, 0, 8, 2);
    bitmap.invertRect(2, 0, 4, 1);
    expect(bitmap.toAsciiArt()).toBe(['##....##', '########'].join('\n'));
  });
});

describe('Bitmap1 whole-byte writes keep padding clean', () => {
  it('leaves no ink in the padding bits after invert', () => {
    const bitmap = new Bitmap1(12, 1);
    bitmap.invert();
    expect(bitmap.countSet()).toBe(12);
    expect(bitmap.data[1]).toBe(0b1111_0000);
  });

  it('fills only the declared width', () => {
    const bitmap = new Bitmap1(12, 1);
    bitmap.fill();
    expect(bitmap.countSet()).toBe(12);
  });
});

describe('Bitmap1 transforms', () => {
  const source = Bitmap1.fromAsciiArt(['###.', '#...', '#...'].join('\n'));

  it('round-trips through ASCII art', () => {
    expect(Bitmap1.fromAsciiArt(source.toAsciiArt()).equals(source)).toBe(true);
  });

  it('rotates a quarter turn clockwise', () => {
    expect(source.rotated(90).toAsciiArt()).toBe(['###', '..#', '..#', '...'].join('\n'));
  });

  it('returns to the original after four quarter turns', () => {
    expect(source.rotated(90).rotated(90).rotated(90).rotated(90).equals(source)).toBe(true);
  });

  it('blits without erasing what is underneath in or mode', () => {
    const target = Bitmap1.fromAsciiArt(['....', '....', '..##'].join('\n'));
    target.blit(Bitmap1.fromAsciiArt(['#.', '..'].join('\n')), 0, 1);
    expect(target.toAsciiArt()).toBe(['....', '#...', '..##'].join('\n'));
  });

  it('copies blanks too in replace mode', () => {
    const target = Bitmap1.fromAsciiArt(['####', '####'].join('\n'));
    target.blit(Bitmap1.fromAsciiArt(['..', '..'].join('\n')), 1, 0, 'replace');
    expect(target.toAsciiArt()).toBe(['#..#', '#..#'].join('\n'));
  });

  it('clips a blit that hangs off the edge', () => {
    const target = new Bitmap1(4, 2);
    target.blit(Bitmap1.fromAsciiArt(['##', '##'].join('\n')), 3, 1);
    expect(target.toAsciiArt()).toBe(['....', '...#'].join('\n'));
  });
});
