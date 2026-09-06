import type { Bitmap1, DrawMode, Rotation } from '../bitmap/Bitmap1.js';
import { fillPath, type FillOptions } from '../raster/fill.js';
import { Path } from '../raster/Path.js';
import { compose, rotation, scaling, translation } from '../util/geometry.js';
import type { Font } from './Font.js';

export interface TextStyle {
  readonly font: Font;
  /** Em size in dots. The vertical scale of the outlines. */
  readonly size: number;
  /**
   * Fixed pitch in dots.
   *
   * Resident printer fonts are monospaced cells, not proportional type. Setting
   * this makes every character advance the same distance regardless of shape,
   * which is what makes a substituted outline font line up column-for-column
   * with what the printer will actually lay down.
   */
  readonly fixedAdvance?: number;
  /** Where a glyph sits inside its fixed-pitch cell. */
  readonly fixedAdvanceAlign?: 'left' | 'center';
  /** Extra dots inserted after every character. */
  readonly letterSpacing?: number;
  /** Horizontal stretch, as ZPL's independent width magnification allows. */
  readonly horizontalScale?: number;
}

export type TextAnchor = 'baseline-left' | 'top-left';

export interface DrawTextOptions extends FillOptions {
  readonly rotation?: Rotation;
  readonly anchor?: TextAnchor;
}

export interface TextMetrics {
  /** Total advance of the run in dots, letter spacing included. */
  readonly width: number;
  readonly ascent: number;
  /** Positive distance below the baseline. */
  readonly descent: number;
  readonly height: number;
  /** Code points the font could not render, in order of appearance. */
  readonly missingGlyphs: readonly number[];
}

interface Scales {
  readonly sx: number;
  readonly sy: number;
}

function scalesFor(style: TextStyle): Scales {
  const sy = style.size / style.font.unitsPerEm;
  return { sx: sy * (style.horizontalScale ?? 1), sy };
}

function codePoints(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0)!);
}

export function measureText(text: string, style: TextStyle): TextMetrics {
  const { sx, sy } = scalesFor(style);
  const letterSpacing = style.letterSpacing ?? 0;
  const missingGlyphs: number[] = [];
  let width = 0;

  for (const codePoint of codePoints(text)) {
    const glyph = style.font.glyph(codePoint);
    if (glyph.isMissing) missingGlyphs.push(codePoint);
    width += style.fixedAdvance ?? glyph.advanceWidth * sx;
    width += letterSpacing;
  }
  if (text.length > 0) width -= letterSpacing; // No trailing gap after the run.

  const ascent = style.font.lineAscent * sy;
  const descent = style.font.lineDescent * sy;
  return { width, ascent, descent, height: ascent + descent, missingGlyphs };
}

/**
 * Builds the outline of a run of text with its baseline start at the origin.
 *
 * The whole run becomes a single path so that it is thresholded in one pass:
 * rasterising glyph by glyph would let two overlapping glyphs each land at 40%
 * coverage and both vanish, where together they clearly cover the dot.
 */
export function textToPath(text: string, style: TextStyle): Path {
  const { sx, sy } = scalesFor(style);
  const letterSpacing = style.letterSpacing ?? 0;
  const centred = style.fixedAdvanceAlign === 'center';
  const run = new Path();
  let pen = 0;

  for (const codePoint of codePoints(text)) {
    const glyph = style.font.glyph(codePoint);
    const advance = style.fixedAdvance ?? glyph.advanceWidth * sx;

    let offset = pen;
    if (style.fixedAdvance !== undefined && centred) {
      offset += (style.fixedAdvance - glyph.advanceWidth * sx) / 2;
    }

    if (!glyph.path.isEmpty) {
      run.append(glyph.path.transform(compose(scaling(sx, sy), translation(offset, 0))));
    }
    pen += advance + letterSpacing;
  }
  return run;
}

/**
 * Draws a single line of text.
 *
 * `x`/`y` is the anchor point and stays fixed under rotation, which is how both
 * ZPL and TSPL position rotated fields: the origin does not move, the text
 * turns around it clockwise.
 */
export function drawText(
  target: Bitmap1,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  options: DrawTextOptions = {},
): TextMetrics {
  const metrics = measureText(text, style);
  if (text.length === 0) return metrics;

  const path = textToPath(text, style);
  const anchorShift =
    (options.anchor ?? 'baseline-left') === 'top-left'
      ? translation(0, metrics.ascent)
      : translation(0, 0);
  const turn = rotation(((options.rotation ?? 0) * Math.PI) / 180);
  const placed = path.transform(compose(anchorShift, turn, translation(x, y)));

  fillPath(target, placed, options);
  return metrics;
}

/** Convenience for callers that only need the draw mode. */
export function drawTextWithMode(
  target: Bitmap1,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  mode: DrawMode,
): TextMetrics {
  return drawText(target, text, x, y, style, { mode });
}
