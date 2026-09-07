import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import { encodePdf417 } from '../barcode/pdf417/encode.js';
import { BarcodeError } from '../barcode/types.js';
import type {
  BarcodeElement,
  LabelDocument,
  LabelElement,
  LineElement,
  MatrixElement,
  RectangleElement,
  TextElement,
} from '../model/document.js';
import { substitute } from '../model/placeholders.js';
import { dotsPerMm, type Dpi } from '../util/units.js';
import type { GenerationIssue } from './tspl.js';

/**
 * Generates ZPL II from a label document.
 *
 * The same document that produces TSPL produces this, which is the point of
 * keeping the model language-neutral. What differs is what each language can
 * say: ZPL draws a diagonal line and TSPL cannot, TSPL inverts a region and ZPL
 * cannot. Neither gap is papered over — the one that cannot be expressed is
 * reported with a reason and a way round it.
 */

export interface ZplGenerateOptions {
  readonly dpi?: Dpi;
  readonly data?: Readonly<Record<string, string>>;
  readonly copies?: number;
  readonly includeSetup?: boolean;
}

export interface ZplGenerateResult {
  readonly source: string;
  readonly issues: readonly GenerationIssue[];
  /** The line each element was written to, one-based. */
  readonly origins: Readonly<Record<string, number>>;
}

const SNAP_TOLERANCE = 0.1;

const SYMBOLOGY_COMMANDS: Readonly<Record<BarcodeElement['symbology'], string>> = {
  code128: 'BC',
  'gs1-128': 'BC',
  code39: 'B3',
  itf: 'B2',
  ean13: 'BE',
  ean8: 'B8',
  upca: 'BU',
  upce: 'B9',
};

class Generator {
  readonly lines: string[] = [];
  readonly issues: GenerationIssue[] = [];
  readonly origins: Record<string, number> = {};
  private readonly perMm: number;
  private moduleWidth = 0;

  constructor(
    private readonly document: LabelDocument,
    private readonly options: ZplGenerateOptions,
  ) {
    this.perMm = dotsPerMm(options.dpi ?? 203);
  }

  private dots(mm: number): number {
    return Math.round(mm * this.perMm);
  }

