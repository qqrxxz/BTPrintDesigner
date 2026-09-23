import { DEFAULT_SIZE_LADDER, SIZE_IS_HEIGHT_FROM } from '../cpcl/fonts.js';
import { quantityText } from './quantity.js';
import type { Rotation } from '../bitmap/Bitmap1.js';
import { numberAt, parseCpcl, tailFrom, wordAt, type CpclCommand } from '../cpcl/parse.js';
import {
  DOCUMENT_VERSION,
  type LabelDocument,
  type LabelElement,
  type LinearSymbology,
  type TextAlignment,
} from '../model/document.js';
import type { Diagnostic, SourceSpan } from '../tspl/parse.js';
import { dotsPerMm, type Dpi } from '../util/units.js';
import type { ImportMode, UnmappedCommand } from './tspl.js';

/**
 * Reads CPCL back into a label document.
 *
 * Same contract as the other two: `linked` only when the model holds
 * everything, `detached` the moment it does not. CPCL's own narrowness works in
 * the importer's favour — there is less in the language than in the model — so
 * what usually forces a detach here is an image or a symbology this version
 * does not draw.
 */

export interface CpclImportOptions {
  readonly dpi?: Dpi;
  readonly name?: string;
}

export interface CpclImportResult {
  readonly document: LabelDocument;
  readonly mode: ImportMode;
  readonly copies: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly unmapped: readonly UnmappedCommand[];
  readonly origins: Readonly<Record<string, SourceSpan>>;
}

const PREAMBLE_COMMANDS = new Set([
  'GAP-SENSE',
  'BAR-SENSE',
  'CONTINUOUS',
  'POSTFEED',
  'PREFEED',
  'SETSP',
  'SETBOLD',
  'ML',
  'COUNTRY',
  'ENCODING',
  'SPEED',
  'TONE',
  'CONTRAST',
  'JOURNAL',
  'PACE',
  'NO-PACE',
  // The commands a "! UTILITIES" label carries: printer settings, no drawing.
  'SET-TOF',
  'REWIND-ON',
  'REWIND-OFF',
  'ON-FEED',
  'TIMEOUT',
  'UTILITIES',
]);

/** True when a SETMAG asks for the printer's ordinary size. */
function isNeutralMagnification(command: CpclCommand): boolean {
  const x = numberAt(command, 0, 1);
  const y = numberAt(command, 1, 1);
  return x <= 1 && y <= 1;
}

const TEXT_ROTATIONS: Readonly<Record<string, Rotation>> = {
  TEXT: 0,
  T: 0,
  TEXT90: 90,
  T90: 90,
  VTEXT: 90,
  VT: 90,
  TEXT180: 180,
  T180: 180,
  TEXT270: 270,
  T270: 270,
};

const LINEAR_TYPES: Readonly<Record<string, LinearSymbology>> = {
  '128': 'code128',
  UCCEAN128: 'gs1-128',
  '39': 'code39',
  I2OF5: 'itf',
  UPCA: 'upca',
  UPCE: 'upce',
  EAN13: 'ean13',
  EAN8: 'ean8',
};

class Importer {
  readonly elements: LabelElement[] = [];
  readonly unmapped: UnmappedCommand[] = [];
  readonly preamble: string[] = [];
  readonly origins: Record<string, SourceSpan> = {};

  private readonly perMm: number;
  private widthDots = 576;
  private heightDots = 406;
  private offsetX = 0;
  private nextId = 1;
  private justification: TextAlignment = 'left';
  private justificationWidth = 0;
  /** The BARCODE-TEXT / BT in force: font, size and gap, or off. */
  private barcodeText: { font: string; size: number; offset: number } | undefined;
  /** Lines of a `! UTILITIES` session, kept as the job they came in. */
  readonly setupJob: string[] = [];
  private inUtilities = false;
  private block: { kind: 'qr' | 'pdf417'; command: CpclCommand; keywords: Map<string, string>; lines: string[] } | undefined;
  copies = 1;
  /** Whether the job gave its own PAGE-WIDTH; the height is in the header. */
  private statedWidth = false;
  /** What the job says about quantity, variable and all; undefined for one. */
  quantity: string | undefined;

