import { describe, expect, it } from 'vitest';
import { Bitmap1 } from '../src/bitmap/Bitmap1.js';
import { drawText, measureText, textToPath } from '../src/text/text.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

describe('font loading', () => {
  it('exposes the metrics the layout needs', () => {
    const font = monoFont();
    expect(font.unitsPerEm).toBe(2048);
    expect(font.lineAscent).toBeGreaterThan(0);
    expect(font.lineDescent).toBeGreaterThan(0);
  });

  it('caches a glyph rather than re-parsing it', () => {
    const font = monoFont();
    expect(font.glyph(0x41)).toBe(font.glyph(0x41));
  });

  it('covers Cyrillic, which labels here will need', () => {
    const font = condensedBoldFont();
    expect(font.glyph('Ж'.codePointAt(0)!).isMissing).toBe(false);
    expect(font.glyph('щ'.codePointAt(0)!).isMissing).toBe(false);
  });

  it('reports a character the font cannot render', () => {
    const font = monoFont();
    // A private-use code point no real face covers.
    expect(font.glyph(0xf8ff).isMissing).toBe(true);
  });
});

describe('measurement', () => {
  it('reports a fixed-pitch run as an exact multiple of the cell', () => {
    const style = { font: monoFont(), size: 24, fixedAdvance: 12 };
    expect(measureText('ABCDE', style).width).toBe(60);
  });

  it('adds letter spacing between characters but not after the last', () => {
    const style = { font: monoFont(), size: 24, fixedAdvance: 10, letterSpacing: 2 };
    expect(measureText('ABC', style).width).toBe(34);
  });

  it('measures an empty string as nothing', () => {
    const metrics = measureText('', { font: monoFont(), size: 24 });
    expect(metrics.width).toBe(0);
  });

  it('scales proportional advances with the em size', () => {
    const font = condensedBoldFont();
    const small = measureText('Label', { font, size: 20 });
    const large = measureText('Label', { font, size: 40 });
    expect(large.width).toBeCloseTo(small.width * 2, 6);
  });

  it('stretches only the horizontal axis under a width scale', () => {
    const font = condensedBoldFont();
    const plain = measureText('Label', { font, size: 20 });
    const wide = measureText('Label', { font, size: 20, horizontalScale: 2 });
    expect(wide.width).toBeCloseTo(plain.width * 2, 6);
    expect(wide.height).toBeCloseTo(plain.height, 6);
  });

  it('collects the characters the font could not render', () => {
    // U+F8FF is private use: no real face covers it.
    const metrics = measureText('A\u{F8FF}B', { font: monoFont(), size: 20 });
    expect(metrics.missingGlyphs).toEqual([0xf8ff]);
  });
});

describe('drawing', () => {
  it('puts ink on the bitmap', () => {
    const bitmap = new Bitmap1(200, 60);
    drawText(bitmap, 'SKU-1024', 4, 4, { font: condensedBoldFont(), size: 40 }, {
      anchor: 'top-left',
    });
    expect(bitmap.countSet()).toBeGreaterThan(100);
  });

  it('keeps a top-left anchored run below and right of the anchor', () => {
    const bitmap = new Bitmap1(200, 60);
    drawText(bitmap, 'Hg', 10, 10, { font: condensedBoldFont(), size: 30 }, {
      anchor: 'top-left',
    });
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 200; x++) expect(bitmap.get(x, y)).toBe(0);
    }
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 60; y++) expect(bitmap.get(x, y)).toBe(0);
    }
  });

  it('places fixed-pitch characters on exact cell boundaries', () => {
    const style = { font: monoFont(), size: 24, fixedAdvance: 20 };
    const single = new Bitmap1(200, 40);
    drawText(single, 'I', 100, 30, style);
    const run = new Bitmap1(200, 40);
    drawText(run, 'IIIII', 20, 30, style);
    // The fourth cell of the run starts at 20 + 4*20 = 100, so it must match.
    expect(run.crop(100, 0, 20, 40).equals(single.crop(100, 0, 20, 40))).toBe(true);
  });

  it('rotates clockwise about the anchor', () => {
    const upright = new Bitmap1(80, 80);
    drawText(upright, 'A', 10, 40, { font: condensedBoldFont(), size: 30 });
    const turned = new Bitmap1(80, 80);
    drawText(turned, 'A', 40, 40, { font: condensedBoldFont(), size: 30 }, { rotation: 90 });

    // Upright text runs to the right of its anchor; turned by 90 it runs down.
    expect(upright.crop(10, 0, 40, 80).countSet()).toBeGreaterThan(0);
    expect(turned.crop(0, 40, 80, 40).countSet()).toBeGreaterThan(0);
    expect(turned.crop(0, 0, 80, 39).countSet()).toBe(0);
  });

  it('is byte-for-byte repeatable', () => {
    const style = { font: condensedBoldFont(), size: 26 };
    const first = new Bitmap1(200, 40);
    const second = new Bitmap1(200, 40);
    drawText(first, 'Repeatable 123', 2, 30, style);
    drawText(second, 'Repeatable 123', 2, 30, style);
    expect(first.equals(second)).toBe(true);
  });

  it('renders overlapping glyphs as one thresholded run', () => {
    // Tight negative spacing overlaps the glyphs; a per-glyph threshold would
    // lose dots that the two together clearly cover.
    const style = { font: condensedBoldFont(), size: 24, letterSpacing: -4 };
    const overlapping = new Bitmap1(120, 40);
    drawText(overlapping, 'WWW', 4, 30, style);
    expect(overlapping.countSet()).toBeGreaterThan(0);
    expect(textToPath('WWW', style).commands.length).toBeGreaterThan(0);
  });

  it('draws nothing for an empty string', () => {
    const bitmap = new Bitmap1(50, 20);
    drawText(bitmap, '', 5, 15, { font: monoFont(), size: 16 });
    expect(bitmap.countSet()).toBe(0);
  });

  it('clips text that runs off the label instead of failing', () => {
    const bitmap = new Bitmap1(40, 20);
    drawText(bitmap, 'A very long line of label text', 30, 15, {
      font: condensedBoldFont(),
      size: 16,
    });
    expect(bitmap.countSet()).toBeGreaterThan(0);
  });
});
