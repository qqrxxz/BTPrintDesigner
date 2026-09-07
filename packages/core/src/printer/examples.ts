/**
 * One correct line per command, taken from the generator itself.
 *
 * The point of these is the moment when someone has typed a command by hand,
 * the importer has refused it, and the panel says so. Telling them what is
 * wrong without showing what right looks like leaves them exactly where they
 * were — so the panel shows the line the canvas would have written.
 *
 * Written out by hand the examples would drift the first time an argument
 * moved. Generated from a demonstration label they cannot: what a reader is
 * shown is literally what this program writes.
 */
import { generateCpcl } from '../generate/cpcl.js';
import { generateTspl } from '../generate/tspl.js';
import { generateZpl } from '../generate/zpl.js';
import { createDocument, type LabelDocument } from '../model/document.js';
import type { PrinterLanguage } from './profiles.js';

/** A label carrying one of everything the canvas can draw. */
function demonstration(): LabelDocument {
  return createDocument({
    name: 'Example',
    width: 60,
    height: 40,
    gap: { height: 2, offset: 0 },
    elements: [
      { id: 't1', type: 'text', x: 4, y: 4, content: 'Text', style: { heightMm: 3 } },
      {
        id: 't2',
        type: 'text',
        x: 4,
        y: 9,
        content: 'Text',
        style: { heightMm: 3 },
        box: { width: 40, height: 12 },
      },
      { id: 'r1', type: 'rectangle', x: 4, y: 22, width: 30, height: 10, fill: 'outline', lineWidth: 0.4 },
      { id: 'r2', type: 'rectangle', x: 4, y: 33, width: 30, height: 3, fill: 'solid' },
      { id: 'l1', type: 'line', x: 4, y: 21, x2: 34, y2: 21, thickness: 0.4 },
      {
        id: 'b1',
        type: 'barcode',
        x: 4,
        y: 12,
        symbology: 'code128',
        data: '4820-117-A',
        moduleWidth: 0.25,
        height: 8,
        humanReadable: true,
      },
      { id: 'm1', type: 'matrix', x: 40, y: 4, symbology: 'qr', data: 'https://example.com', moduleWidth: 0.5 },
      { id: 'm2', type: 'matrix', x: 40, y: 14, symbology: 'datamatrix', data: '0104006381333931', moduleWidth: 0.5 },
      { id: 'm3', type: 'matrix', x: 40, y: 24, symbology: 'pdf417', data: '4820-117-A', moduleWidth: 0.25 },
    ],
  });
}

/**
 * The commands a line carries.
 *
 * TSPL and CPCL put one command at the start of a line; ZPL packs several into
 * one, each behind its own caret.
 */
export function commandsIn(language: PrinterLanguage, line: string): string[] {
  const trimmed = line.trim();
  if (trimmed === '') return [];
  if (language === 'zpl') return trimmed.match(/\^[A-Za-z0-9]{2}/g)?.map(upper) ?? [];

  const words = trimmed.split(/\s+/);
  const first = upper(words[0] ?? '');
  // CPCL names two of its symbol blocks in two words: "B QR", "B PDF-417".
  if (language === 'cpcl' && first === 'B' && words[1] !== undefined) {
    return [`B ${upper(words[1])}`, first];
  }
  // A TSPL command is followed by its arguments, which may start straight away,
  // and one of them ends in digits: PDF417.
  if (language === 'tspl') return [upper(/^[A-Za-z][A-Za-z0-9-]*/.exec(trimmed)?.[0] ?? first)];
  return [first];
}

function upper(text: string): string {
  return text.toUpperCase();
}

interface Examples {
  readonly byCommand: ReadonlyMap<string, string>;
  /** How many lines use each command: the many are wrappers, the few are the point. */
  readonly uses: ReadonlyMap<string, number>;
}

const cache = new Map<PrinterLanguage, Examples>();

/** CPCL's two-dimensional symbols carry their payload on lines of their own. */
const BLOCK_OPENS = /^B\s+(QR|PDF-417)/i;
const BLOCK_CLOSES = /^(ENDQR|ENDPDF|END)\b/i;

function build(language: PrinterLanguage): Examples {
  const document = demonstration();
  const generate =
    language === 'zpl' ? generateZpl : language === 'cpcl' ? generateCpcl : generateTspl;
  const source = generate(document, { dpi: 203 }).source;

  const byCommand = new Map<string, string>();
  const uses = new Map<string, number>();
  let inBlock = false;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (language === 'cpcl') {
      // Inside a block the lines are data, not commands.
      if (inBlock) {
        if (BLOCK_CLOSES.test(line)) inBlock = false;
        else continue;
      } else if (BLOCK_OPENS.test(line)) {
        inBlock = true;
      }
    }

    for (const command of commandsIn(language, line)) {
      // "B" on its own is CPCL's way of opening a block, never a command.
      if (command === 'B') continue;
      uses.set(command, (uses.get(command) ?? 0) + 1);
      // The first line that uses a command is the clearest: later ones repeat.
      if (!byCommand.has(command)) byCommand.set(command, line);
    }
  }
  return { byCommand, uses };
}

function examplesFor(language: PrinterLanguage): Examples {
  const cached = cache.get(language);
  if (cached) return cached;
  const built = build(language);
  cache.set(language, built);
  return built;
}

/** Every command this program writes, with the line that demonstrates it. */
export function commandExamples(language: PrinterLanguage): ReadonlyMap<string, string> {
  return examplesFor(language).byCommand;
}

/**
 * The example for the command a line of code is trying to use.
 *
 * The line is what the reader typed, so the command is looked for inside it
 * rather than asked for by name.
 */
export function exampleFor(language: PrinterLanguage, line: string): string | undefined {
  const { byCommand, uses } = examplesFor(language);
  // A ZPL line carries several commands, and the interesting one is the one
  // that draws: ^FO and ^FS are on nearly every line, ^BC on one. The command
  // used least is the one the reader is asking about.
  const found = commandsIn(language, line)
    .filter((command) => byCommand.has(command))
    .sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0));
  return found.length === 0 ? undefined : byCommand.get(found[0]!);
}
