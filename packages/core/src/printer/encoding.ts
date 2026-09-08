/**
 * The bytes a printer file is written in.
 *
 * A label file is text, but which text: a TSC printer told `CODEPAGE 1251`
 * expects the bytes of Windows-1251, and handing it UTF-8 prints mojibake on the
 * label. The code itself usually says which — that is what `CODEPAGE`,
 * `^CI` and CPCL's `ENCODING` are for — so the default is to believe it.
 */

export type TextEncoding = 'utf-8' | 'windows-1251';

/** What a document asks for, where `auto` means "whatever the code declares". */
export type EncodingChoice = 'auto' | TextEncoding;

export const ENCODING_CHOICES: readonly EncodingChoice[] = ['auto', 'utf-8', 'windows-1251'];

/**
 * The encoding the code declares, if it declares one.
 *
 * TSPL says `CODEPAGE 1251`, ZPL says `^CI28` for UTF-8 and `^CI33` for
 * Windows-1251, and CPCL says `ENCODING UTF-8`. Anything else is silence, and silence is not a declaration
 * of UTF-8 — it is a reason to ask the person who knows the printer.
 */
export function declaredEncoding(source: string): TextEncoding | undefined {
  // A file carries the declaration its own language uses. A ZPL job that still
  // has a TSPL preamble in it — a design retargeted from one printer to the
  // other — would otherwise be read by the line that no longer applies to it.
  const readers = /\^XA\b/i.test(source)
    ? [zebraCharacterSet, codePage, encodingCommand]
    : [codePage, zebraCharacterSet, encodingCommand];
  for (const reader of readers) {
    const found = reader(source);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** TSPL: `CODEPAGE 1251`. */
function codePage(source: string): TextEncoding | undefined {
  const match = /^[ \t]*CODEPAGE[ \t]+([A-Za-z0-9-]+)/im.exec(source);
  return match === undefined || match === null ? undefined : named(match[1]!);
}

/** ZPL: `^CI28` is UTF-8, `^CI33` is Windows-1251. */
function zebraCharacterSet(source: string): TextEncoding | undefined {
  if (/\^CI28\b/i.test(source)) return 'utf-8';
  if (/\^CI33\b/i.test(source)) return 'windows-1251';
  return undefined;
}

/** CPCL: `ENCODING UTF-8`. */
function encodingCommand(source: string): TextEncoding | undefined {
  const match = /^[ \t]*ENCODING[ \t]+([A-Za-z0-9-]+)/im.exec(source);
  return match === null ? undefined : named(match[1]!);
}

function named(page: string): TextEncoding | undefined {
  const name = page.toUpperCase();
  if (name === '1251' || name === 'WINDOWS-1251' || name === 'CP1251') return 'windows-1251';
  if (name === 'UTF-8' || name === 'UTF8') return 'utf-8';
  return undefined;
}

/** The encoding to write with, given the document's choice and the code. */
export function resolveEncoding(choice: EncodingChoice | undefined, source: string): TextEncoding {
  if (choice !== undefined && choice !== 'auto') return choice;
  return declaredEncoding(source) ?? 'utf-8';
}

/**
 * Windows-1251, as a character to byte map.
 *
 * Built by asking the platform's decoder what each byte means, so the table is
 * the platform's own rather than 128 lines of magic numbers typed by hand.
 */
let cp1251: Map<string, number> | undefined;

function windows1251Table(): Map<string, number> {
  if (cp1251) return cp1251;
  const decoder = new TextDecoder('windows-1251');
  const table = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++) {
    const character = decoder.decode(new Uint8Array([byte]));
    // A byte with no character of its own decodes to the replacement.
    if (character !== '�' && !table.has(character)) table.set(character, byte);
  }
  cp1251 = table;
  return table;
}

export interface EncodedText {
  readonly bytes: Uint8Array;
  /** Characters the encoding has no byte for, each once, in order. */
  readonly unsupported: readonly string[];
}

/**
 * The text as bytes.
 *
 * A character Windows-1251 cannot hold becomes a question mark, and is named:
 * silently dropping it would print a label nobody could explain.
 */
export function encodeText(text: string, encoding: TextEncoding): EncodedText {
  if (encoding === 'utf-8') {
    return { bytes: new TextEncoder().encode(text), unsupported: [] };
  }

  const table = windows1251Table();
  const bytes = new Uint8Array(text.length);
  const unsupported: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    const byte = table.get(character);
    if (byte === undefined) {
      bytes[i] = 0x3f; // '?'
      if (!unsupported.includes(character)) unsupported.push(character);
    } else {
      bytes[i] = byte;
    }
  }
  return { bytes, unsupported };
}