  constructor(
    private readonly source: string,
    private readonly options: CpclImportOptions,
  ) {
    this.perMm = dotsPerMm(options.dpi ?? 203);
  }

  private mm(dots: number): number {
    return Math.round((dots / this.perMm) * 100) / 100;
  }

  private reject(
    command: CpclCommand,
    reason: string,
    code?: string,
    values?: UnmappedCommand['values'],
  ): void {
    this.unmapped.push({
      line: command.span.line,
      column: command.span.column,
      source: command.raw,
      reason,
      ...(code === undefined ? {} : { code }),
      ...(values === undefined ? {} : { values }),
    });
  }

  private id(command: CpclCommand): string {
    const id = `e${this.nextId++}`;
    this.origins[id] = command.span;
    return id;
  }

  handle(command: CpclCommand): void {
    // `! UTILITIES` opens a job that only sets the printer up, and PRINT ends
    // it. Its commands belong to it — several are only accepted there — so
    // they are kept as that job rather than poured into the label's own.
    if (command.name === '!' && wordAt(command, 0, '').toUpperCase() === 'UTILITIES') {
      this.inUtilities = true;
      return;
    }
    if (this.inUtilities) {
      if (command.name === 'PRINT') this.inUtilities = false;
      else this.setupJob.push(command.raw.trim());
      return;
    }
    if (this.block) {
      if (command.name === 'ENDQR' || command.name === 'ENDPDF' || command.name === 'END') {
        this.closeBlock();
        return;
      }
      this.block.lines.push(command.raw);
      return;
    }

    switch (command.name) {
      case '!':
        this.offsetX = numberAt(command, 0, 0);
        this.heightDots = numberAt(command, 3, this.heightDots);
        this.copies = Math.max(1, Math.round(numberAt(command, 4, 1)));
        // `! 0 200 200 312 @Quant@` is how DataMobile's CPCL asks for it.
        this.quantity = quantityText(command.parameters[4]);
        return;
      case 'PAGE-WIDTH':
      case 'PW':
        this.widthDots = numberAt(command, 0, this.widthDots);
        this.statedWidth = true;
        return;
      case 'LEFT':
      case 'CENTER':
      case 'RIGHT':
        this.justification =
          command.name === 'CENTER' ? 'center' : command.name === 'RIGHT' ? 'right' : 'left';
        this.justificationWidth = numberAt(command, 0, 0);
        return;
      case 'BARCODE-TEXT':
      case 'BT':
        this.barcodeText =
          wordAt(command, 0, '') === 'OFF' || command.parameters.length === 0
            ? undefined
            : {
                font: command.parameters[0] ?? '0',
                size: numberAt(command, 1, 0),
                offset: numberAt(command, 2, 0),
              };
        return;
      case 'FORM':
      case 'PRINT':
        return;
      case 'LINE':
      case 'L':
        return this.line(command);
      case 'BOX':
        return this.box(command);
      case 'INVERSE-LINE':
      case 'IL':
        return this.inverseLine(command);
      case 'BARCODE':
      case 'B':
      case 'VBARCODE':
      case 'VB':
        return this.barcode(command);
      default:
        if (TEXT_ROTATIONS[command.name] !== undefined) return this.text(command);
        if (PREAMBLE_COMMANDS.has(command.name)) {
          this.preamble.push(command.raw);
          return;
        }
        // SETMAG 0 0 and SETMAG 1 1 both mean "no magnification", which is
        // what a template writes to put the printer back to normal. Only a
        // real magnification changes how the sizes that follow are read.
        if (command.name === 'SETMAG' && isNeutralMagnification(command)) {
          this.preamble.push(command.raw);
          return;
        }
        if (
          command.name === 'IN-MILLIMETERS' ||
          command.name === 'IN-INCHES' ||
          command.name === 'SETMAG'
        ) {
          this.reject(
            command,
            `${command.name} changes how every following coordinate is read, which the ` +
              'canvas cannot hold.',
            'import.cpcl-mode',
            { command: command.name },
          );
          return;
        }
        this.reject(
          command,
          command.name === 'PCX' || command.name === 'CG' || command.name === 'EG'
            ? 'Images are not part of the document model yet.'
            : `The canvas has nothing that stands for ${command.name}.`,
          command.name === 'PCX' || command.name === 'CG' || command.name === 'EG'
            ? 'import.image'
            : 'import.unknown-command',
          { command: command.name },
        );
    }
  }

