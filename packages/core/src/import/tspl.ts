import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import { encodePdf417 } from '../barcode/pdf417/encode.js';
import type { Rotation } from '../bitmap/Bitmap1.js';
import {
  DOCUMENT_VERSION,
  type LabelDocument,
  type LabelElement,
  type LinearSymbology,
  type TextAlignment,
  type TextStyleSpec,
} from '../model/document.js';
import { INTERNAL_FONTS } from '../tspl/fonts.js';
import {
  parseTspl,
  type Diagnostic,
  type SourceSpan,
  type TsplArgument,
  type TsplCommand,
} from '../tspl/parse.js';
import { dotsPerMm, type Dpi } from '../util/units.js';

/**
 * Reads TSPL back into a label document.
 *
 * The point of this direction is not to import everything — it is to know
 * honestly whether importing lost anything. A document is reported as `linked`
 * only when every command in the source is held by the model, so regenerating
 * from the canvas would produce the same label. The moment something is not
 * held, the result is `detached`: the code stays the only safe source of truth,
 * the canvas steps aside, and the preview carries on rendering from the text.
 *
 * That line is the whole contract. Silently importing four commands out of five
 * would give a canvas that quietly deletes the fifth the first time anything is
 * moved.
 */

export interface TsplImportOptions {
  readonly dpi?: Dpi;
  readonly name?: string;
}

export interface UnmappedCommand {
  readonly line: number;
  readonly column: number;
  readonly source: string;
  /** English wording; a caller translates by `code` and falls back to this. */
  readonly reason: string;
  readonly code?: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

export type ImportMode = 'linked' | 'detached';

export interface TsplImportResult {
  /** Best effort, and present even when detached, so a reader can show it. */
  readonly document: LabelDocument;
  readonly mode: ImportMode;
  /** Copies the job asked for; a print-time setting, not part of the design. */
  readonly copies: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly unmapped: readonly UnmappedCommand[];
  /** Where each element came from, so an editor can link canvas and code. */
  readonly origins: Readonly<Record<string, SourceSpan>>;
}

/** Setup commands kept verbatim: printer business the design need not model. */
const PREAMBLE_COMMANDS = new Set([
  'DIRECTION',
  'SPEED',
  'DENSITY',
  'SET',
  'CODEPAGE',
  // OUT sends a value back to the host; it puts nothing on the label, and
  // every stock template from DataMobile carries one.
  'OUT',
  'COUNTRY',
  'OFFSET',
  'SHIFT',
  'BLINE',
  'LIMITFEED',
  'SOUND',
  'CUT',
  'PEEL',
  'INITIALPRINTER',
]);

const SYMBOLOGIES: Readonly<Record<string, { symbology: LinearSymbology; checkDigit?: boolean }>> = {
  '128': { symbology: 'code128' },
  '128M': { symbology: 'code128' },
  CODE128: { symbology: 'code128' },
  EAN128: { symbology: 'gs1-128' },
  'GS1-128': { symbology: 'gs1-128' },
  '39': { symbology: 'code39' },
  '39C': { symbology: 'code39', checkDigit: true },
  EAN13: { symbology: 'ean13' },
  EAN8: { symbology: 'ean8' },
  UPCA: { symbology: 'upca' },
  UPCE: { symbology: 'upce' },
  '25': { symbology: 'itf' },
  I2OF5: { symbology: 'itf' },
  ITF: { symbology: 'itf' },
  '25C': { symbology: 'itf', checkDigit: true },
  I2OF5C: { symbology: 'itf', checkDigit: true },
};

class Importer {
  readonly elements: LabelElement[] = [];
  readonly unmapped: UnmappedCommand[] = [];
  readonly preamble: string[] = [];
  readonly origins: Record<string, SourceSpan> = {};

  private readonly perMm: number;
  private width = 60;
  private height = 40;
  private gap: { height: number; offset: number } | undefined;
  private referenceX = 0;
  private referenceY = 0;
  private nextId = 1;
  private printed = false;
  copies = 1;
  /** What the job says about quantity, variable and all; undefined for one. */
  quantity: string | undefined;