  private snap(mm: number, minimum: number, what: string, element: LabelElement): number {
    const exact = mm * this.perMm;
    const snapped = Math.max(minimum, Math.round(exact));
    if (Math.abs(snapped - exact) / Math.max(exact, 1e-9) > SNAP_TOLERANCE) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.snapped',
        values: {
          what,
          requested: mm.toFixed(3),
          exact: exact.toFixed(2),
          dots: snapped,
          actual: (snapped / this.perMm).toFixed(3),
        },
        message:
          `${what} of ${mm.toFixed(3)} mm is ${exact.toFixed(2)} dots on this printer and ` +
          `prints as ${snapped}, which is ${(snapped / this.perMm).toFixed(3)} mm.`,
      });
    }
    return snapped;
  }

  private resolve(text: string, element: LabelElement): string {
    const result = substitute(text, this.options.data ?? this.document.sampleData);
    for (const name of result.missing) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.placeholder-missing',
        values: { name },
        message: `No value for placeholder {{${name}}}; it is printed as written.`,
      });
    }
    return result.text;
  }

  generate(): void {
    const setup = this.options.includeSetup ?? true;
    this.lines.push('^XA');
    if (setup) {
      this.lines.push(`^PW${this.dots(this.document.width)}`);
      this.lines.push(`^LL${this.dots(this.document.height)}`);
      this.lines.push(...(this.document.preamble ?? []));
    }

    for (const element of this.document.elements) {
      const before = this.lines.length;
      this.element(element);
      // The last line is the one that draws: a barcode may emit its ^BY
      // settings first, and an outline pointing at those would sit on the
      // wrong line in the editor.
      if (this.lines.length > before) this.origins[element.id] = this.lines.length;
    }

    this.lines.push(`^PQ${Math.max(1, Math.round(this.options.copies ?? 1))}`);
    this.lines.push('^XZ');
  }

  private element(element: LabelElement): void {
    switch (element.type) {
      case 'text':
        return this.text(element);
      case 'rectangle':
        return this.rectangle(element);
      case 'line':
        return this.line(element);
      case 'barcode':
        return this.barcode(element);
      case 'matrix':
        return this.matrix(element);
    }
  }

  private orientation(element: LabelElement): string {
    switch (element.rotation ?? 0) {
      case 90:
        return 'R';
      case 180:
        return 'I';
      case 270:
        return 'B';
      default:
        return 'N';
    }
  }

  private text(element: TextElement): void {
    const content = this.resolve(element.content, element);
    const height = Math.max(1, this.dots(element.style.heightMm));
    const width = Math.max(1, Math.round(height * (element.style.widthScale ?? 1)));
    const font = element.style.residentFont ?? '0';
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const facing = this.orientation(element);

    if (element.box) {
      const justify = element.align === 'center' ? 'C' : element.align === 'right' ? 'R' : 'L';
      const blockWidth = this.dots(element.box.width);
      const lineGap = this.dots(element.style.lineGapMm ?? 0);
      // ^FB counts the lines it will allow; the height of the box divided by
      // the line height is how many that is.
      const lines = Math.max(1, Math.floor(this.dots(element.box.height) / (height + lineGap)));
      this.lines.push(
        `^FO${x},${y}^A${font}${facing},${height},${width}` +
          `^FB${blockWidth},${lines},${lineGap},${justify},0${fieldData(content)}^FS`,
      );
      return;
    }

    if (element.align === 'center') {
      // ZPL centres inside a block, not on a point, so a centred line becomes
      // one: a block as wide as the room either side of the anchor allows.
      const room = Math.min(x, this.dots(this.document.width) - x);
      const blockWidth = Math.max(1, room * 2);
      this.lines.push(
        `^FO${x - room},${y}^A${font}${facing},${height},${width}` +
          `^FB${blockWidth},1,0,C,0${fieldData(content)}^FS`,
      );
      return;
    }

    // ^FO's third parameter right-justifies the field, which needs no block.
    const justification = element.align === 'right' ? ',1' : '';
    this.lines.push(
      `^FO${x},${y}${justification}^A${font}${facing},${height},${width}${fieldData(content)}^FS`,
    );
  }

  private rectangle(element: RectangleElement): void {
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const width = Math.max(1, this.dots(element.width));
    const height = Math.max(1, this.dots(element.height));

    if (element.fill === 'invert') {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.zpl-no-invert',
        message:
          'ZPL has no command that inverts an area, so this rectangle cannot be printed. ' +
          'Use a solid rectangle with reversed text over it, which is how ZPL makes white ' +
          'on black.',
      });
      return;
    }

    if (element.fill === 'solid') {
      this.lines.push(`^FO${x},${y}^GB${width},${height},${height}^FS`);
      return;
    }
    if (element.fill === 'erase') {
      // A white box knocks a hole in whatever is under it.
      this.lines.push(`^FO${x},${y}^GB${width},${height},${height},W^FS`);
      return;
    }

    const thickness = Math.max(1, this.dots(element.lineWidth ?? 0.3));
    // ^GB rounds in eighths of the shorter side rather than in millimetres.
    const rounding = element.cornerRadius
      ? Math.min(
          8,
          Math.round((this.dots(element.cornerRadius) / (Math.min(width, height) / 2)) * 8),
        )
      : 0;
    this.lines.push(
      `^FO${x},${y}^GB${width},${height},${thickness},B${rounding > 0 ? `,${rounding}` : ''}^FS`,
    );
  }

  private line(element: LineElement): void {
    const thickness = Math.max(1, this.dots(element.thickness));
    const x = this.dots(Math.min(element.x, element.x2));
    const y = this.dots(Math.min(element.y, element.y2));
    const horizontal = Math.abs(element.y2 - element.y) < 1e-9;
    const vertical = Math.abs(element.x2 - element.x) < 1e-9;

    if (horizontal) {
      const length = Math.max(1, this.dots(Math.abs(element.x2 - element.x)));
      this.lines.push(`^FO${x},${y}^GB${length},${thickness},${thickness}^FS`);
      return;
    }
    if (vertical) {
      const length = Math.max(1, this.dots(Math.abs(element.y2 - element.y)));
      this.lines.push(`^FO${x},${y}^GB${thickness},${length},${thickness}^FS`);
      return;
    }

    // ZPL draws diagonals, which is one of the places it is richer than TSPL.
    const width = Math.max(1, this.dots(Math.abs(element.x2 - element.x)));
    const height = Math.max(1, this.dots(Math.abs(element.y2 - element.y)));
    const downhill = (element.x2 - element.x) * (element.y2 - element.y) > 0;
    this.lines.push(
      `^FO${x},${y}^GD${width},${height},${thickness},B,${downhill ? 'L' : 'R'}^FS`,
    );
  }

  private barcode(element: BarcodeElement): void {
    const data = this.resolve(element.data, element);
    const narrow = this.snap(element.moduleWidth, 1, 'Barcode module width', element);
    const height = Math.max(1, this.dots(element.height));
    const ratio = element.wideRatio ?? 3;
    const facing = this.orientation(element);
    const command = SYMBOLOGY_COMMANDS[element.symbology];
    const line = element.humanReadable ? 'Y' : 'N';

    // ^BY carries the module width and ratio for the field that follows it.
    if (narrow !== this.moduleWidth) {
      this.lines.push(`^BY${narrow},${ratio}`);
      this.moduleWidth = narrow;
    }

    const x = this.dots(element.x);
    const y = this.dots(element.y);
    let parameters: string;
    switch (element.symbology) {
      case 'code128':
      case 'gs1-128':
        // Mode A asks the printer for the shortest encoding, which is what the
        // rest of this project does; mode D marks a GS1 payload.
        parameters = `${facing},${height},${line},N,N,${element.symbology === 'gs1-128' ? 'D' : 'A'}`;
        break;
      case 'code39':
        parameters = `${facing},${element.checkDigit ? 'Y' : 'N'},${height},${line},N`;
        break;
      case 'itf':
        parameters = `${facing},${height},${line},N,${element.checkDigit ? 'Y' : 'N'}`;
        break;
      default:
        parameters = `${facing},${height},${line},N`;
    }

    this.lines.push(`^FO${x},${y}^${command}${parameters}${fieldData(data)}^FS`);
  }

  private matrix(element: MatrixElement): void {
    const data = this.resolve(element.data, element);
    const module = this.snap(element.moduleWidth, 1, 'Module size', element);
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const facing = this.orientation(element);

    if (element.symbology === 'qr') {
      const level = element.errorCorrection ?? 'M';
      // ^BQ takes the error correction from the front of the field data rather
      // than from the command, which catches everyone out once.
      this.lines.push(
        `^FO${x},${y}^BQ${facing},2,${module}^FD${level}A,${data}^FS`,
      );
      return;
    }

    try {
      if (element.symbology === 'datamatrix') {
        encodeDataMatrix(data);
        this.lines.push(`^FO${x},${y}^BX${facing},${module},200${fieldData(data)}^FS`);
        return;
      }
      const symbol = encodePdf417(data, {
        ...(element.columns === undefined ? {} : { columns: element.columns }),
      });
      const rowHeight = module * symbol.moduleAspect;
      const security = element.pdf417ErrorCorrection ?? 0;
      this.lines.push(
        `^FO${x},${y}^B7${facing},${rowHeight},${security},` +
          `${element.columns ?? ''},,N${fieldData(data)}^FS`,
      );
    } catch (error) {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.symbol-failed',
        values: { symbology: element.symbology },
        message:
          error instanceof BarcodeError
            ? error.message
            : `Cannot encode a ${element.symbology} symbol from this data`,
      });
    }
  }
}

/**
 * Makes field data safe.
 *
 * A caret or a tilde inside field data would end the field and start a command,
 * so ZPL offers `^FH`, which turns an underscore followed by two hex digits
 * into that byte. The prefix is only emitted when the data actually needs it,
 * because an unnecessary `^FH` would turn an innocent underscore in the data
 * into an escape.
 */
function escape(text: string): string {
  if (!/[\^~]/.test(text)) return text;
  return `\u0000${text.replace(/\^/g, '_5E').replace(/~/g, '_7E')}`;
}

/** Splits the marker `escape` leaves on data that needs the hex prefix. */
function fieldData(text: string): string {
  const escaped = escape(text);
  return escaped.startsWith('\u0000') ? `^FH^FD${escaped.slice(1)}` : `^FD${escaped}`;
}

export function generateZpl(
  document: LabelDocument,
  options: ZplGenerateOptions = {},
): ZplGenerateResult {
  const generator = new Generator(document, options);
  generator.generate();
  return {
    source: `${generator.lines.join('\n')}\n`,
    issues: generator.issues,
    origins: generator.origins,
  };
}
