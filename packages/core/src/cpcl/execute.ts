import { encodeCode128 } from '../barcode/code128.js';
import { encodeCode39 } from '../barcode/code39.js';
import { encodeEan13, encodeEan8, encodeUpcA, encodeUpcE } from '../barcode/ean.js';
import { encodeItf } from '../barcode/itf.js';
import { renderMatrix, type MatrixSymbol } from '../barcode/matrix.js';
import { encodePdf417 } from '../barcode/pdf417/encode.js';
import { encodeQr } from '../barcode/qr/encode.js';
import type { ErrorCorrectionLevel } from '../barcode/qr/tables.js';
import { renderLinear } from '../barcode/render.js';
import { BarcodeError, type LinearSymbol } from '../barcode/types.js';
import { Bitmap1, type Rotation } from '../bitmap/Bitmap1.js';
import { drawText, measureText } from '../text/text.js';
import type { CommandBounds } from '../tspl/execute.js';
import type { Diagnostic } from '../tspl/parse.js';
import { dotsToMm, type Dpi } from '../util/units.js';
import { resolveCpclFont, type CpclFontOptions, type CpclFontSet } from './fonts.js';
import { numberAt, parseCpcl, tailFrom, wordAt, type CpclCommand } from './parse.js';

/**
 * CPCL interpreter.
 *
 * CPCL is the plainest of the three languages: one command a line, whitespace
 * between the parameters, and a header that states the label's height and the
 * number of copies before anything is drawn. Its two-dimensional symbols are
 * the exception — they open a block, take their payload on the lines that
 * follow, and close it with an END word.
 *
 * As with TSPL and ZPL nothing throws, and an unreadable line becomes a
 * diagnostic rather than a blank label.
 */

export interface CpclRenderOptions {
  readonly dpi?: Dpi;
  readonly fonts: CpclFontSet;
  readonly fontOptions?: CpclFontOptions;
  /** Used until the job says `PAGE-WIDTH`. */
  readonly defaultWidthDots?: number;
  readonly maxDots?: number;
}

export interface CpclLabel {
  readonly bitmap: Bitmap1;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly copies: number;
}

export interface CpclRenderResult {
  readonly labels: readonly CpclLabel[];
  readonly diagnostics: readonly Diagnostic[];
  readonly commands: readonly CpclCommand[];
  readonly bounds: readonly CommandBounds[];
}

const DEFAULT_WIDTH_DOTS = 576;
const DEFAULT_HEIGHT_DOTS = 406;
const DEFAULT_MAX_DOTS = 20000;

type Units = 'dots' | 'mm' | 'inches';
type Justification = 'left' | 'center' | 'right';

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

const LINEAR_TYPES: Readonly<Record<string, string>> = {
  '128': 'code128',
  UCCEAN128: 'gs1-128',
  '39': 'code39',
  I2OF5: 'itf',
  UPCA: 'upca',
  UPCE: 'upce',
  EAN13: 'ean13',
  EAN8: 'ean8',
};

interface MatrixBlock {
  readonly kind: 'qr' | 'pdf417';
  readonly x: number;
  readonly y: number;
  readonly moduleSize: number;
  readonly rowHeight: number;
  readonly columns: number;
  readonly errorCorrection: string;
  readonly command: CpclCommand;
  readonly lines: string[];
}

class Interpreter {
  readonly diagnostics: Diagnostic[] = [];
  readonly labels: CpclLabel[] = [];
  readonly bounds: CommandBounds[] = [];

  private readonly dpi: Dpi;
  private readonly fonts: CpclFontSet;
  private readonly fontOptions: CpclFontOptions;
  private readonly maxDots: number;
  private readonly source: string;

  private widthDots: number;
  private heightDots = DEFAULT_HEIGHT_DOTS;
  private bitmap: Bitmap1;
  private offsetX = 0;
  private copies = 1;
  private printed = false;

  private units: Units = 'dots';
  private magnification = { x: 1, y: 1 };
  private justification: Justification = 'left';
  private justificationWidth = 0;
  private barcodeText: { font: string; size: number; gap: number } | undefined;
  private block: MatrixBlock | undefined;
  private warnedAboutFonts = false;