  private text(command: CpclCommand): void {
    const rotation = TEXT_ROTATIONS[command.name]!;
    const font = command.parameters[0] ?? '0';
    const size = numberAt(command, 1, 0);
    const x = numberAt(command, 2, 0) + this.offsetX;
    const y = numberAt(command, 3, 0);
    const content = tailFrom(command, this.source, 4);
    if (content.length === 0) return;

    // A justified line sits in a span. Given a width, the model keeps the
    // span's middle (or right end) as the line's anchor. Given none, the span
    // runs to the printer's own page edge, which the file does not state — so
    // the line keeps where it starts, and the span stays "to the edge".
    const toEdge = this.justification !== 'left' && this.justificationWidth <= 0;
    const anchor = toEdge
      ? x
      : this.justification === 'center'
        ? x + this.justificationWidth / 2
        : this.justification === 'right'
          ? x + this.justificationWidth
          : x;

    // CPCL names a size index, not a height: 0 is the smallest cell of the
    // font, and only a size from nine up is a height in dots. Reading the
    // index as dots made every line a tenth of a millimetre tall.
    const heightDots =
      size < SIZE_IS_HEIGHT_FROM
        ? (DEFAULT_SIZE_LADDER[Math.max(0, Math.round(size))] ?? DEFAULT_SIZE_LADDER.at(-1)!)
        : size;

    this.elements.push({
      id: this.id(command),
      type: 'text',
      x: this.mm(anchor),
      y: this.mm(y),
      ...(rotation === 0 ? {} : { rotation }),
      content,
      style: {
        heightMm: this.mm(heightDots),
        // The font the job named, kept so it prints with it again — a
        // downloaded face like Ari10pt.cpf is often what carries the Cyrillic.
        residentFont: font,
        residentSize: size,
        residentLanguage: 'cpcl',
      },
      ...(this.justification === 'left' ? {} : { align: this.justification }),
      ...(toEdge ? { alignSpan: 'to-edge' as const } : {}),
    });
  }

  private corners(command: CpclCommand): {
    left: number;
    top: number;
    width: number;
    height: number;
    thickness: number;
  } {
    const x0 = numberAt(command, 0, 0) + this.offsetX;
    const y0 = numberAt(command, 1, 0);
    const x1 = numberAt(command, 2, 0) + this.offsetX;
    const y1 = numberAt(command, 3, 0);
    return {
      left: Math.min(x0, x1),
      top: Math.min(y0, y1),
      width: Math.abs(x1 - x0) + 1,
      height: Math.abs(y1 - y0) + 1,
      thickness: Math.max(1, numberAt(command, 4, 1)),
    };
  }

  private line(command: CpclCommand): void {
    const x0 = numberAt(command, 0, 0) + this.offsetX;
    const y0 = numberAt(command, 1, 0);
    const x1 = numberAt(command, 2, 0) + this.offsetX;
    const y1 = numberAt(command, 3, 0);
    this.elements.push({
      id: this.id(command),
      type: 'line',
      x: this.mm(x0),
      y: this.mm(y0),
      x2: this.mm(x1),
      y2: this.mm(y1),
      thickness: this.mm(Math.max(1, numberAt(command, 4, 1))),
    });
  }

  private box(command: CpclCommand): void {
    const { left, top, width, height, thickness } = this.corners(command);
    const solid = thickness * 2 >= width || thickness * 2 >= height;
    this.elements.push({
      id: this.id(command),
      type: 'rectangle',
      x: this.mm(left),
      y: this.mm(top),
      width: this.mm(width),
      height: this.mm(height),
      fill: solid ? 'solid' : 'outline',
      ...(solid ? {} : { lineWidth: this.mm(thickness) }),
    });
  }

