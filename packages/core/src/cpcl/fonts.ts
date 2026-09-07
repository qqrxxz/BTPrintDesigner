import type { SubstituteFonts } from '../text/substitutes.js';
import { emSizeForCell } from '../tspl/fonts.js';
import type { TextStyle } from '../text/text.js';

/**
 * CPCL's resident fonts.
 *
 * This is the least certain font table in the project, and it is deliberately
 * open to correction. CPCL names a font and a size index rather than a height,
 * and the heights those indices stand for vary between printer families; there
 * is no public renderer to check against the way Labelary checks ZPL. The
 * ladder below is a reasonable default, not a measurement, and a caller with a
 * printer on the desk can replace it.
 *
 * One rule saves most real files from the table entirely: a size of nine or
 * more is taken as a height in dots, which is how the scalable fonts are used.
 */
export type CpclFontSet = SubstituteFonts;

/** Heights in dots for size indices 0 to 8, at 203 dpi. */
export const DEFAULT_SIZE_LADDER: readonly number[] = [12, 16, 20, 24, 28, 36, 48, 64, 80];

/** The size at and above which the parameter is read as dots, not an index. */
export const SIZE_IS_HEIGHT_FROM = 9;

export interface CpclFontOptions {
  /**
   * Overrides the ladder, per font name or under `default`.
   *
   * Correcting this against a real printer is the intended way to make CPCL
   * previews exact, and it needs no change to the code.
   */
  readonly sizeLadders?: Readonly<Record<string, readonly number[]>>;
}

export interface ResolvedCpclFont {
  readonly style: TextStyle;
  readonly lineHeight: number;
  readonly approximate: boolean;
}

/**
 * Turns a font name, a size and the current magnification into a style.
 *
 * `SETMAG` multiplies whole times over, as it does on the printer, so a
 * magnified line is exactly twice or three times the cell and never something
 * in between.
 */
export function resolveCpclFont(
  fonts: CpclFontSet,
  name: string,
  size: number,
  magnification: { x: number; y: number },
  options: CpclFontOptions = {},
): ResolvedCpclFont {
  const ladder = options.sizeLadders?.[name] ?? options.sizeLadders?.['default'] ?? DEFAULT_SIZE_LADDER;

  const fromLadder = size < SIZE_IS_HEIGHT_FROM;
  const base = fromLadder ? (ladder[Math.max(0, Math.round(size))] ?? ladder.at(-1)!) : size;

  const height = Math.max(1, base * Math.max(1, magnification.y));
  const widthScale = Math.max(1, magnification.x) / Math.max(1, magnification.y);

  return {
    style: {
      font: fonts.scalable,
      size: emSizeForCell(fonts.scalable, height),
      ...(widthScale === 1 ? {} : { horizontalScale: widthScale }),
    },
    lineHeight: height,
    approximate: fromLadder,
  };
}