  constructor(source: string, options: CpclRenderOptions) {
    this.source = source;
    this.dpi = options.dpi ?? 203;
    this.fonts = options.fonts;
    this.fontOptions = options.fontOptions ?? {};
    this.maxDots = options.maxDots ?? DEFAULT_MAX_DOTS;
    this.widthDots = options.defaultWidthDots ?? DEFAULT_WIDTH_DOTS;
    this.bitmap = new Bitmap1(this.widthDots, this.heightDots);
  }

  private report(
    severity: Diagnostic['severity'],
    message: string,
    at: CpclCommand,
    code?: string,
    values?: Diagnostic['values'],
  ): void {
    this.diagnostics.push({
      severity,
      message,
      ...(code === undefined ? {} : { code }),
      ...(values === undefined ? {} : { values }),
      line: at.span.line,
      column: at.span.column,
      length: at.span.end - at.span.start,
    });
  }

  private touch(at: CpclCommand, x: number, y: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.bounds.push({
      line: at.span.line,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  /** A coordinate in dots, honouring the unit mode the job selected. */
  private coordinate(value: number): number {
    if (this.units === 'mm') return Math.round((value / 25.4) * this.dpi);
    if (this.units === 'inches') return Math.round(value * this.dpi);
    return Math.round(value);
  }

  private resize(width: number, height: number, at: CpclCommand): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w > this.maxDots || h > this.maxDots) {
      this.report(
        'error',
        `Label size ${w} by ${h} dots exceeds the ${this.maxDots} dot limit`,
        at,
        'cpcl.label-too-large',
        { width: w, height: h, limit: this.maxDots },
      );
      return;
    }
    if (w === this.bitmap.width && h === this.bitmap.height) return;
    const previous = this.bitmap;
    this.widthDots = w;
    this.heightDots = h;
    this.bitmap = new Bitmap1(w, h);
    this.bitmap.blit(previous, 0, 0);
  }

  execute(command: CpclCommand): void {
    // A two-dimensional symbol takes its payload from the lines that follow it,
    // so while a block is open every line belongs to it.
    if (this.block) {
      if (command.name === 'ENDQR' || command.name === 'ENDPDF' || command.name === 'END') {
        this.closeBlock();
        return;
      }
      this.block.lines.push(command.raw);
      return;
    }

    switch (command.name) {
      case '!': {
        // ! offset xdpi ydpi height quantity — the dpi figures in the header
        // are nominal on every printer this targets, so the real resolution
        // comes from the profile rather than from here.
        this.offsetX = numberAt(command, 0, 0);
        this.resize(this.widthDots, numberAt(command, 3, DEFAULT_HEIGHT_DOTS), command);
        this.copies = Math.max(1, Math.round(numberAt(command, 4, 1)));
        return;
      }
      case 'PAGE-WIDTH':
      case 'PW':
        return this.resize(this.coordinate(numberAt(command, 0, this.widthDots)), this.heightDots, command);
      case 'IN-DOTS':
        this.units = 'dots';
        return;
      case 'IN-MILLIMETERS':
        this.units = 'mm';
        return;
      case 'IN-INCHES':
        this.units = 'inches';
        return;
      case 'SETMAG':
        this.magnification = {
          x: Math.max(1, Math.round(numberAt(command, 0, 1))),
          y: Math.max(1, Math.round(numberAt(command, 1, 1))),
        };
        return;
      case 'LEFT':
      case 'CENTER':
      case 'RIGHT':
        this.justification =
          command.name === 'CENTER' ? 'center' : command.name === 'RIGHT' ? 'right' : 'left';
        this.justificationWidth = this.coordinate(numberAt(command, 0, 0));
        return;
      case 'BARCODE-TEXT':
      case 'BT':
        if (wordAt(command, 0, '') === 'OFF' || command.parameters.length === 0) {
          this.barcodeText = undefined;
        } else {
          this.barcodeText = {
            font: command.parameters[0] ?? '0',
            size: numberAt(command, 1, 0),
            gap: numberAt(command, 2, 1),
          };
        }
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

      case 'FORM':
        return;
      case 'PRINT':
        this.snapshot();
        return;

      // Recognised, and with no effect on the picture.
      case 'GAP-SENSE':
      case 'BAR-SENSE':
      case 'CONTINUOUS':
      case 'POSTFEED':
      case 'PREFEED':
      case 'SETSP':
      case 'SETBOLD':
      case 'ML':
      case 'COUNTRY':
      case 'ENCODING':
      case 'SPEED':
      case 'TONE':
      case 'CONTRAST':
      case 'JOURNAL':
      case 'BEEP':
      case 'CUT':
      case 'PACE':
      case 'PAGE':
      case 'POPULATE':
      case 'NO-PACE':
        return;

      case 'PCX':
      case 'CG':
      case 'EG':
      case 'ICON':
        this.report(
          'warning',
          `${command.name} places an image, which this version does not render. ` +
            'The rest of the label is unaffected.',
          command,
          'cpcl.image-not-drawn',
          { command: command.name },
        );
        return;

      // Printer settings a `! UTILITIES` session carries. They change how the
      // printer feeds and times out, and put nothing on a label.
      case 'SET-TOF':
      case 'REWIND-ON':
      case 'REWIND-OFF':
      case 'ON-FEED':
      case 'TIMEOUT':
        return;
      default:
        if (TEXT_ROTATIONS[command.name] !== undefined) return this.text(command);
        this.report(
          'warning',
          `Unknown command "${command.name}"`,
          command,
          'cpcl.unknown-command',
          { command: command.name },
        );
    }
  }

  private text(command: CpclCommand): void {
    const rotation = TEXT_ROTATIONS[command.name]!;
    const font = command.parameters[0] ?? '0';
    const size = numberAt(command, 1, 0);
    const x = this.coordinate(numberAt(command, 2, 0)) + this.offsetX;
    const y = this.coordinate(numberAt(command, 3, 0));
    const content = tailFrom(command, this.source, 4);
    if (content.length === 0) return;

    const resolved = resolveCpclFont(this.fonts, font, size, this.magnification, this.fontOptions);
    if (resolved.approximate && !this.warnedAboutFonts) {
      this.warnedAboutFonts = true;
      this.report(
        'info',
        `Font ${font} size ${size} is a size index, and the height it stands for varies ` +
          'between printer families. This preview uses a default ladder that can be corrected.',
        command,
        'cpcl.font-approximate',
        { font, size },
      );
    }

    const width = measureText(content, resolved.style).width;
    const room = this.justificationWidth > 0 ? this.justificationWidth : this.widthDots - x;
    const offset =
      this.justification === 'center'
        ? (room - width) / 2
        : this.justification === 'right'
          ? room - width
          : 0;

    drawText(this.bitmap, content, x + offset, y, resolved.style, {
      rotation,
      anchor: 'top-left',
    });
    const turned = rotation === 90 || rotation === 270;
    this.touch(
      command,
      x + offset,
      y,
      turned ? resolved.lineHeight : width,
      turned ? width : resolved.lineHeight,
    );
  }

  /** LINE and BOX both name two corners and a thickness. */
  private corners(command: CpclCommand): {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    thickness: number;
  } {
    return {
      x0: this.coordinate(numberAt(command, 0, 0)) + this.offsetX,
      y0: this.coordinate(numberAt(command, 1, 0)),
      x1: this.coordinate(numberAt(command, 2, 0)) + this.offsetX,
      y1: this.coordinate(numberAt(command, 3, 0)),
      thickness: Math.max(1, this.coordinate(numberAt(command, 4, 1))),
    };
  }

  private line(command: CpclCommand): void {
    const { x0, y0, x1, y1, thickness } = this.corners(command);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0) + 1;
    const height = Math.abs(y1 - y0) + 1;

    if (y0 === y1) {
      this.bitmap.fillRect(left, top, width, thickness);
      this.touch(command, left, top, width, thickness);
      return;
    }
    if (x0 === x1) {
      this.bitmap.fillRect(left, top, thickness, height);
      this.touch(command, left, top, thickness, height);
      return;
    }

    // A sloped line gets a run of `thickness` dots on each row, the same shape
    // ZPL's diagonal takes.
    for (let row = 0; row < height; row++) {
      const along = (row + 0.5) / height;
      const downhill = (x1 - x0) * (y1 - y0) > 0;
      const edge = Math.round(downhill ? width * along : width * (1 - along));
      for (let column = edge; column < edge + thickness; column++) {
        if (column < 0 || column >= width) continue;
        this.bitmap.set(left + column, top + row, 1);
      }
    }
    this.touch(command, left, top, width, height);
  }