  constructor(private readonly options: TsplImportOptions) {
    this.perMm = dotsPerMm(options.dpi ?? 203);
  }

  private mm(dots: number): number {
    // Two decimals is a hundredth of a millimetre: finer than any printer we
    // target can place, and it keeps the saved file readable.
    return Math.round((dots / this.perMm) * 100) / 100;
  }

  private reject(
    command: TsplCommand,
    reason: string,
    code?: string,
    values?: UnmappedCommand['values'],
  ): void {
    this.unmapped.push({
      line: command.span.line,
      column: command.span.column,
      source: command.source,
      reason,
      ...(code === undefined ? {} : { code }),
      ...(values === undefined ? {} : { values }),
    });
  }

  private id(command: TsplCommand): string {
    const id = `e${this.nextId++}`;
    this.origins[id] = command.span;
    return id;
  }

  private numberAt(command: TsplCommand, index: number): number | undefined {
    const argument = command.arguments[index];
    return argument?.kind === 'number' ? argument.value : undefined;
  }

  private textAt(command: TsplCommand, index: number): string | undefined {
    const argument = command.arguments[index];
    if (argument === undefined) return undefined;
    return argument.kind === 'number' ? argument.raw : argument.value;
  }

  private rotationAt(command: TsplCommand, index: number): Rotation {
    const value = this.numberAt(command, index) ?? 0;
    return value === 90 || value === 180 || value === 270 ? value : 0;
  }

  private alignmentFrom(value: number | undefined): TextAlignment | undefined {
    if (value === 2) return 'center';
    if (value === 3) return 'right';
    return undefined;
  }

  private measure(argument: TsplArgument | undefined, defaultUnit: 'mm' | 'inch'): number {
    if (argument === undefined || argument.kind !== 'number') return 0;
    const unit = argument.unit ?? defaultUnit;
    if (unit === 'mm') return argument.value;
    if (unit === 'dot') return argument.value / this.perMm;
    return argument.value * 25.4;
  }

  handle(command: TsplCommand): void {
    if (this.printed && command.name !== 'PRINT') {
      this.reject(
        command,
        'This job prints more than one label; the canvas holds a single design.',
        'import.multiple-labels',
      );
      return;
    }

    switch (command.name) {
      case 'SIZE':
        this.width = this.measure(command.arguments[0], 'inch');
        this.height = this.measure(command.arguments[1], 'inch');
        return;
      case 'GAP':
        this.gap = {
          height: this.measure(command.arguments[0], 'mm'),
          offset: this.measure(command.arguments[1], 'mm'),
        };
        return;
      case 'CLS':
        return;
      case 'REFERENCE':
        this.referenceX = this.numberAt(command, 0) ?? 0;
        this.referenceY = this.numberAt(command, 1) ?? 0;
        return;
      case 'PRINT': {
        const sets = this.numberAt(command, 0) ?? 1;
        const each = this.numberAt(command, 1) ?? 1;
        this.copies = Math.max(1, Math.round(sets * each));
        this.quantity = quantityFrom(command.arguments[0], command.arguments[1]);
        this.printed = true;
        return;
      }
      case 'TEXT':
      case 'BLOCK':
        return this.text(command);
      case 'BAR':
        return this.rectangle(command, 'solid');
      case 'REVERSE':
        return this.rectangle(command, 'invert');
      case 'ERASE':
        return this.rectangle(command, 'erase');
      case 'BOX':
        return this.box(command);
      case 'BARCODE':
        return this.barcode(command);
      case 'QRCODE':
        return this.qrCode(command);
      case 'DMATRIX':
        return this.dataMatrix(command);
      case 'PDF417':
        return this.pdf417(command);
      default:
        if (PREAMBLE_COMMANDS.has(command.name)) {
          this.preamble.push(command.source);
          return;
        }
        {
          const isImage =
            command.name === 'BITMAP' ||
            command.name === 'PUTBMP' ||
            command.name === 'PUTPCX' ||
            command.name === 'DOWNLOAD';
          this.reject(
            command,
            isImage
              ? 'Images are not part of the document model yet.'
              : `The canvas has nothing that stands for ${command.name}.`,
            isImage ? 'import.image' : 'import.unknown-command',
            { command: command.name },
          );
        }
    }
  }

