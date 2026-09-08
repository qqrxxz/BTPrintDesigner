import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import { encodePdf417 } from '../barcode/pdf417/encode.js';
import { BarcodeError } from '../barcode/types.js';
import { applyGs1Separator } from '../model/gs1.js';
import type {
  BarcodeElement,
  LabelDocument,
  LabelElement,
  LineElement,
  MatrixElement,
  RectangleElement,
  TextElement,
} from '../model/document.js';
import { dotsPerMm, type Dpi } from '../util/units.js';
import { resolveText, type GenerationIssue, type TextResolution } from './shared.js';

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
  /**
   * Replaces DataMobile variables with sample values, for the preview. The
   * file DataMobile receives keeps them as written.
   */
  readonly resolveVariables?: boolean;
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
    // ^CI28 is ZPL's way of saying the field data is UTF-8. There is no number
    // here for Windows-1251 that this program is prepared to guess at, so a
    // 1251 file is written in 1251 bytes and the code is left to say what it
    // already said — which is what the printer's own setting decides.
    const utf8 = this.document.encoding === 'utf-8';
    const preamble = (this.document.preamble ?? []).filter(
      (line) => !utf8 || !/\^CI\d+/i.test(line),
    );

    this.lines.push('^XA');
    if (setup) {
      this.lines.push(`^PW${this.dots(this.document.width)}`);
      this.lines.push(`^LL${this.dots(this.document.height)}`);
      if (utf8) this.lines.push('^CI28');
      this.lines.push(...preamble);
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
    const resolved = this.resolveFully(element.data, element);
    // The file keeps the separator token; the preview reads it as FNC1's stand-in.
    const data =
      this.options.resolveVariables === true
        ? applyGs1Separator(resolved.text, element.gs1Separator)
        : resolved.text;
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

    this.lines.push(`^FO${x},${y}^${command}${parameters}${this.symbolData(data, element)}^FS`);
  }

  /**
   * Field data for a symbol, leaving a GS1 separator token alone.
   *
   * ZPL reads `~` and `^` as the start of a command and `^FH` exists to send
   * them as data — but the separator token is not data: it is there precisely
   * so that the printer acts on it. It therefore goes out as written, and
   * anything else in the payload that ZPL would read as a command is reported
   * rather than quietly escaped into something the printer would print.
   */
  private symbolData(data: string, element: MatrixElement | BarcodeElement): string {
    const token = element.gs1Separator;
    if (token === undefined || token === 'none' || !data.includes(token)) {
      return fieldData(data);
    }
    const rest = data.split(token).join('');
    if (/[\^~]/.test(rest)) {
      this.issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.zpl-caret-in-gs1',
        message:
          'This payload contains ^ or ~ outside the separator token. ZPL reads both as ' +
          'the start of a command, and they cannot be escaped without also escaping the ' +
          'token, so they are sent as they are.',
      });
    }
    return `^FD${data}`;
  }

  private matrix(element: MatrixElement): void {
    const resolved = this.resolveFully(element.data, element);
    // The file keeps the separator token, because that is what the printer
    // reads; the preview and every measurement read it as the character.
    const separator = (text: string): string => applyGs1Separator(text, element.gs1Separator);
    const data = this.options.resolveVariables === true ? separator(resolved.text) : resolved.text;
    const sized = separator(resolved.sized);
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
      if (element.symbology === 'datamatrix' || element.symbology === 'gs1-datamatrix') {
        // Encoded only to find out whether it can be: ^BX states a module size
        // rather than a symbol size, so the printer chooses the shape itself.
        encodeDataMatrix(sized, { gs1: element.symbology === 'gs1-datamatrix' });
        this.lines.push(
          `^FO${x},${y}^BX${facing},${module},200${this.symbolData(data, element)}^FS`,
        );
        return;
      }
      const symbol = encodePdf417(sized, {
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