  private box(command: CpclCommand): void {
    const { x0, y0, x1, y1, thickness } = this.corners(command);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0) + 1;
    const height = Math.abs(y1 - y0) + 1;

    if (thickness * 2 >= width || thickness * 2 >= height) {
      this.bitmap.fillRect(left, top, width, height);
    } else {
      this.bitmap.fillRect(left, top, width, thickness);
      this.bitmap.fillRect(left, top + height - thickness, width, thickness);
      this.bitmap.fillRect(left, top + thickness, thickness, height - thickness * 2);
      this.bitmap.fillRect(left + width - thickness, top + thickness, thickness, height - thickness * 2);
    }
    this.touch(command, left, top, width, height);
  }

  private inverseLine(command: CpclCommand): void {
    const { x0, y0, x1, y1, thickness } = this.corners(command);
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.max(thickness, Math.abs(x1 - x0) + 1);
    const height = Math.max(thickness, Math.abs(y1 - y0) + 1);
    // INVERSE-LINE flips what is under it, which is how CPCL makes white text.
    const band = y0 === y1 ? { width, height: thickness } : { width: thickness, height };
    this.bitmap.invertRect(left, top, band.width, band.height);
    this.touch(command, left, top, band.width, band.height);
  }

  private barcode(command: CpclCommand): void {
    const vertical = command.name === 'VBARCODE' || command.name === 'VB';
    const type = wordAt(command, 0, '');

    if (type === 'QR' || type === 'PDF-417' || type === 'PDF417') {
      this.openBlock(command, type === 'QR' ? 'qr' : 'pdf417');
      return;
    }
    if (type === 'DATAMATRIX' || type === 'MAXICODE' || type === 'AZTEC') {
      this.report(
        'warning',
        `This version does not draw a CPCL ${type} symbol. ` +
          'The rest of the label is unaffected.',
        command,
        'cpcl.symbology-unsupported',
        { symbology: type },
      );
      return;
    }

    const kind = LINEAR_TYPES[type];
    if (!kind) {
      this.report(
        'error',
        `Barcode type "${type}" is not supported yet`,
        command,
        'cpcl.symbology-unsupported',
        { symbology: type },
      );
      return;
    }

    // BARCODE type narrow wide height x y data
    const narrow = Math.max(1, Math.round(numberAt(command, 1, 2)));
    const wide = Math.max(narrow, Math.round(numberAt(command, 2, narrow * 2)));
    const height = Math.max(1, this.coordinate(numberAt(command, 3, 50)));
    const x = this.coordinate(numberAt(command, 4, 0)) + this.offsetX;
    const y = this.coordinate(numberAt(command, 5, 0));
    const data = tailFrom(command, this.source, 6).trim();

    let symbol: LinearSymbol;
    try {
      symbol = encodeLinear(kind, data, wide / narrow >= 2.5 ? 3 : 2);
    } catch (error) {
      this.report(
        'error',
        error instanceof BarcodeError ? error.message : `Cannot encode a "${type}" barcode`,
        command,
        'cpcl.barcode-failed',
        { symbology: type, data },
      );
      return;
    }

    const rendered = renderLinear(symbol, {
      moduleWidth: narrow,
      height,
      descenderExtension: symbol.descenders ? Math.round((13 / 203) * this.dpi) : 0,
      quietZone: false,
    });

    let composed = rendered;
    if (this.barcodeText) {
      const resolved = resolveCpclFont(
        this.fonts,
        this.barcodeText.font,
        this.barcodeText.size,
        { x: 1, y: 1 },
        this.fontOptions,
      );
      const line = measureText(symbol.text, resolved.style);
      const strip = new Bitmap1(
        Math.max(rendered.width, Math.ceil(line.width)),
        Math.ceil(resolved.lineHeight) + Math.max(0, this.barcodeText.gap),
      );
      drawText(
        strip,
        symbol.text,
        Math.max(0, (rendered.width - line.width) / 2),
        Math.max(0, this.barcodeText.gap),
        resolved.style,
        { anchor: 'top-left' },
      );
      const combined = new Bitmap1(
        Math.max(rendered.width, strip.width),
        rendered.height + strip.height,
      );
      combined.blit(rendered, 0, 0);
      combined.blit(strip, 0, rendered.height);
      composed = combined;
    }

    const placed = vertical ? composed.rotated(90) : composed;
    this.bitmap.blit(placed, x, y);
    this.touch(command, x, y, placed.width, placed.height);
  }

  private openBlock(command: CpclCommand, kind: 'qr' | 'pdf417'): void {
    const x = this.coordinate(numberAt(command, 1, 0)) + this.offsetX;
    const y = this.coordinate(numberAt(command, 2, 0));

    // The remaining parameters are keyword pairs: M 2 U 6 for a QR code,
    // XD 3 YD 12 C 3 S 2 for a PDF417.
    const keywords = new Map<string, string>();
    for (let i = 3; i < command.parameters.length; i += 2) {
      const key = command.parameters[i]?.toUpperCase();
      const value = command.parameters[i + 1];
      if (key !== undefined && value !== undefined) keywords.set(key, value);
    }

    this.block = {
      kind,
      x,
      y,
      moduleSize: Math.max(1, Math.round(Number(keywords.get(kind === 'qr' ? 'U' : 'XD') ?? 4))),
      rowHeight: Math.max(1, Math.round(Number(keywords.get('YD') ?? 12))),
      columns: Math.max(0, Math.round(Number(keywords.get('C') ?? 0))),
      errorCorrection: keywords.get('S') ?? '',
      command,
      lines: [],
    };
  }

  private closeBlock(): void {
    const block = this.block;
    this.block = undefined;
    if (!block) return;

    const payload = block.lines.join('\n');
    let symbol: MatrixSymbol;
    try {
      if (block.kind === 'qr') {
        // The payload carries its own error correction and input mode, as it
        // does in ZPL: "MA," or "QA," before the data.
        const match = /^([HQML])([AM]),(.*)$/s.exec(payload);
        symbol = encodeQr(match?.[3] ?? payload, {
          errorCorrection: (match?.[1] ?? 'M') as ErrorCorrectionLevel,
        });
      } else {
        const security = Number(block.errorCorrection);
        symbol = encodePdf417(payload, {
          ...(block.columns > 0 ? { columns: block.columns } : {}),
          ...(Number.isFinite(security) && security > 0
            ? { errorCorrection: Math.min(8, Math.max(0, security)) as 0 }
            : {}),
        });
      }
    } catch (error) {
      this.report(
        'error',
        error instanceof BarcodeError ? error.message : 'This symbol cannot be encoded',
        block.command,
        'cpcl.symbol-failed',
        { symbology: block.kind },
      );
      return;
    }

    const rendered = renderMatrix(symbol, {
      moduleWidth: block.moduleSize,
      ...(block.kind === 'pdf417' ? { moduleHeight: block.rowHeight } : {}),
      quietZone: false,
    });
    this.bitmap.blit(rendered, block.x, block.y);
    this.touch(block.command, block.x, block.y, rendered.width, rendered.height);
  }

  private snapshot(): void {
    this.labels.push({
      bitmap: this.bitmap.clone(),
      widthMm: dotsToMm(this.widthDots, this.dpi),
      heightMm: dotsToMm(this.heightDots, this.dpi),
      copies: this.copies,
    });
    this.printed = true;
    this.bitmap = new Bitmap1(this.widthDots, this.heightDots);
  }

  finish(): void {
    this.closeBlock();
    if (!this.printed) this.snapshot();
  }
}

function encodeLinear(kind: string, data: string, ratio: 2 | 3): LinearSymbol {
  switch (kind) {
    case 'code128':
      return encodeCode128(data);
    case 'gs1-128':
      return encodeCode128(data, { gs1: true });
    case 'code39':
      return encodeCode39(data, { wideRatio: ratio });
    case 'ean13':
      return encodeEan13(data);
    case 'ean8':
      return encodeEan8(data);
    case 'upca':
      return encodeUpcA(data);
    case 'upce':
      return encodeUpcE(data);
    default:
      return encodeItf(data, { wideRatio: ratio });
  }
}

export function renderCpcl(source: string, options: CpclRenderOptions): CpclRenderResult {
  const parsed = parseCpcl(source);
  const interpreter = new Interpreter(source, options);
  for (const command of parsed.commands) interpreter.execute(command);
  interpreter.finish();

  return {
    labels: interpreter.labels,
    diagnostics: [...parsed.diagnostics, ...interpreter.diagnostics].sort(
      (a, b) => a.line - b.line || a.column - b.column,
    ),
    commands: parsed.commands,
    bounds: interpreter.bounds,
  };
}
