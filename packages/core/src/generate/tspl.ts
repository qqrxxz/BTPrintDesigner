import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import { encodePdf417, type Pdf417ErrorCorrection } from '../barcode/pdf417/encode.js';
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
import { resolveText, type GenerationIssue, type TextResolution } from './shared.js';
import { dotsPerMm, type Dpi } from '../util/units.js';

/**
 * Generates TSPL from a label document.
 *
 * The generator is the only place that knows about dots. It takes millimetres
 * from the model, snaps them to the printer's grid, and reports where the snap
 * moved something enough to matter — a barcode module rounded from 0.24 mm to
 * two dots is a different barcode, and the designer should hear about it here
 * rather than discover it at the scanner.
 */

export interface TsplGenerateOptions {
  readonly dpi?: Dpi;
  /**
   * Replaces DataMobile variables with sample values, for the preview. The
   * file DataMobile receives keeps them as written.
   */
  readonly resolveVariables?: boolean;
  /**
   * Values for placeholders. Without them a placeholder reaches the printer as
   * written, which is what a template file is for.
   */
  readonly data?: Readonly<Record<string, string>>;
  readonly copies?: number;
  /** Emit the setup lines a standalone job needs. On by default. */
  readonly includeSetup?: boolean;
}

export type { GenerationIssue } from './shared.js';

export interface TsplGenerateResult {
  readonly source: string;
  readonly issues: readonly GenerationIssue[];
  /**
   * The line each element was written to, one-based.
   *
   * This is what lets an editor tie a selection on the canvas to a line of
   * code, and to the outline the renderer reports for that line.
   */
  readonly origins: Readonly<Record<string, number>>;
}

/** Below this the snap is invisible; above it the printed size really changes. */
const SNAP_TOLERANCE = 0.1;

const SYMBOLOGY_NAMES: Readonly<Record<BarcodeElement['symbology'], string>> = {
  code128: '128',
  'gs1-128': 'EAN128',
  code39: '39',
  itf: '25',
  ean13: 'EAN13',
  ean8: 'EAN8',
  upca: 'UPCA',
  upce: 'UPCE',
};

/** Symbologies whose check digit is opted into, spelt with a trailing C. */
const CHECK_DIGIT_NAMES: Partial<Record<BarcodeElement['symbology'], string>> = {
  code39: '39C',
  itf: '25C',
};

class Generator {
  readonly lines: string[] = [];
  readonly issues: GenerationIssue[] = [];
  readonly origins: Record<string, number> = {};
  private readonly perMm: number;

  constructor(
    private readonly document: LabelDocument,
    private readonly options: TsplGenerateOptions,
  ) {
    this.perMm = dotsPerMm(options.dpi ?? 203);
  }

  private dots(mm: number): number {
    return Math.round(mm * this.perMm);
  }

