import type { Font } from './Font.js';

/**
 * The faces that stand in for a printer's resident fonts.
 *
 * Both TSPL and ZPL name a scalable font that is Monotype CG Triumvirate Bold
 * Condensed and a set of fixed-pitch bitmap fonts, none of which can be
 * obtained as files. One pair of substitutes therefore serves both languages:
 * character advance comes out right, letterforms do not, and that is the trade
 * this project makes everywhere.
 */
export interface SubstituteFonts {
  /** Stands in for the scalable font: ZPL's font 0, TSPL's font "0". */
  readonly scalable: Font;
  /** Stands in for the fixed-pitch bitmap fonts. */
  readonly fixed: Font;
}