  /** Reads a font name and multipliers back into a model text style. */
  private style(command: TsplCommand, fontIndex: number, xIndex: number): TextStyleSpec {
    const name = this.textAt(command, fontIndex) ?? '0';
    const xMultiplier = this.numberAt(command, xIndex) ?? 1;
    const yMultiplier = this.numberAt(command, xIndex + 1) ?? 1;

    if (name === '0') {
      const style: { heightMm: number; widthScale?: number } = {
        heightMm: this.mm(yMultiplier),
      };
      if (xMultiplier !== yMultiplier) style.widthScale = xMultiplier / yMultiplier;
      return style;
    }

    // A resident font is pinned with its own multipliers, so regenerating names
    // the same font rather than a size that only resembles it.
    const cell = INTERNAL_FONTS[name];
    return {
      heightMm: this.mm((cell?.height ?? yMultiplier) * (cell ? yMultiplier : 1)),
      residentFont: name,
      residentMultiplier: { x: xMultiplier, y: yMultiplier },
      residentLanguage: 'tspl',
    };
  }

  private text(command: TsplCommand): void {
    const isBlock = command.name === 'BLOCK';
    const fixed = isBlock ? 8 : 6; // Arguments before the optional ones.
    const contentIndex = command.arguments.length - 1;
    if (contentIndex < fixed) {
      this.reject(command, `${command.name} is incomplete.`, 'import.incomplete', {
        command: command.name,
      });
      return;
    }

    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const content = this.textAt(command, contentIndex);
    if (x === undefined || y === undefined || content === undefined) {
      this.reject(command, `${command.name} is incomplete.`, 'import.incomplete', {
        command: command.name,
      });
      return;
    }

    const style = this.style(command, isBlock ? 4 : 2, isBlock ? 6 : 4);
    const rotation = this.rotationAt(command, isBlock ? 5 : 3);

    let alignment: TextAlignment | undefined;
    let lineGapMm: number | undefined;
    if (isBlock) {
      const optional = command.arguments.slice(8, contentIndex);
      if (optional[0]?.kind === 'number' && optional[0].value !== 0) {
        lineGapMm = this.mm(optional[0].value);
      }
      alignment = this.alignmentFrom(
        optional[1]?.kind === 'number' ? optional[1].value : undefined,
      );
    } else if (contentIndex > 6) {
      alignment = this.alignmentFrom(this.numberAt(command, 6));
    }

    const element: LabelElement = {
      id: this.id(command),
      type: 'text',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      ...(rotation === 0 ? {} : { rotation }),
      content,
      style: lineGapMm === undefined ? style : { ...style, lineGapMm },
      ...(alignment === undefined ? {} : { align: alignment }),
      ...(isBlock
        ? {
            box: {
              width: this.mm(this.numberAt(command, 2) ?? 0),
              height: this.mm(this.numberAt(command, 3) ?? 0),
            },
          }
        : {}),
    };
    this.elements.push(element);
  }

  private rectangle(command: TsplCommand, fill: 'solid' | 'invert' | 'erase'): void {
    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const width = this.numberAt(command, 2);
    const height = this.numberAt(command, 3);
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      this.reject(command, `${command.name} is incomplete.`, 'import.incomplete', {
        command: command.name,
      });
      return;
    }
    this.elements.push({
      id: this.id(command),
      type: 'rectangle',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      width: this.mm(width),
      height: this.mm(height),
      fill,
    });
  }

  private box(command: TsplCommand): void {
    const left = this.numberAt(command, 0);
    const top = this.numberAt(command, 1);
    const right = this.numberAt(command, 2);
    const bottom = this.numberAt(command, 3);
    const thickness = this.numberAt(command, 4);
    if (
      left === undefined ||
      top === undefined ||
      right === undefined ||
      bottom === undefined ||
      thickness === undefined
    ) {
      this.reject(command, 'BOX is incomplete.', 'import.incomplete', { command: 'BOX' });
      return;
    }
    const radius = this.numberAt(command, 5) ?? 0;
    this.elements.push({
      id: this.id(command),
      type: 'rectangle',
      x: this.mm(Math.min(left, right) + this.referenceX),
      y: this.mm(Math.min(top, bottom) + this.referenceY),
      // BOX names inclusive corners, so the span is one dot wider than the gap.
      width: this.mm(Math.abs(right - left) + 1),
      height: this.mm(Math.abs(bottom - top) + 1),
      fill: 'outline',
      lineWidth: this.mm(thickness),
      ...(radius > 0 ? { cornerRadius: this.mm(radius) } : {}),
    });
  }

