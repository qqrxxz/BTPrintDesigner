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
 * Generates CPCL from a label document.
 *
 * CPCL is the narrowest of the three languages, and the generator says so
 * rather than working around it: there is no white box to erase with, no
 * rounded corner on a box, and no Data Matrix. Each of those is reported with
 * what to do instead, in the same way TSPL reports a diagonal line it cannot
 * draw and ZPL reports an area it cannot invert.
 */

export interface CpclGenerateOptions {
  readonly dpi?: Dpi;
  readonly data?: Readonly<Record<string, string>>;
  readonly copies?: number;
  readonly includeSetup?: boolean;
}

export interface CpclGenerateResult {
  readonly source: string;
  readonly issues: readonly GenerationIssue[];
  readonly origins: Readonly<Record<string, number>>;
}

const SNAP_TOLERANCE = 0.1;

/**
 * The resolution written into the header.
 *
 * Every printer this targets writes 200 there whatever its real resolution is,
 * and reads it back the same way; the actual dots per millimetre come from the
 * printer profile.
 */
const HEADER_DPI = 200;

/** Font 7 is the scalable one, and a size of nine or more is a dot height. */
const SCALABLE_FONT = '7';

const SYMBOLOGY_NAMES: Readonly<Record<BarcodeElement['symbology'], string | undefined>> = {
  code128: '128',
  'gs1-128': '128',
  code39: '39',
  itf: 'I2OF5',
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPCA',
  upce: 'UPCE',
};

class Generator {
  readonly lines: string[] = [];
  readonly issues: GenerationIssue[] = [];
  readonly origins: Record<string, number> = {};
  private readonly perMm: number;

