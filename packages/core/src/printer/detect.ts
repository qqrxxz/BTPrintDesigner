/**
 * Which language a file of printer code is written in.
 *
 * Extensions do not answer this — the same vendor ships `.prn` files in three
 * languages and calls a TSPL file `.prq` — so the answer comes from the code
 * itself. The three languages start in unmistakable ways: ZPL opens a format
 * with `^XA`, CPCL opens a label with `!`, and TSPL is a list of commands
 * beginning with words like SIZE and CLS.
 *
 * Nothing is guessed. A file in a language this program does not speak — Godex
 * EZPL, Honeywell Fingerprint — comes back as undefined, which is a better
 * answer than a TSPL reading of it and forty complaints.
 */
import type { PrinterLanguage } from './profiles.js';

/** Commands that only ever appear in a TSPL file. */
const TSPL_COMMANDS =
  /^[ \t]*(SIZE|GAP|CLS|DIRECTION|BLINE|OFFSET|SPEED|DENSITY|CODEPAGE|TEXT|BLOCK|BARCODE|QRCODE|DMATRIX|PDF417|BAR|BOX|ERASE|REVERSE|PUTBMP|DOWNLOAD|SET|LIMITFEED|SHIFT)\b/im;

/** CPCL's own: a label opens with "! offset x y height quantity". */
const CPCL_HEADER = /^[ \t]*!\s*(\d|UTILITIES\b)/im;

export function detectLanguage(source: string): PrinterLanguage | undefined {
  // ^XA is the one thing every ZPL format has, and no other language uses it.
  // Godex EZPL also leads with carets, which is why the test is this and not
  // "starts with a caret".
  if (/\^XA\b/i.test(source)) return 'zpl';
  if (CPCL_HEADER.test(source)) return 'cpcl';
  if (TSPL_COMMANDS.test(source)) return 'tspl';
  return undefined;
}

/**
 * True when this text is a project file rather than printer code.
 *
 * Project files are JSON and carry a version; anything else that happens to be
 * JSON is not one, and saying so early is better than a parser's complaint.
 */
export function isProjectFile(source: string): boolean {
  const start = source.trimStart();
  if (!start.startsWith('{')) return false;
  try {
    const value: unknown = JSON.parse(start);
    return typeof value === 'object' && value !== null && 'version' in value;
  } catch {
    return false;
  }
}
