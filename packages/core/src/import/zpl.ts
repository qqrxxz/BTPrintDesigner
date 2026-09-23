import { quantityText } from './quantity.js';
import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import type { Rotation } from '../bitmap/Bitmap1.js';
import {
  DOCUMENT_VERSION,
  type LabelDocument,
  type LabelElement,
  type LinearSymbology,
  type TextAlignment,
  type TextStyleSpec,
} from '../model/document.js';
import type { Diagnostic, SourceSpan } from '../tspl/parse.js';
import { dotsPerMm, type Dpi } from '../util/units.js';
import { ZPL_FONTS } from '../zpl/fonts.js';
import { letterParameter, numberParameter, parseZpl, type ZplCommand } from '../zpl/parse.js';
import type { ImportMode, UnmappedCommand } from './tspl.js';

/**
 * Reads ZPL back into a label document.
 *
 * The contract is the one the TSPL importer set: `linked` only when the model
 * holds everything the code says, so regenerating from the canvas produces the
 * same label, and `detached` the moment it does not. ZPL makes the line fall in
 * slightly different places — it draws circles and ellipses, which the model
 * has no element for, and it has no way to invert an area, which the model does.
 */

export interface ZplImportOptions {
  readonly dpi?: Dpi;
  readonly name?: string;
}

export interface ZplImportResult {
  readonly document: LabelDocument;
  readonly mode: ImportMode;
  readonly copies: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly unmapped: readonly UnmappedCommand[];
  readonly origins: Readonly<Record<string, SourceSpan>>;
}

/** Printer settings kept verbatim: the design does not model them. */
const PREAMBLE_COMMANDS = new Set([
  'MD',
  'MN',
  'MM',
  'MT',
  'MU',
  'PR',
  'JM',
  'JZ',
  'JU',
  'SN',
  'LT',
  'LS',
  'PM',
  'PF',
  'XB',
  'CI',
  'CT',
  'FX',
  // ^CW gives a downloaded font a one-letter name. The canvas cannot use the
  // font, but dropping the line would change what the printer does.
  'CW',
]);

const LINEAR_COMMANDS: Readonly<Record<string, LinearSymbology>> = {
  BC: 'code128',
  B3: 'code39',
  B2: 'itf',
  BE: 'ean13',
  B8: 'ean8',
  BU: 'upca',
  B9: 'upce',
};

interface Pending {
  x: number;
  y: number;
  justification: number;
  rotation: Rotation;
  font: { name: string; height: number; width: number } | undefined;
  block: { width: number; lines: number; gap: number; justify: string } | undefined;
  content: string | undefined;
  command: ZplCommand | undefined;
  barcode: { kind: string; command: ZplCommand; parameters: ZplCommand } | undefined;
  graphic: ZplCommand | undefined;
}

function emptyPending(): Pending {
  return {
    x: 0,
    y: 0,
    justification: 0,
    rotation: 0,
    font: undefined,
    block: undefined,
    content: undefined,
    command: undefined,
    barcode: undefined,
    graphic: undefined,
  };
}

function rotationOf(letter: string): Rotation {
  if (letter === 'R') return 90;
  if (letter === 'I') return 180;
  if (letter === 'B') return 270;
  return 0;
}

class Importer {
  readonly elements: LabelElement[] = [];
  readonly unmapped: UnmappedCommand[] = [];
  readonly preamble: string[] = [];
  readonly origins: Record<string, SourceSpan> = {};

  private readonly perMm: number;
  private widthDots = 812;
  private heightDots = 406;
  private homeX = 0;
  private homeY = 0;
  private defaultFont = { name: '0', height: 15, width: 0 };
  private moduleWidth = 2;
  private wideRatio = 3;
  private barcodeHeight = 10;
  private nextId = 1;
  private opened = false;
  /** True once a ^XZ has closed the first label. */
  private finished = false;
  copies = 1;
  /** What the job says about quantity, variable and all; undefined for one. */
  quantity: string | undefined;

  private pending = emptyPending();

  constructor(private readonly options: ZplImportOptions) {
    this.perMm = dotsPerMm(options.dpi ?? 203);
  }

  private mm(dots: number): number {
    return Math.round((dots / this.perMm) * 100) / 100;
  }

  private reject(
    command: ZplCommand,
    reason: string,
    code?: string,
    values?: UnmappedCommand['values'],
  ): void {
    this.unmapped.push({
      line: command.span.line,
      column: command.span.column,
      source: command.raw.trim(),
      reason,
      ...(code === undefined ? {} : { code }),
      ...(values === undefined ? {} : { values }),
    });
  }