  constructor(
    private readonly document: LabelDocument,
    private readonly options: CpclGenerateOptions,
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
    const copies = Math.max(1, Math.round(this.options.copies ?? 1));
    this.lines.push(
      `! 0 ${HEADER_DPI} ${HEADER_DPI} ${this.dots(this.document.height)} ${copies}`,
    );
    if (this.options.includeSetup ?? true) {
      this.lines.push(`PAGE-WIDTH ${this.dots(this.document.width)}`);
      this.lines.push(...(this.document.preamble ?? []));
    }

    for (const element of this.document.elements) {
      const before = this.lines.length;
      this.element(element);
      // Most elements are one line and the last one written is the one that
      // draws; the few that write a bracket around themselves — a justified
      // line, a symbol block — record their own drawing line and keep it.
      if (this.origins[element.id] === undefined && this.lines.length > before) {
        this.origins[element.id] = this.lines.length;
      }
    }

    this.lines.push('FORM');
    this.lines.push('PRINT');
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

  private textCommand(element: LabelElement): string {
    switch (element.rotation ?? 0) {
      case 90:
        return 'TEXT90';
      case 180:
        return 'TEXT180';
      case 270:
        return 'TEXT270';
      default:
        return 'TEXT';
    }
  }

  private text(element: TextElement): void {
    const content = this.resolve(element.content, element);
    const height = Math.max(1, this.dots(element.style.heightMm));
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const command = this.textCommand(element);

    if (element.box) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.cpcl-no-block',
        message:
          'CPCL has no command that wraps text inside a box, so this text prints as one ' +
          'line. Break it into separate text elements to control where it wraps.',
      });
    }
    if (element.style.widthScale !== undefined && element.style.widthScale !== 1) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.cpcl-no-width-scale',
        message:
          'CPCL stretches text only in whole multiples, so a fractional width scale is ' +
          'printed at its natural width.',
      });
    }

    if (element.align === 'center' || element.align === 'right') {
      // CPCL justifies inside a span that starts where the text does, so the
      // span has to be placed to put its middle on the anchor.
      const pageWidth = this.dots(this.document.width);
      const room =
        element.align === 'center' ? Math.max(1, Math.min(x, pageWidth - x) * 2) : Math.max(1, x);
      const start = element.align === 'center' ? x - room / 2 : 0;
      this.lines.push(`${element.align === 'center' ? 'CENTER' : 'RIGHT'} ${Math.round(room)}`);
      this.lines.push(
        `${command} ${SCALABLE_FONT} ${height} ${Math.round(start)} ${y} ${content}`,
      );
      this.lines.push('LEFT');
      // The drawing line is the middle one, not the reset that follows it.
      this.origins[element.id] = this.lines.length - 1;
      return;
    }

    this.lines.push(`${command} ${SCALABLE_FONT} ${height} ${x} ${y} ${content}`);
  }

  private rectangle(element: RectangleElement): void {
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const width = Math.max(1, this.dots(element.width));
    const height = Math.max(1, this.dots(element.height));

    if (element.fill === 'erase') {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.cpcl-no-erase',
        message:
          'CPCL has no white shape to clear an area with, so this rectangle cannot be ' +
          'printed. Leave the area empty instead, or invert it.',
      });
      return;
    }

    if (element.cornerRadius && element.cornerRadius > 0) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.cpcl-no-rounding',
        message: 'CPCL boxes have square corners, so the corner radius is not printed.',
      });
    }

    if (element.fill === 'invert') {
      // INVERSE-LINE flips a band as thick as it is told, which is how CPCL
      // makes white on black.
      this.lines.push(`INVERSE-LINE ${x} ${y} ${x + width - 1} ${y} ${height}`);
      return;
    }

    const thickness =
      element.fill === 'solid'
        ? Math.min(width, height)
        : Math.max(1, this.dots(element.lineWidth ?? 0.3));
    this.lines.push(`BOX ${x} ${y} ${x + width - 1} ${y + height - 1} ${thickness}`);
  }

  private line(element: LineElement): void {
    const thickness = Math.max(1, this.dots(element.thickness));
    // CPCL draws a sloped line as readily as a straight one.
    this.lines.push(
      `LINE ${this.dots(element.x)} ${this.dots(element.y)} ` +
        `${this.dots(element.x2)} ${this.dots(element.y2)} ${thickness}`,
    );
  }

  private barcode(element: BarcodeElement): void {
    const data = this.resolve(element.data, element);
    const name = SYMBOLOGY_NAMES[element.symbology];
    if (name === undefined) {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.cpcl-no-symbology',
        values: { symbology: element.symbology },
        message: `CPCL has no ${element.symbology} barcode.`,
      });
      return;
    }

    const narrow = this.snap(element.moduleWidth, 1, 'Barcode module width', element);
    const wide = narrow * (element.wideRatio ?? 3);
    const height = Math.max(1, this.dots(element.height));
    const command = (element.rotation ?? 0) === 90 ? 'VBARCODE' : 'BARCODE';
    if ((element.rotation ?? 0) === 180 || (element.rotation ?? 0) === 270) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.cpcl-barcode-rotation',
        message:
          'CPCL prints a barcode upright or turned a quarter, so this one prints upright.',
      });
    }

    if (element.humanReadable) this.lines.push(`BARCODE-TEXT ${SCALABLE_FONT} 18 5`);
    this.lines.push(
      `${command} ${name} ${narrow} ${wide} ${height} ` +
        `${this.dots(element.x)} ${this.dots(element.y)} ${data}`,
    );
    if (element.humanReadable) {
      this.lines.push('BARCODE-TEXT OFF');
      this.origins[element.id] = this.lines.length - 1;
    }
  }

  private matrix(element: MatrixElement): void {
    const data = this.resolve(element.data, element);
    const module = this.snap(element.moduleWidth, 1, 'Module size', element);
    const x = this.dots(element.x);
    const y = this.dots(element.y);

    if (element.symbology === 'datamatrix') {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.cpcl-no-datamatrix',
        message:
          'This version does not write a CPCL Data Matrix. Use a QR code or a PDF417, ' +
          'both of which every CPCL printer draws.',
      });
      return;
    }

    if (element.symbology === 'qr') {
      const level = element.errorCorrection ?? 'M';
      this.lines.push(`B QR ${x} ${y} M 2 U ${module}`);
      this.lines.push(`${level}A,${data}`);
      this.lines.push('ENDQR');
      // The block opens on the first of these three lines.
      this.origins[element.id] = this.lines.length - 2;
      return;
    }

    try {
      const symbol = encodePdf417(data, {
        ...(element.columns === undefined ? {} : { columns: element.columns }),
      });
      const rowHeight = module * symbol.moduleAspect;
      const security = element.pdf417ErrorCorrection ?? 0;
      this.lines.push(
        `B PDF-417 ${x} ${y} XD ${module} YD ${rowHeight}` +
          `${element.columns ? ` C ${element.columns}` : ''}${security > 0 ? ` S ${security}` : ''}`,
      );
      this.lines.push(data);
      this.lines.push('ENDPDF');
      this.origins[element.id] = this.lines.length - 2;
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

export function generateCpcl(
  document: LabelDocument,
  options: CpclGenerateOptions = {},
): CpclGenerateResult {
  const generator = new Generator(document, options);
  generator.generate();
  return {
    source: `${generator.lines.join('\n')}\n`,
    issues: generator.issues,
    origins: generator.origins,
  };
}
