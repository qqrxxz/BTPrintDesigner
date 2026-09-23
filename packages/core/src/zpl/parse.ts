import type { Diagnostic, SourceSpan } from '../tspl/parse.js';

/**
 * ZPL II parser.
 *
 * ZPL is not line-oriented the way TSPL is: commands run together in a stream,
 * a caret or a tilde starts each one, and everything up to the next prefix
 * belongs to the command before it. Real files arrive both as one long line and
 * as one command per line, so the parser ignores line structure entirely and
 * works from the prefixes.
 *
 * Like the TSPL parser it never throws. Positions travel with every command so
 * an editor can point at the offending characters.
 */

export type ZplPrefix = '^' | '~';

export interface ZplCommand {
  /** Two letters, upper-cased, except the one-letter font command `^A`. */
  readonly name: string;
  readonly prefix: ZplPrefix;
  /** Raw parameter strings, split on commas, with the empty ones kept. */
  readonly parameters: readonly string[];
  /** The command as written, for round-tripping what the model cannot hold. */
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface ZplParseResult {
  readonly commands: readonly ZplCommand[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Commands whose parameter is one lump of text, not a comma-separated list.
 *
 * Field data routinely contains commas — an address, a price, a date — and
 * splitting it would corrupt exactly the part of the label that carries meaning.
 */
const RAW_PARAMETER = new Set(['FD', 'FX', 'FV', 'FH', 'CT', 'CC', 'CD']);

/** The font command is the one that is a single letter followed by its font. */
const SINGLE_LETTER = new Set(['A']);

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '\n') {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

export function parseZpl(source: string): ZplParseResult {
  const commands: ZplCommand[] = [];
  const diagnostics: Diagnostic[] = [];

  let index = 0;
  // Anything before the first prefix is noise a printer would ignore, but a
  // person deserves to be told about it rather than have it vanish.
  const firstPrefix = source.search(/[\^~]/);
  if (firstPrefix > 0 && source.slice(0, firstPrefix).trim().length > 0) {
    const at = lineAndColumn(source, 0);
    diagnostics.push({
      severity: 'warning',
      message: 'Text before the first command is ignored',
      code: 'zpl.leading-text',
      line: at.line,
      column: at.column,
      length: firstPrefix,
    });
  }
  if (firstPrefix < 0) return { commands, diagnostics };
  index = firstPrefix;

  while (index < source.length) {
    const prefix = source[index] as ZplPrefix;
    if (prefix !== '^' && prefix !== '~') {
      index++;
      continue;
    }

    const start = index;
    index++;
    let name = '';
    if (index < source.length && SINGLE_LETTER.has(source[index]!.toUpperCase())) {
      name = source[index]!.toUpperCase();
      index++;
    } else {
      name = source.slice(index, index + 2).toUpperCase();
      index += Math.min(2, source.length - index);
    }

    // The body runs to the next prefix; that is the whole of ZPL's grammar.
    let end = index;
    while (end < source.length && source[end] !== '^' && source[end] !== '~') end++;
    const body = source.slice(index, end);
    index = end;

    if (name.length === 0) {
      const at = lineAndColumn(source, start);
      diagnostics.push({
        severity: 'error',
        message: 'A prefix with no command after it',
        code: 'zpl.empty-command',
        line: at.line,
        column: at.column,
        length: 1,
      });
      continue;
    }

    const parameters = RAW_PARAMETER.has(name)
      ? [body]
      : body.length === 0
        ? []
        : body.split(',');

    const at = lineAndColumn(source, start);
    commands.push({
      name,
      prefix,
      // Newlines between commands are formatting, not data; a printer ignores
      // them and so must the parameters.
      parameters: RAW_PARAMETER.has(name)
        ? parameters
        : parameters.map((parameter) => parameter.trim()),
      raw: source.slice(start, end),
      span: { start, end, line: at.line, column: at.column },
    });
  }

  return { commands, diagnostics };
}

/** Reads a parameter as a number, or returns the fallback. */
export function numberParameter(
  command: ZplCommand,
  index: number,
  fallback: number,
): number {
  const raw = command.parameters[index];
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Reads a parameter as an upper-cased letter, or returns the fallback. */
export function letterParameter(command: ZplCommand, index: number, fallback: string): string {
  const raw = command.parameters[index];
  if (raw === undefined || raw.length === 0) return fallback;
  return raw.trim().toUpperCase();
}

/**
 * Field data with its ^FH escapes undone.
 *
 * After ^FH, the indicator — an underscore unless ^FH names another — and two
 * hex digits stand for one byte. It is how a field carries a caret or a tilde,
 * which would otherwise start a command, and it is how this program writes
 * them. Runs of escaped bytes are read as UTF-8 when they are, so an escaped
 * Cyrillic letter comes back as the letter rather than as two symbols.
 */
export function decodeFieldHex(data: string, indicator: string): string {
  let out = '';
  let bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length === 0) return;
    try {
      out += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      out += String.fromCharCode(...bytes);
    }
    bytes = [];
  };
  for (let at = 0; at < data.length; at++) {
    const pair = data.slice(at + 1, at + 3);
    if (data[at] === indicator && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      at += 2;
      continue;
    }
    flush();
    out += data[at];
  }
  flush();
  return out;
}