  private id(command: ZplCommand): string {
    const id = `e${this.nextId++}`;
    this.origins[id] = command.span;
    return id;
  }

  handle(command: ZplCommand): void {
    switch (command.name) {
      case 'XA':
        // A second ^XA before any ^XZ is a format that starts itself twice —
        // a printer takes it in its stride, and so do the vendor templates
        // that carry one. A ^XA after a ^XZ is a second label, which is a
        // different thing entirely and cannot be held by one design.
        if (this.finished) {
          this.reject(
            command,
            'This job prints more than one label; the canvas holds a single design.',
            'import.multiple-labels',
          );
        }
        this.opened = true;
        return;
      case 'XZ':
        this.commit();
        // A job that drew nothing was setup, not a label: printers are sent
        // one to register a font before the label that uses it. The design is
        // the job that puts something on paper.
        if (this.elements.length > 0) this.finished = true;
        return;
      case 'PW':
        this.widthDots = numberParameter(command, 0, this.widthDots);
        return;
      case 'LL':
        this.heightDots = numberParameter(command, 0, this.heightDots);
        return;
      case 'LH':
        this.homeX = numberParameter(command, 0, 0);
        this.homeY = numberParameter(command, 1, 0);
        return;
      case 'PQ':
        this.copies = Math.max(1, Math.round(numberParameter(command, 0, 1)));
        // ^PQ@Quant@ is how DataMobile's ZPL templates ask for the quantity.
        this.quantity = quantityText(command.parameters[0]);
        return;
      case 'CF':
        this.defaultFont = {
          name: letterParameter(command, 0, this.defaultFont.name),
          height: numberParameter(command, 1, this.defaultFont.height),
          width: numberParameter(command, 2, 0),
        };
        return;
      case 'BY':
        this.moduleWidth = Math.max(1, Math.round(numberParameter(command, 0, this.moduleWidth)));
        this.wideRatio = numberParameter(command, 1, this.wideRatio);
        this.barcodeHeight = numberParameter(command, 2, this.barcodeHeight);
        return;

      case 'FO':
      case 'FT':
        this.commit();
        this.pending = emptyPending();
        this.pending.x = numberParameter(command, 0, 0);
        this.pending.y = numberParameter(command, 1, 0);
        this.pending.justification = numberParameter(command, 2, 0);
        this.pending.command = command;
        return;
      case 'A': {
        const glued = command.parameters[0] ?? '';
        this.pending.font = {
          name: glued.slice(0, 1).toUpperCase() || this.defaultFont.name,
          height: numberParameter(command, 1, 0),
          width: numberParameter(command, 2, 0),
        };
        this.pending.rotation = rotationOf(glued.slice(1, 2).toUpperCase());
        return;
      }
      case 'FB':
        this.pending.block = {
          width: numberParameter(command, 0, 0),
          lines: Math.max(1, Math.round(numberParameter(command, 1, 1))),
          gap: numberParameter(command, 2, 0),
          justify: letterParameter(command, 3, 'L'),
        };
        return;
      case 'FD':
      case 'FV':
        this.pending.content = command.parameters[0] ?? '';
        this.pending.command ??= command;
        return;
      case 'FH':
        // The hex escape only affects how data is spelt, and the parser has
        // already handed over the text; nothing in the model changes.
        return;
      case 'FS':
        this.commit();
        return;

      case 'GB':
      case 'GD':
        this.pending.graphic = command;
        this.pending.command ??= command;
        return;

      case 'BQ':
      case 'BX':
      case 'B7':
      case 'BC':
      case 'B3':
      case 'B2':
      case 'BE':
      case 'B8':
      case 'BU':
      case 'B9':
        this.pending.barcode = { kind: command.name, command, parameters: command };
        this.pending.command ??= command;
        return;

      default:
        if (PREAMBLE_COMMANDS.has(command.name)) {
          this.preamble.push(command.raw.trim());
          return;
        }
        if (command.prefix === '~') {
          this.reject(
            command,
            `The canvas has nothing that stands for ~${command.name}.`,
            'import.unknown-command',
            { command: `~${command.name}` },
          );
          return;
        }
        this.reject(
          command,
          command.name === 'GF'
            ? 'Images are not part of the document model yet.'
            : command.name === 'GC' || command.name === 'GE'
              ? 'The canvas has no circle or ellipse element yet.'
              : `The canvas has nothing that stands for ^${command.name}.`,
          command.name === 'GF' ? 'import.image' : 'import.unknown-command',
          { command: `^${command.name}` },
        );
    }
  }