  /** Snaps a measurement to whole dots, complaining when the snap is visible. */
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
    return this.resolveFully(text, element).text;
  }

  /**
   * Resolution with the measuring copy kept.
   *
   * Only the symbols whose command carries their size need it; everything else
   * takes the text and nothing more.
   */
  private resolveFully(text: string, element: LabelElement): TextResolution {
    const resolved = resolveText(text, element, this.document, this.options);
    this.issues.push(...resolved.issues);
    return resolved;
  }

  /** Says that a symbol's declared size is a guess while a variable stands in it. */
  private warnAboutVariableSize(element: LabelElement, symbology: string): void {
    this.issues.push({
      severity: 'warning',
      elementId: element.id,
      code: 'generate.variable-symbol-size',
      values: { symbology },
      message:
        `This ${symbology} carries a DataMobile variable, and the command has to state ` +
        'the symbol size. The size written is the one a sample value needs; a longer ' +
        'value will need more room.',
    });
  }

  generate(): void {
    const setup = this.options.includeSetup ?? true;
    const preamble = this.document.preamble ?? [];
    this.lines.push(`SIZE ${this.document.width} mm, ${this.document.height} mm`);
    if (setup) {
      const gap = this.document.gap ?? { height: 2, offset: 0 };
      this.lines.push(`GAP ${gap.height} mm, ${gap.offset} mm`);
      // The preamble may already set a direction; emitting the default as well
      // would leave two contradictory lines for a reader to puzzle over.
      if (!preamble.some((line) => /^\s*DIRECTION\b/i.test(line))) {
        this.lines.push('DIRECTION 0');
      }
      this.lines.push(...preamble);
    }
    this.lines.push('CLS');

    for (const element of this.document.elements) {
      const before = this.lines.length;
      this.element(element);
      // An element that could not be expressed writes no line and gets no
      // origin, which is how a caller knows it is missing from the code. The
      // line recorded is the last one written, which is the one that draws.
      if (this.lines.length > before) this.origins[element.id] = this.lines.length;
    }

    this.lines.push(`PRINT ${Math.max(1, Math.round(this.options.copies ?? 1))},1`);
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

  private text(element: TextElement): void {
    const content = quote(this.resolve(element.content, element));
    const height = Math.max(1, this.dots(element.style.heightMm));
    const width = Math.max(1, Math.round(height * (element.style.widthScale ?? 1)));
    const alignment = element.align === 'center' ? 2 : element.align === 'right' ? 3 : 1;

    // A pinned resident font keeps its own multipliers; otherwise font "0" is
    // used, where the multipliers are the character size in dots and the height
    // comes out exactly as designed.
    const pinned = element.style.residentFont;
    const font = pinned ?? '0';
    const multiplier = element.style.residentMultiplier;
    const xMultiplier = pinned ? (multiplier?.x ?? 1) : width;
    const yMultiplier = pinned ? (multiplier?.y ?? 1) : height;

    if (element.box) {
      const gap = this.dots(element.style.lineGapMm ?? 0);
      this.lines.push(
        `BLOCK ${this.dots(element.x)},${this.dots(element.y)},` +
          `${this.dots(element.box.width)},${this.dots(element.box.height)},` +
          `"${font}",${element.rotation ?? 0},${xMultiplier},${yMultiplier},` +
          `${gap},${alignment},"${content}"`,
      );
      return;
    }

    this.lines.push(
      `TEXT ${this.dots(element.x)},${this.dots(element.y)},"${font}",` +
        `${element.rotation ?? 0},${xMultiplier},${yMultiplier},${alignment},"${content}"`,
    );
  }

  private rectangle(element: RectangleElement): void {
    const x = this.dots(element.x);
    const y = this.dots(element.y);
    const width = Math.max(1, this.dots(element.width));
    const height = Math.max(1, this.dots(element.height));

    if (element.fill === 'solid') {
      this.lines.push(`BAR ${x},${y},${width},${height}`);
      return;
    }
    if (element.fill === 'invert') {
      this.lines.push(`REVERSE ${x},${y},${width},${height}`);
      return;
    }
    if (element.fill === 'erase') {
      this.lines.push(`ERASE ${x},${y},${width},${height}`);
      return;
    }

    const thickness = Math.max(1, this.dots(element.lineWidth ?? 0.3));
    // BOX names opposite corners inclusively, so the far edge is one dot back.
    const box = `BOX ${x},${y},${x + width - 1},${y + height - 1},${thickness}`;
    const radius = element.cornerRadius ? this.dots(element.cornerRadius) : 0;
    this.lines.push(radius > 0 ? `${box},${radius}` : box);
  }

  private line(element: LineElement): void {
    const thickness = Math.max(1, this.dots(element.thickness));
    const horizontal = Math.abs(element.y2 - element.y) < 1e-9;
    const vertical = Math.abs(element.x2 - element.x) < 1e-9;

    if (!horizontal && !vertical) {
      this.issues.push({
        severity: 'error',
        elementId: element.id,
        code: 'generate.diagonal-line',
        message:
          'TSPL has no diagonal line command, so this line cannot be printed. ' +
          'Make it horizontal or vertical, or move it to a ZPL job.',
      });
      return;
    }

    const x = this.dots(Math.min(element.x, element.x2));
    const y = this.dots(Math.min(element.y, element.y2));
    if (horizontal) {
      const length = Math.max(1, this.dots(Math.abs(element.x2 - element.x)));
      this.lines.push(`BAR ${x},${y},${length},${thickness}`);
    } else {
      const length = Math.max(1, this.dots(Math.abs(element.y2 - element.y)));
      this.lines.push(`BAR ${x},${y},${thickness},${length}`);
    }
  }

  private barcode(element: BarcodeElement): void {
    const data = this.resolve(element.data, element);
    const narrow = this.snap(element.moduleWidth, 1, 'Barcode module width', element);
    const ratio = element.wideRatio ?? 3;
    const wide = narrow * (CHECK_DIGIT_NAMES[element.symbology] ? ratio : 2);
    const height = Math.max(1, this.dots(element.height));

    const name =
      element.checkDigit && CHECK_DIGIT_NAMES[element.symbology]
        ? CHECK_DIGIT_NAMES[element.symbology]!
        : SYMBOLOGY_NAMES[element.symbology];

    this.lines.push(
      `BARCODE ${this.dots(element.x)},${this.dots(element.y)},"${name}",${height},` +
        `${element.humanReadable ? 1 : 0},${element.rotation ?? 0},${narrow},${wide},` +
        `"${quote(data)}"`,
    );
  }

  private matrix(element: MatrixElement): void {
    const resolved = this.resolveFully(element.data, element);
    const data = resolved.text;
    const module = this.snap(element.moduleWidth, 1, 'Module size', element);
    const x = this.dots(element.x);
    const y = this.dots(element.y);

    if (element.symbology === 'qr') {
      const level = element.errorCorrection ?? 'M';
      this.lines.push(`QRCODE ${x},${y},${level},${module},A,${element.rotation ?? 0},"${quote(data)}"`);
      return;
    }

    // Data Matrix and PDF417 are told the box to fit inside, so the generator
    // has to encode the symbol here to know how large that box is.
    // Only these two write the symbol's size into the command; the QR branch
    // above states a module size and has already returned.
    if (resolved.hasVariables) {
      this.warnAboutVariableSize(
        element,
        element.symbology === 'datamatrix' ? 'Data Matrix' : 'PDF417',
      );
    }

    try {
      if (element.symbology === 'datamatrix') {
        const symbol = encodeDataMatrix(resolved.sized);
        this.lines.push(
          `DMATRIX ${x},${y},${symbol.width * module},${symbol.height * module},"${quote(data)}"`,
        );
        return;
      }

      const options: { columns?: number; errorCorrection?: Pdf417ErrorCorrection } = {};
      if (element.columns !== undefined) options.columns = element.columns;
      if (element.pdf417ErrorCorrection !== undefined) {
        options.errorCorrection = element.pdf417ErrorCorrection as Pdf417ErrorCorrection;
      }
      const symbol = encodePdf417(resolved.sized, options);
      const rowHeight = module * symbol.moduleAspect;
      const parts = [`W${module}`, `H${rowHeight}`];
      if (element.columns !== undefined) parts.push(`C${element.columns}`);
      if (element.pdf417ErrorCorrection !== undefined) {
        parts.push(`E${element.pdf417ErrorCorrection}`);
      }
      this.lines.push(
        `PDF417 ${x},${y},${symbol.width * module},${symbol.height * rowHeight},` +
          `${element.rotation ?? 0},${parts.join(',')},"${quote(data)}"`,
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

/** Escapes the two characters a TSPL content string cannot carry raw. */
function quote(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function generateTspl(
  document: LabelDocument,
  options: TsplGenerateOptions = {},
): TsplGenerateResult {
  const generator = new Generator(document, options);
  generator.generate();
  return {
    source: `${generator.lines.join('\n')}\n`,
    issues: generator.issues,
    origins: generator.origins,
  };
}
