/**
 * Barcode symbols as modules, not as pictures.
 *
 * An encoder's job ends at "these modules are bars"; turning modules into dots
 * is a separate, deliberately dumb step. The separation matters because module
 * width on a thermal printer is a whole number of dots — ZPL's ^BY and TSPL's
 * BARCODE both say so — and a symbol drawn at a fractional module width is not
 * a slightly worse barcode, it is an unscannable one.
 */

export type LinearSymbology =
  | 'code128'
  | 'code39'
  | 'itf'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce';

export interface QuietZone {
  readonly left: number;
  readonly right: number;
}

/** A run of human-readable text and the modules it sits under. */
export interface HriGroup {
  readonly text: string;
  /** First module of the span. Negative means inside the left quiet zone. */
  readonly startModule: number;
  /** One past the last module of the span. */
  readonly endModule: number;
}

export interface LinearSymbol {
  readonly symbology: LinearSymbology;
  /** One entry per module across the symbol; true is a bar. */
  readonly modules: readonly boolean[];
  /**
   * Blank margin the standard requires, in modules. EAN and UPC ask for
   * different amounts on each side, so this is a pair rather than one number.
   */
  readonly quietZone: QuietZone;
  /**
   * The data as actually encoded, including any check digit the encoder added.
   * This, not the caller's input, is what the human-readable line should show.
   */
  readonly text: string;
  /**
   * Modules whose bars run below the others. EAN and UPC guard bars do this,
   * and a scanner-legible symbol needs the space they leave for the digits.
   */
  readonly descenders?: readonly boolean[];
  /** How the human-readable line is split across the symbol, if it is. */
  readonly hri?: readonly HriGroup[];
}

/** Raised for input a symbology cannot represent. Message is user-facing. */
export class BarcodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BarcodeError';
  }
}

/**
 * Expands alternating bar/space run lengths into modules.
 *
 * Every 1D symbology in use is defined as such a run-length pattern, so this is
 * the one place that converts a standard's table into our representation.
 */
export function patternToModules(widths: readonly number[], startsWithBar = true): boolean[] {
  const modules: boolean[] = [];
  let isBar = startsWithBar;
  for (const width of widths) {
    for (let i = 0; i < width; i++) modules.push(isBar);
    isBar = !isBar;
  }
  return modules;
}

/** Reads a digit string, rejecting anything else with a clear message. */
export function requireDigits(value: string, symbology: string): number[] {
  const digits: number[] = [];
  for (const character of value) {
    const digit = character.codePointAt(0)! - 0x30;
    if (digit < 0 || digit > 9) {
      throw new BarcodeError(`${symbology} accepts digits only, found "${character}"`);
    }
    digits.push(digit);
  }
  return digits;
}
