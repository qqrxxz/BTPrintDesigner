/**
 * The GS1 separator, and the several ways of writing it.
 *
 * Between two application identifiers of variable length GS1 wants ASCII 29,
 * the group separator. It cannot be typed, so every printer and every piece of
 * middleware spells it with a token of its own — `~1`, `_1`, `~d029`, `~]` —
 * and which one arrives at the printer is a property of the setup rather than
 * of the design. The element therefore records which token its data uses; the
 * file keeps the token, because that is what the printer reads, and everything
 * that has to encode the symbol reads the token as the character it stands for.
 */
import { GROUP_SEPARATOR, type Gs1Separator } from './document.js';

/** The data with its separator tokens turned into the character itself. */
export function applyGs1Separator(data: string, separator: Gs1Separator | undefined): string {
  if (separator === undefined || separator === 'none') return data;
  return data.split(separator).join(GROUP_SEPARATOR);
}

/** True for the symbologies that carry application identifiers. */
export function isGs1(symbology: string): boolean {
  return symbology === 'gs1-datamatrix' || symbology === 'gs1-128';
}