  private commit(): void {
    const pending = this.pending;
    this.pending = emptyPending();
    if (pending.graphic) return this.graphic(pending, pending.graphic);
    if (pending.barcode && pending.content !== undefined) return this.barcode(pending);
    if (pending.content !== undefined && pending.content.length > 0) return this.text(pending);
  }

  private x(pending: Pending): number {
    return this.mm(pending.x + this.homeX);
  }

  private y(pending: Pending): number {
    return this.mm(pending.y + this.homeY);
  }

  private style(pending: Pending): TextStyleSpec {
    const font = pending.font ?? this.defaultFont;
    const cell = ZPL_FONTS[font.name.toUpperCase()];
    const height = font.height > 0 ? font.height : (cell?.height ?? 15);
    const style: {
      heightMm: number;
      widthScale?: number;
      residentFont?: string;
    } = { heightMm: this.mm(height) };

    if (font.width > 0 && font.width !== height) style.widthScale = font.width / height;
    // Font 0 is the scalable default the generator emits, so it needs no pin;
    // anything else has to be named or the design would change on the way out.
    if (font.name.toUpperCase() !== '0') style.residentFont = font.name.toUpperCase();
    return style;
  }

  private text(pending: Pending): void {
    const alignment: TextAlignment | undefined = pending.block
      ? pending.block.justify === 'C'
        ? 'center'
        : pending.block.justify === 'R'
          ? 'right'
          : undefined
      : pending.justification === 1
        ? 'right'
        : undefined;

    const style = this.style(pending);
    const gap = pending.block && pending.block.gap > 0 ? this.mm(pending.block.gap) : undefined;

    this.elements.push({
      id: this.id(pending.command!),
      type: 'text',
      x: this.x(pending),
      y: this.y(pending),
      ...(pending.rotation === 0 ? {} : { rotation: pending.rotation }),
      content: pending.content ?? '',
      style: gap === undefined ? style : { ...style, lineGapMm: gap },
      ...(alignment === undefined ? {} : { align: alignment }),
      ...(pending.block
        ? {
            box: {
              width: this.mm(pending.block.width),
              height: this.mm(pending.block.lines * (style.heightMm * this.perMm + pending.block.gap)),
            },
          }
        : {}),
    });
  }

  private graphic(pending: Pending, command: ZplCommand): void {
    if (command.name === 'GD') {
      const width = numberParameter(command, 0, 1);
      const height = numberParameter(command, 1, 1);
      const thickness = numberParameter(command, 2, 1);
      const leaning = letterParameter(command, 4, 'R');
      const x = this.x(pending);
      const y = this.y(pending);
      this.elements.push({
        id: this.id(command),
        type: 'line',
        x: leaning === 'L' ? x : x,
        y: leaning === 'L' ? y : y + this.mm(height),
        x2: x + this.mm(width),
        y2: leaning === 'L' ? y + this.mm(height) : y,
        thickness: this.mm(thickness),
      });
      return;
    }

    const width = numberParameter(command, 0, 1);
    const height = numberParameter(command, 1, 1);
    const thickness = Math.max(1, numberParameter(command, 2, 1));
    const colour = letterParameter(command, 3, 'B');
    const rounding = numberParameter(command, 4, 0);
    const solid = thickness * 2 >= width || thickness * 2 >= height;

    this.elements.push({
      id: this.id(command),
      type: 'rectangle',
      x: this.x(pending),
      y: this.y(pending),
      width: this.mm(Math.max(width, thickness)),
      height: this.mm(Math.max(height, thickness)),
      fill: colour === 'W' ? 'erase' : solid ? 'solid' : 'outline',
      ...(solid || colour === 'W' ? {} : { lineWidth: this.mm(thickness) }),
      ...(rounding > 0 && !solid
        ? { cornerRadius: this.mm((Math.min(width, height) / 2) * (Math.min(8, rounding) / 8)) }
        : {}),
    });
  }

