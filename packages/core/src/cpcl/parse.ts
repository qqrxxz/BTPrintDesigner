import type { Diagnostic, SourceSpan } from '../tspl/parse.js';

/**
 * CPCL parser.
 *
 * CPCL is line-oriented and whitespace-separated, and it opens with a header
 * line that carries the label's whole geometry: `! 0 200 200 406 1`. Text
 * commands take the rest of their line as data, spaces and all, so the parser
 * keeps the offset of every token and lets the interpreter say where the fixed
 * parameters stop.
 *
 * As with the other two languages it never throws.
 */

export interface CpclCommand {
  /** Upper-cased command name; the header line is named `!`. */
  readonly name: string;
  readonly parameters: readonly string[];
  /** Offset of each parameter within the source, for slicing the tail. */
  readonly offsets: readonly number[];
  readonly raw: string;
  readonly span: SourceSpan;
}

export interface CpclParseResult {
  readonly commands: readonly CpclCommand[];
  readonly diagnostics: readonly Diagnostic[];
}

export function parseCpcl(source: string): CpclParseResult {
  const commands: CpclCommand[] = [];
  const diagnostics: Diagnostic[] = [];

  let offset = 0;
  source.split(/\r\n|\r|\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    const lineStart = offset;
    offset += line.length + 1;

    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    // No comment syntax is defined, but files in the wild use both of these
    // and reading them costs nothing.
    if (trimmed.startsWith(';') || trimmed.startsWith('//')) return;

    const parameters: string[] = [];
    const offsets: number[] = [];
    const pattern = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      parameters.push(match[0]);
      offsets.push(lineStart + match.index);
    }
    if (parameters.length === 0) return;

    const leading = line.length - line.trimStart().length;
    commands.push({
      name: parameters[0]!.toUpperCase(),
      parameters: parameters.slice(1),
      offsets: offsets.slice(1),
      raw: trimmed,
      span: {
        start: lineStart + leading,
        end: lineStart + leading + trimmed.length,
        line: lineNumber,
        column: leading + 1,
      },
    });
  });

  if (commands.length > 0 && commands[0]!.name !== '!') {
    diagnostics.push({
      severity: 'warning',
      message: 'A CPCL job starts with a ! line that gives the label size',
      code: 'cpcl.missing-header',
      line: commands[0]!.span.line,
      column: commands[0]!.span.column,
      length: commands[0]!.raw.length,
    });
  }

  return { commands, diagnostics };
}

/**
 * Everything from the given parameter to the end of the line.
 *
 * Text data is whatever follows the fixed parameters, and it keeps its own
 * spacing: a label that lines two columns up with runs of spaces would be
 * ruined by re-joining the tokens.
 */
export function tailFrom(command: CpclCommand, source: string, index: number): string {
  const start = command.offsets[index];
  if (start === undefined) return '';
  const end = source.indexOf('\n', start);
  return source.slice(start, end === -1 ? source.length : end).replace(/\r$/, '');
}

export function numberAt(command: CpclCommand, index: number, fallback: number): number {
  const raw = command.parameters[index];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function wordAt(command: CpclCommand, index: number, fallback: string): string {
  return command.parameters[index]?.toUpperCase() ?? fallback;
}
