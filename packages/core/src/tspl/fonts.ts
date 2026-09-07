import type { Font } from '../text/Font.js';
import type { SubstituteFonts } from '../text/substitutes.js';
import type { TextStyle } from '../text/text.js';

/**
 * TSPL's resident fonts, as cell sizes in dots at 203 dpi.
 *
 * These live in the printer's ROM as bitmaps and cannot be obtained as files,
 * so each is stood in for by a substitute face scaled to the same cell. The
 * cell is what matters for layout: a label that fits on screen fits on paper
 * because the character advance is identical, even though the letterforms are
 * not the printer's.
 */
export interface FontCell {
  readonly width: number;
  readonly height: number;
  readonly description: string;
}

export const INTERNAL_FONTS: Readonly<Record<string, FontCell>> = {
  '1': { width: 8, height: 12, description: '8 x 12 fixed pitch' },
  '2': { width: 12, height: 20, description: '12 x 20 fixed pitch' },
  '3': { width: 16, height: 24, description: '16 x 24 fixed pitch' },
  '4': { width: 24, height: 32, description: '24 x 32 fixed pitch' },
  '5': { width: 32, height: 48, description: '32 x 48 fixed pitch' },
  '6': { width: 14, height: 19, description: '14 x 19 OCR-B' },
  '7': { width: 21, height: 27, description: '21 x 27 OCR-B' },
  '8': { width: 14, height: 25, description: '14 x 25 OCR-A' },
};

/**
 * The substitute faces a renderer uses in place of the printer's ROM fonts.
 *
 * The same pair serves ZPL, whose scalable font is the same Triumvirate.
 */
export type TsplFontSet = SubstituteFonts;

/**
 * Em size that makes a face's line box exactly `cellHeight` dots tall.
 *
 * Printer cells are quoted as the whole character box, not as an em, so the
 * conversion has to go through the face's own ascent and descent or every
 * substituted line comes out the wrong size.
 */
export function emSizeForCell(font: Font, cellHeight: number): number {
  return (cellHeight * font.unitsPerEm) / (font.lineAscent + font.lineDescent);
}

export interface ResolvedFont {
  readonly style: TextStyle;
  /** Height of one line in dots, as the printer would advance it. */
  readonly lineHeight: number;
  readonly warning?: string;
}

/**
 * Turns a TSPL font name and its multipliers into a drawable style.
 *
 * Font "0" is scalable, and there the multipliers are the character height and
 * width in dots rather than integer multiples. The rest are fixed cells that
 * the multipliers enlarge whole times over.
 */
export function resolveFont(
  fonts: TsplFontSet,
  name: string,
  xMultiplier: number,
  yMultiplier: number,
): ResolvedFont {
  if (name === '0') {
    const height = Math.max(1, yMultiplier);
    return {
      style: {
        font: fonts.scalable,
        size: emSizeForCell(fonts.scalable, height),
        horizontalScale: xMultiplier > 0 ? xMultiplier / height : 1,
      },
      lineHeight: height,
    };
  }

  const cell = INTERNAL_FONTS[name];
  if (cell) {
    const cellHeight = cell.height * Math.max(1, yMultiplier);
    const cellWidth = cell.width * Math.max(1, xMultiplier);
    return {
      style: {
        font: fonts.fixed,
        size: emSizeForCell(fonts.fixed, cellHeight),
        fixedAdvance: cellWidth,
        fixedAdvanceAlign: 'center',
      },
      lineHeight: cellHeight,
    };
  }

  // A downloaded or TrueType font name: render with the scalable substitute at
  // the requested height and say so, rather than drop the text.
  const height = Math.max(1, yMultiplier);
  return {
    style: {
      font: fonts.scalable,
      size: emSizeForCell(fonts.scalable, height),
      horizontalScale: xMultiplier > 0 ? xMultiplier / height : 1,
    },
    lineHeight: height,
    warning:
      `Font "${name}" is not one of the printer's resident fonts. It is drawn with the ` +
      'substitute face at the requested height; the real widths will differ.',
  };
}