  private barcode(command: TsplCommand): void {
    const contentIndex = command.arguments.length - 1;
    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const type = this.textAt(command, 2);
    const height = this.numberAt(command, 3);
    const content = this.textAt(command, contentIndex);
    if (
      x === undefined ||
      y === undefined ||
      type === undefined ||
      height === undefined ||
      content === undefined ||
      contentIndex < 8
    ) {
      this.reject(command, 'BARCODE is incomplete.', 'import.incomplete', { command: 'BARCODE' });
      return;
    }

    const mapped = SYMBOLOGIES[type.toUpperCase()];
    if (!mapped) {
      this.reject(command, `The canvas does not offer a "${type}" barcode.`, 'import.symbology', {
        symbology: type,
      });
      return;
    }

    const narrow = this.numberAt(command, 6) ?? 2;
    const wide = this.numberAt(command, 7) ?? narrow * 2;
    const humanReadable = (this.numberAt(command, 4) ?? 0) > 0;
    const ratio = Math.min(3, Math.max(2, Math.round(wide / Math.max(1, narrow))));

    this.elements.push({
      id: this.id(command),
      type: 'barcode',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      ...(this.rotationAt(command, 5) === 0 ? {} : { rotation: this.rotationAt(command, 5) }),
      symbology: mapped.symbology,
      data: content,
      moduleWidth: this.mm(narrow),
      height: this.mm(height),
      ...(humanReadable ? { humanReadable: true } : {}),
      ...(mapped.checkDigit ? { checkDigit: true } : {}),
      ...(mapped.checkDigit ? { wideRatio: ratio as 2 | 3 } : {}),
    });
  }

  private qrCode(command: TsplCommand): void {
    const contentIndex = command.arguments.length - 1;
    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const content = this.textAt(command, contentIndex);
    if (x === undefined || y === undefined || content === undefined || contentIndex < 6) {
      this.reject(command, 'QRCODE is incomplete.', 'import.incomplete', { command: 'QRCODE' });
      return;
    }

    for (const argument of command.arguments.slice(6, contentIndex)) {
      if (argument.kind === 'word' && /^M1$/i.test(argument.value)) {
        this.reject(command, 'The canvas draws model 2 QR codes only.', 'import.qr-model-1');
        return;
      }
    }

    const levelArgument = command.arguments[2];
    const raw = levelArgument?.kind === 'word' ? levelArgument.value.toUpperCase() : 'M';
    const level = raw === 'L' || raw === 'Q' || raw === 'H' ? raw : 'M';

    this.elements.push({
      id: this.id(command),
      type: 'matrix',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      ...(this.rotationAt(command, 5) === 0 ? {} : { rotation: this.rotationAt(command, 5) }),
      symbology: 'qr',
      data: content,
      moduleWidth: this.mm(this.numberAt(command, 3) ?? 4),
      errorCorrection: level,
    });
  }

  private dataMatrix(command: TsplCommand): void {
    const contentIndex = command.arguments.length - 1;
    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const width = this.numberAt(command, 2);
    const height = this.numberAt(command, 3);
    const content = this.textAt(command, contentIndex);
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      content === undefined
    ) {
      this.reject(command, 'DMATRIX is incomplete.', 'import.incomplete', { command: 'DMATRIX' });
      return;
    }

    // The command gives a box, not a module size, so the symbol has to be
    // encoded to work out what module size that box implies.
    let module: number;
    try {
      const symbol = encodeDataMatrix(content);
      module = Math.max(1, Math.floor(Math.min(width / symbol.width, height / symbol.height)));
    } catch {
      this.reject(command, 'This Data Matrix payload cannot be encoded.', 'import.encode-failed', {
        symbology: 'Data Matrix',
      });
      return;
    }