  private inverseLine(command: CpclCommand): void {
    const { left, top, width, height, thickness } = this.corners(command);
    const horizontal = height <= thickness || numberAt(command, 1, 0) === numberAt(command, 3, 0);
    this.elements.push({
      id: this.id(command),
      type: 'rectangle',
      x: this.mm(left),
      y: this.mm(top),
      width: this.mm(horizontal ? width : thickness),
      height: this.mm(horizontal ? thickness : height),
      fill: 'invert',
    });
  }

  private barcode(command: CpclCommand): void {
    const type = wordAt(command, 0, '');
    if (type === 'QR' || type === 'PDF-417' || type === 'PDF417') {
      const keywords = new Map<string, string>();
      for (let i = 3; i < command.parameters.length; i += 2) {
        const key = command.parameters[i]?.toUpperCase();
        const value = command.parameters[i + 1];
        if (key !== undefined && value !== undefined) keywords.set(key, value);
      }
      this.block = { kind: type === 'QR' ? 'qr' : 'pdf417', command, keywords, lines: [] };
      return;
    }

    const symbology = LINEAR_TYPES[type];
    if (!symbology) {
      this.reject(command, `The canvas does not offer a "${type}" barcode.`, 'import.symbology', {
        symbology: type,
      });
      return;
    }

    const narrow = Math.max(1, numberAt(command, 1, 2));
    const wide = Math.max(narrow, numberAt(command, 2, narrow * 2));
    const rotation: Rotation = command.name === 'VBARCODE' || command.name === 'VB' ? 90 : 0;

    this.elements.push({
      id: this.id(command),
      type: 'barcode',
      x: this.mm(numberAt(command, 4, 0) + this.offsetX),
      y: this.mm(numberAt(command, 5, 0)),
      ...(rotation === 0 ? {} : { rotation }),
      symbology,
      data: tailFrom(command, this.source, 6).trim(),
      moduleWidth: this.mm(narrow),
      height: this.mm(Math.max(1, numberAt(command, 3, 50))),
      ...(this.barcodeText
        ? { humanReadable: true, readableFont: { ...this.barcodeText } }
        : {}),
      ...(symbology === 'code39' || symbology === 'itf'
        ? { wideRatio: (wide / narrow >= 2.5 ? 3 : 2) as 2 | 3 }
        : {}),
    });
  }

  private closeBlock(): void {
    const block = this.block;
    this.block = undefined;
    if (!block) return;

    const payload = block.lines.join('\n');
    const x = numberAt(block.command, 1, 0) + this.offsetX;
    const y = numberAt(block.command, 2, 0);
    const base = { id: this.id(block.command), x: this.mm(x), y: this.mm(y) };

    if (block.kind === 'qr') {
      const match = /^([HQML])([AM]),(.*)$/s.exec(payload);
      this.elements.push({
        ...base,
        type: 'matrix',
        symbology: 'qr',
        data: match?.[3] ?? payload,
        moduleWidth: this.mm(Math.max(1, Math.round(Number(block.keywords.get('U') ?? 4)))),
        errorCorrection: (match?.[1] ?? 'M') as 'L' | 'M' | 'Q' | 'H',
      });
      return;
    }

    const columns = Math.round(Number(block.keywords.get('C') ?? 0));
    const security = Math.round(Number(block.keywords.get('S') ?? 0));
    this.elements.push({
      ...base,
      type: 'matrix',
      symbology: 'pdf417',
      data: payload,
      moduleWidth: this.mm(Math.max(1, Math.round(Number(block.keywords.get('XD') ?? 2)))),
      ...(Number.isFinite(columns) && columns > 0 ? { columns } : {}),
      ...(Number.isFinite(security) && security > 0 ? { pdf417ErrorCorrection: security } : {}),
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
      ...(this.statedWidth ? {} : { declaredSize: { width: false, height: true } }),
      ...(this.setupJob.length > 0 ? { setupJob: [...this.setupJob] } : {}),
      elements: this.elements,
    };
  }
}

export function importCpcl(source: string, options: CpclImportOptions = {}): CpclImportResult {
  const parsed = parseCpcl(source);
  const importer = new Importer(source, options);
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
