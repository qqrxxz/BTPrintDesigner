import type { SubstituteFonts } from '../text/substitutes.js';
import { emSizeForCell } from '../tspl/fonts.js';
import type { TextStyle } from '../text/text.js';

/**
 * Zebra's resident fonts.
 *
 * A to H are bitmaps in ROM with the cells below, quoted in dots at 203 dpi;
 * P to V and 0 are scalable. `^A` asks for a height and a width in dots, which
 * the printer honours exactly for a scalable font and rounds to whole multiples
 * of the cell for a bitmap one.
 */
export interface ZplFontCell {
  readonly height: number;
  readonly width: number;
  readonly scalable: boolean;
}

export const ZPL_FONTS: Readonly<Record<string, ZplFontCell>> = {
  A: { height: 9, width: 5, scalable: false },
  B: { height: 11, width: 7, scalable: false },
  C: { height: 18, width: 10, scalable: false },
  D: { height: 18, width: 10, scalable: false },
  E: { height: 28, width: 15, scalable: false },
  F: { height: 26, width: 13, scalable: false },
  G: { height: 60, width: 40, scalable: false },
  H: { height: 21, width: 13, scalable: false },
  P: { height: 20, width: 18, scalable: true },
  Q: { height: 28, width: 24, scalable: true },
  R: { height: 35, width: 31, scalable: true },
  S: { height: 40, width: 35, scalable: true },
  T: { height: 48, width: 42, scalable: true },
  U: { height: 59, width: 53, scalable: true },
  V: { height: 80, width: 71, scalable: true },
  '0': { height: 15, width: 12, scalable: true },
};

export type ZplFontSet = SubstituteFonts;

export interface ResolvedZplFont {
  readonly style: TextStyle;
  /** Character cell height in dots, which is what a field advances by. */
  readonly lineHeight: number;
  readonly warning?: string;
}

/**
 * Turns a font name and the height and width `^A` asked for into a style.
 *
 * A bitmap font only comes in whole multiples of its cell, so asking for 14
 * dots from a 9 dot font gets 9, not 14 — rounding the request up would show
 * text the printer will not produce.
 */
export function resolveZplFont(
  fonts: ZplFontSet,
  name: string,
  height: number,
  width: number,
): ResolvedZplFont {
  const cell = ZPL_FONTS[name.toUpperCase()];

  if (!cell) {
    const requested = height > 0 ? height : 15;
    return {
      style: {
        font: fonts.scalable,
        size: emSizeForCell(fonts.scalable, requested),
        ...(width > 0 ? { horizontalScale: width / requested } : {}),
      },
      lineHeight: requested,
      warning:
        `Font "${name}" is not one of the printer's resident fonts. It is drawn with the ` +
        'substitute face at the requested height; the real widths will differ.',
    };
  }

  if (cell.scalable) {
    const requested = height > 0 ? height : cell.height;
    return {
      style: {
        font: fonts.scalable,
        size: emSizeForCell(fonts.scalable, requested),
        ...(width > 0 ? { horizontalScale: width / requested } : {}),
      },
      lineHeight: requested,
    };
  }

  // Bitmap fonts magnify by whole numbers only.
  const magnification = height > 0 ? Math.max(1, Math.floor(height / cell.height)) : 1;
  const widthMagnification =
    width > 0 ? Math.max(1, Math.floor(width / cell.width)) : magnification;
  const cellHeight = cell.height * magnification;
  const cellWidth = cell.width * widthMagnification;

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