  private barcode(pending: Pending): void {
    const command = pending.barcode!.command;
    const data = pending.content ?? '';
    const rotation = rotationOf(letterParameter(command, 0, 'N'));
    const x = this.x(pending);
    const y = this.y(pending);
    const base = {
      id: this.id(pending.command ?? command),
      x,
      y,
      ...(rotation === 0 ? {} : { rotation }),
    };

    if (command.name === 'BQ') {
      const match = /^([HQML])([AM]),(.*)$/s.exec(data);
      const level = (match?.[1] ?? 'M') as 'L' | 'M' | 'Q' | 'H';
      this.elements.push({
        ...base,
        type: 'matrix',
        symbology: 'qr',
        data: match?.[3] ?? data,
        moduleWidth: this.mm(Math.max(1, Math.round(numberParameter(command, 2, 1)))),
        errorCorrection: level,
      });
      return;
    }

    if (command.name === 'BX') {
      try {
        encodeDataMatrix(data);
      } catch {
        this.reject(command, 'This Data Matrix payload cannot be encoded.', 'import.encode-failed', {
          symbology: 'Data Matrix',
        });
        return;
      }
      this.elements.push({
        ...base,
        type: 'matrix',
        // A group separator in the payload is GS1's own, so the symbol is one.
        symbology: data.includes('\u001d') ? 'gs1-datamatrix' : 'datamatrix',
        data,
        moduleWidth: this.mm(Math.max(1, Math.round(numberParameter(command, 1, 5)))),
      });
      return;
    }

    if (command.name === 'B7') {
      const columns = numberParameter(command, 3, 0);
      const rows = numberParameter(command, 4, 0);
      if (rows > 0) {
        this.reject(
          command,
          'A fixed PDF417 row count is not part of the document model.',
          'import.pdf417-rows',
        );
        return;
      }
      const rowHeight = Math.max(1, Math.round(numberParameter(command, 1, 3)));
      this.elements.push({
        ...base,
        type: 'matrix',
        symbology: 'pdf417',
        data,
        // ^B7 gives the row height, and a PDF417 row is three modules tall.
        moduleWidth: this.mm(Math.max(1, Math.round(rowHeight / 3))),
        ...(columns > 0 ? { columns } : {}),
        pdf417ErrorCorrection: Math.round(numberParameter(command, 2, 0)),
      });
      return;
    }

    // ^BC's sixth parameter is the mode, and D there says the payload is GS1.
    const symbology =
      command.name === 'BC' && letterParameter(command, 5, 'N') === 'D'
        ? ('gs1-128' as const)
        : LINEAR_COMMANDS[command.name];
    if (!symbology) {
      this.reject(command, `The canvas does not offer a "^${command.name}" barcode.`, 'import.symbology', {
        symbology: `^${command.name}`,
      });
      return;
    }

    const heightIndex = command.name === 'B3' ? 2 : 1;
    const lineIndex = command.name === 'B3' ? 3 : 2;
    const checkDigit =
      command.name === 'B3'
        ? letterParameter(command, 1, 'N') === 'Y'
        : command.name === 'B2'
          ? letterParameter(command, 4, 'N') === 'Y'
          : false;

    this.elements.push({
      ...base,
      type: 'barcode',
      symbology,
      data,
      moduleWidth: this.mm(this.moduleWidth),
      height: this.mm(numberParameter(command, heightIndex, this.barcodeHeight)),
      ...(letterParameter(command, lineIndex, 'Y') !== 'N' ? { humanReadable: true } : {}),
      ...(checkDigit ? { checkDigit: true, wideRatio: (this.wideRatio >= 2.5 ? 3 : 2) as 2 | 3 } : {}),
    });
  }

  document(): LabelDocument {
    return {
      version: DOCUMENT_VERSION,
      name: this.options.name ?? 'Imported label',
      width: this.mm(this.widthDots),
      height: this.mm(this.heightDots),
      ...(this.preamble.length > 0 ? { preamble: this.preamble } : {}),
      ...(this.quantity === undefined ? {} : { quantity: this.quantity }),
      elements: this.elements,
    };
  }
}

export function importZpl(source: string, options: ZplImportOptions = {}): ZplImportResult {
  const parsed = parseZpl(source);
  const importer = new Importer(options);
  for (const command of parsed.commands) importer.handle(command);

  const parseFailed = parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    document: importer.document(),
    mode: importer.unmapped.length === 0 && !parseFailed ? 'linked' : 'detached',
    copies: importer.copies,
    diagnostics: parsed.diagnostics,
    unmapped: importer.unmapped,
    origins: importer.origins,
  };
}
