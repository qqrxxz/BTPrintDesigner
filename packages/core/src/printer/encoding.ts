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
 * TSPL says `CODEPAGE 1251`, ZPL says `^CI28` for Unicode, and CPCL says
 * `ENCODING UTF-8`. Anything else is silence, and silence is not a declaration
 * of UTF-8 — it is a reason to ask the person who knows the printer.
 */
export function declaredEncoding(source: string): TextEncoding | undefined {
  const codepage = /^[ \t]*CODEPAGE[ \t]+([A-Za-z0-9-]+)/im.exec(source);
  if (codepage) {
    const page = codepage[1]!.toUpperCase();
    if (page === '1251' || page === 'WINDOWS-1251' || page === 'CP1251') return 'windows-1251';
    if (page === 'UTF-8' || page === 'UTF8') return 'utf-8';
  }

  // ^CI28 is Zebra's "the field data is UTF-8"; the lower numbers are the
  // single-byte pages, of which 1251 is not one this program can name.
  if (/\^CI28\b/i.test(source)) return 'utf-8';

  const encoding = /^[ \t]*ENCODING[ \t]+([A-Za-z0-9-]+)/im.exec(source);
  if (encoding) {
    const name = encoding[1]!.toUpperCase();
    if (name === 'UTF-8' || name === 'UTF8') return 'utf-8';
    if (name === '1251' || name === 'WINDOWS-1251' || name === 'CP1251') return 'windows-1251';
  }
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
