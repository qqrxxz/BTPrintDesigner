/**
 * TSPL parser.
 *
 * Lenient by design. A live preview is worthless if one malformed line blanks
 * the label, so the parser never throws: it records a diagnostic, keeps what it
 * understood, and moves to the next line. Source positions travel with every
 * command and argument, because the editor needs to underline the offending
 * text and, later, the reverse parser needs to map a canvas element back to the
 * line that produced it.
 */

export interface SourceSpan {
  /** Byte offset into the source, for editors that work in offsets. */
  readonly start: number;
  readonly end: number;
  /** One-based, for humans and for most editor APIs. */
  readonly line: number;
  readonly column: number;
}

export type MeasureUnit = 'dot' | 'mm' | 'inch';

export type TsplArgument =
  | {
      readonly kind: 'number';
      readonly value: number;
      /** Present when the source spelled a unit, as `SIZE 60 mm` does. */
      readonly unit?: MeasureUnit;
      readonly raw: string;
      readonly span: SourceSpan;
    }
  | { readonly kind: 'string'; readonly value: string; readonly span: SourceSpan }
  | { readonly kind: 'word'; readonly value: string; readonly span: SourceSpan };

export interface TsplCommand {
  /** Upper-cased command name, as printers treat it. */
  readonly name: string;
  readonly arguments: readonly TsplArgument[];
  readonly span: SourceSpan;
  /** The line as written, for round-tripping code the model cannot hold. */
  readonly source: string;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/** Values a translated message substitutes into its own wording. */
export type MessageValues = Readonly<Record<string, string | number>>;

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  /**
   * English wording, always present.
   *
   * A caller that speaks another language translates by `code` and falls back
   * to this. Keeping the English here means a message is never blank just
   * because nobody has translated it yet.
   */
  readonly message: string;
  /** Stable identifier for translation, absent on messages nobody translates. */
  readonly code?: string;
  readonly values?: MessageValues;
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

export interface ParseResult {
  readonly commands: readonly TsplCommand[];
  readonly diagnostics: readonly Diagnostic[];
}

const NUMBER_WITH_UNIT = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(mm|dot|inch|inches)?$/i;

function unitFrom(text: string | undefined): MeasureUnit | undefined {
  if (text === undefined) return undefined;
  const lower = text.toLowerCase();
  if (lower === 'mm') return 'mm';
  if (lower === 'dot') return 'dot';
  return 'inch';
}

/**
 * Splits one line into comma-separated pieces, keeping quoted text intact.
 *
 * Content strings routinely contain commas — a price, a date, an address — so
 * splitting has to respect quotes or half of every real label falls apart.
 */
function splitArguments(text: string, offset: number): { text: string; offset: number }[] {
  const pieces: { text: string; offset: number }[] = [];
  let current = '';
  let currentOffset = offset;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const character = text[i]!;
    if (current.length === 0) currentOffset = offset + i;

    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (inString && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      current += character;
      continue;
    }
    if (character === ',' && !inString) {
      pieces.push({ text: current, offset: currentOffset });
      current = '';
      continue;
    }
    current += character;
  }
  pieces.push({ text: current, offset: currentOffset });
  return pieces;
}

/**
 * A content string is taken as it is written.
 *
 * This program used to undo `\\` and `\"` here, on the assumption that the
 * firmware wrote them that way. A printed test says otherwise: a TSC prints
 * `\\` as two backslashes and drops the whole command when a string carries a
 * quote. The interpreter models the printer, so it does neither.
 */
function unescape(text: string): string {
  return text;
}

export function parseTspl(source: string): ParseResult {
  const commands: TsplCommand[] = [];
  const diagnostics: Diagnostic[] = [];

  let offset = 0;
  const lines = source.split(/\r\n|\r|\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const lineStart = offset;
    offset += rawLine.length + 1; // The separator is one character either way.

    const trimmed = rawLine.trim();
    if (trimmed.length === 0) return;
    // Neither form is in the standard, but every tool that writes TSPL by hand
    // uses one of them, and refusing to read them helps nobody.
    if (trimmed.startsWith('//') || /^REM\b/i.test(trimmed)) return;

    const leading = rawLine.length - rawLine.trimStart().length;
    const nameMatch = /^[A-Za-z][A-Za-z0-9_]*/.exec(trimmed);
    if (!nameMatch) {
      diagnostics.push({
        severity: 'error',
        message: `Expected a command name, found "${trimmed.slice(0, 20)}"`,
        code: 'parse.expected-command',
        values: { text: trimmed.slice(0, 20) },
        line: lineNumber,
        column: leading + 1,
        length: trimmed.length,
      });
      return;
    }

    const name = nameMatch[0].toUpperCase();
    const rest = trimmed.slice(nameMatch[0].length);
    const restOffset = lineStart + leading + nameMatch[0].length;

    const args: TsplArgument[] = [];
    const hasArguments = rest.trim().length > 0;
    if (hasArguments) {
      for (const piece of splitArguments(rest, restOffset)) {
        const text = piece.text.trim();
        if (text.length === 0) continue;
        const pieceLeading = piece.text.length - piece.text.trimStart().length;
        const start = piece.offset + pieceLeading;
        const span: SourceSpan = {
          start,
          end: start + text.length,
          line: lineNumber,
          column: start - lineStart + 1,
        };

        if (text.startsWith('"')) {
          const closed = text.length >= 2 && text.endsWith('"');
          if (!closed) {
            diagnostics.push({
              severity: 'error',
              message: 'Unterminated string',
              code: 'parse.unterminated-string',
              line: lineNumber,
              column: span.column,
              length: text.length,
            });
          }
          args.push({
            kind: 'string',
            value: unescape(closed ? text.slice(1, -1) : text.slice(1)),
            span,
          });
          continue;
        }

        const numberMatch = NUMBER_WITH_UNIT.exec(text);
        if (numberMatch) {
          const unit = unitFrom(numberMatch[2]);
          args.push({
            kind: 'number',
            value: Number(numberMatch[1]),
            ...(unit === undefined ? {} : { unit }),
            raw: text,
            span,
          });
          continue;
        }

        args.push({ kind: 'word', value: text, span });
      }
    }

    commands.push({
      name,
      arguments: args,
      span: {
        start: lineStart + leading,
        end: lineStart + leading + trimmed.length,
        line: lineNumber,
        column: leading + 1,
      },
      source: trimmed,
    });
  });

  return { commands, diagnostics };
}