    this.elements.push({
      id: this.id(command),
      type: 'matrix',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      // A group separator in the payload is GS1's own, so the symbol is one.
      symbology: content.includes('\u001d') ? 'gs1-datamatrix' : 'datamatrix',
      data: content,
      moduleWidth: this.mm(module),
    });
  }

  private pdf417(command: TsplCommand): void {
    const contentIndex = command.arguments.length - 1;
    const x = this.numberAt(command, 0);
    const y = this.numberAt(command, 1);
    const content = this.textAt(command, contentIndex);
    if (x === undefined || y === undefined || content === undefined || contentIndex < 4) {
      this.reject(command, 'PDF417 is incomplete.', 'import.incomplete', { command: 'PDF417' });
      return;
    }

    let module = 2;
    let columns: number | undefined;
    let level: number | undefined;
    for (const argument of command.arguments.slice(5, contentIndex)) {
      if (argument.kind !== 'word') continue;
      const match = /^([EWHCR])\s*(\d+)$/i.exec(argument.value);
      if (!match) {
        this.reject(
          command,
          `The canvas does not carry the PDF417 option "${argument.value}".`,
          'import.pdf417-option',
          { option: argument.value },
        );
        return;
      }
      const value = Number(match[2]);
      if (match[1]!.toUpperCase() === 'W') module = Math.max(1, value);
      else if (match[1]!.toUpperCase() === 'C') columns = value;
      else if (match[1]!.toUpperCase() === 'E') level = value;
      else if (match[1]!.toUpperCase() === 'R') {
        this.reject(
          command,
          'A fixed PDF417 row count is not part of the document model.',
          'import.pdf417-rows',
        );
        return;
      }
    }

    try {
      encodePdf417(content, {
        ...(columns === undefined ? {} : { columns }),
      });
    } catch {
      this.reject(command, 'This PDF417 payload cannot be encoded.', 'import.encode-failed', {
        symbology: 'PDF417',
      });
      return;
    }

    this.elements.push({
      id: this.id(command),
      type: 'matrix',
      x: this.mm(x + this.referenceX),
      y: this.mm(y + this.referenceY),
      ...(this.rotationAt(command, 4) === 0 ? {} : { rotation: this.rotationAt(command, 4) }),
      symbology: 'pdf417',
      data: content,
      moduleWidth: this.mm(module),
      ...(columns === undefined ? {} : { columns }),
      ...(level === undefined ? {} : { pdf417ErrorCorrection: level }),
    });
  }

  document(): LabelDocument {
    return {
      version: DOCUMENT_VERSION,
      name: this.options.name ?? 'Imported label',
      width: Math.round(this.width * 100) / 100,
      height: Math.round(this.height * 100) / 100,
      ...(this.gap ? { gap: this.gap } : {}),
      ...(this.preamble.length > 0 ? { preamble: this.preamble } : {}),
      ...(this.quantity === undefined ? {} : { quantity: this.quantity }),
      elements: this.elements,
    };
  }
}

/**
 * The quantity a PRINT asks for, in a form the design can keep.
 *
 * DataMobile's templates write `PRINT 1,@Quant@`, and that variable is the
 * whole point: it is where the number the user typed arrives. It is kept as
 * written. Two plain numbers multiply out; one label is no quantity at all.
 */
function quantityFrom(
  sets: TsplArgument | undefined,
  each: TsplArgument | undefined,
): string | undefined {
  for (const argument of [sets, each]) {
    if (argument === undefined || argument.kind === 'number') continue;
    const text = argument.value.trim();
    if (text !== '') return text;
  }
  const count =
    (sets?.kind === 'number' ? sets.value : 1) * (each?.kind === 'number' ? each.value : 1);
  const rounded = Math.max(1, Math.round(count));
  return rounded === 1 ? undefined : String(rounded);
}

export function importTspl(source: string, options: TsplImportOptions = {}): TsplImportResult {
  const parsed = parseTspl(source);
  const importer = new Importer(options);
  for (const command of parsed.commands) importer.handle(command);

  // A parse error means part of the source was never understood, so the model
  // cannot claim to hold it either.
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
