import { encodeCode128 } from '../barcode/code128.js';
import { encodeCode39 } from '../barcode/code39.js';
import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
import { encodeEan13, encodeEan8, encodeUpcA, encodeUpcE } from '../barcode/ean.js';
import { encodeItf } from '../barcode/itf.js';
import { renderMatrix, type MatrixSymbol } from '../barcode/matrix.js';
import { encodePdf417, type Pdf417ErrorCorrection } from '../barcode/pdf417/encode.js';
import { encodeQr } from '../barcode/qr/encode.js';
import type { ErrorCorrectionLevel } from '../barcode/qr/tables.js';
import { renderLinear } from '../barcode/render.js';
import { BarcodeError, type LinearSymbol } from '../barcode/types.js';
import { Bitmap1, type Rotation } from '../bitmap/Bitmap1.js';
import { drawText, measureText } from '../text/text.js';
import { dotsToMm, mmToDots, type Dpi } from '../util/units.js';
import { INTERNAL_FONTS, resolveFont, type TsplFontSet } from './fonts.js';
import {
  parseTspl,
  type Diagnostic,
  type TsplArgument,
  type TsplCommand,
} from './parse.js';

/**
 * TSPL interpreter.
 *
 * Commands are executed against a one-bit label buffer in the order a printer
 * would execute them, and the result is the image a thermal head would burn.
 * Nothing is thrown: an unreadable command produces a diagnostic and the rest
 * of the label still renders, because a preview that goes blank the moment you
 * mistype tells you less than one that shows you where you are.
 */

export interface TsplRenderOptions {
  readonly dpi?: Dpi;
  readonly fonts: TsplFontSet;
  /** Used when the source never declares a size. */
  readonly defaultLabelMm?: { readonly width: number; readonly height: number };
  /** Refuses to allocate a label larger than this, in dots, on either axis. */
  readonly maxDots?: number;
}

export interface TsplLabel {
  readonly bitmap: Bitmap1;
  readonly widthMm: number;
  readonly heightMm: number;
  /** Copies the source asked for, from PRINT. */
  readonly copies: number;
}

/**
 * The area on the label a single command drew into.
 *
 * The document model cannot say how wide a line of text or a barcode will be —
 * that depends on the substituted value and on the substitute face — so the
 * only honest source for an element's outline is the renderer that just drew
 * it. An editor needs these to put a selection box around something.
 */
export interface CommandBounds {
  /** Line in the source, so a caller can match this to what it emitted. */
  readonly line: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TsplRenderResult {
  /** One entry per PRINT, or a single image if the source never prints. */
  readonly labels: readonly TsplLabel[];
  readonly diagnostics: readonly Diagnostic[];
  readonly commands: readonly TsplCommand[];
  readonly bounds: readonly CommandBounds[];
}

const DEFAULT_LABEL_MM = { width: 60, height: 40 };
const DEFAULT_MAX_DOTS = 20000;
/** Font the printer uses for a barcode's human-readable line. */
const HRI_FONT = '1';

interface CommandContext {
  readonly command: TsplCommand;
  readonly args: readonly TsplArgument[];
}

class Interpreter {
  readonly diagnostics: Diagnostic[] = [];
  readonly labels: TsplLabel[] = [];
  readonly bounds: CommandBounds[] = [];
  private current: TsplCommand | undefined;

  private readonly dpi: Dpi;
  private readonly fonts: TsplFontSet;
  private readonly maxDots: number;

  private widthDots: number;
  private heightDots: number;
  private bitmap: Bitmap1;
  private referenceX = 0;
  private referenceY = 0;
  private direction: 0 | 1 = 0;
  private mirrored = false;
  private printed = false;
  /**
   * The command whose missing arguments have already been reported.
   *
   * A half-written line is missing every argument after the first, and saying
   * so four times buries the one message that matters.
   */
  private missingReported: TsplCommand | undefined;

  constructor(options: TsplRenderOptions) {
    this.dpi = options.dpi ?? 203;
    this.fonts = options.fonts;
    this.maxDots = options.maxDots ?? DEFAULT_MAX_DOTS;
    const label = options.defaultLabelMm ?? DEFAULT_LABEL_MM;
    this.widthDots = Math.round(mmToDots(label.width, this.dpi));
    this.heightDots = Math.round(mmToDots(label.height, this.dpi));
    this.bitmap = new Bitmap1(this.widthDots, this.heightDots);
  }

  report(
    severity: Diagnostic['severity'],
    message: string,
    at: TsplCommand | TsplArgument,
    code?: string,
    values?: Diagnostic['values'],
  ): void {
    const span = at.span;
    this.diagnostics.push({
      severity,
      message,
      ...(code === undefined ? {} : { code }),
      ...(values === undefined ? {} : { values }),
      line: span.line,
      column: span.column,
      length: span.end - span.start,
    });
  }

  // --- argument access -----------------------------------------------------

  /** Reports a missing argument once per command, then stays quiet. */
  private reportMissing(context: CommandContext, label: string): undefined {
    if (this.missingReported !== context.command) {
      this.missingReported = context.command;
      this.report(
        'error',
        `${context.command.name} is missing ${label}`,
        context.command,
        'tspl.missing-argument',
        { command: context.command.name, argument: label },
      );
    }
    return undefined;
  }

  private numberArg(
    context: CommandContext,
    index: number,
    label: string,
  ): number | undefined {
    const argument = context.args[index];
    if (argument === undefined) return this.reportMissing(context, label);
    if (argument.kind !== 'number') {
      this.report(
        'error',
        `${label} must be a number, found "${argument.value}"`,
        argument,
        'tspl.not-a-number',
        { argument: label, found: String(argument.value) },
      );
      return undefined;
    }
    return argument.value;
  }

  private stringArg(
    context: CommandContext,
    index: number,
    label: string,
  ): string | undefined {
    const argument = context.args[index];
    if (argument === undefined) return this.reportMissing(context, label);
    if (argument.kind === 'string') return argument.value;
    if (argument.kind === 'number') return argument.raw;
    return argument.value;
  }

  /** A measure in dots, honouring a unit suffix and the command's default. */
  private measureArg(
    context: CommandContext,
    index: number,
    label: string,
    defaultUnit: 'dot' | 'mm' | 'inch',
  ): number | undefined {
    const argument = context.args[index];
    if (argument === undefined) return this.reportMissing(context, label);
    if (argument.kind !== 'number') {
      this.report(
        'error',
        `${label} must be a measurement, found "${argument.value}"`,
        argument,
        'tspl.not-a-measurement',
        { argument: label, found: String(argument.value) },
      );
      return undefined;
    }
    const unit = argument.unit ?? defaultUnit;
    if (unit === 'dot') return argument.value;
    if (unit === 'mm') return mmToDots(argument.value, this.dpi);
    return argument.value * this.dpi;
  }

  private rotationArg(context: CommandContext, index: number): Rotation {
    const argument = context.args[index];
    if (argument === undefined || argument.kind !== 'number') return 0;
    const value = ((argument.value % 360) + 360) % 360;
    if (value === 0 || value === 90 || value === 180 || value === 270) return value;
    this.report(
      'warning',
      `Rotation must be 0, 90, 180 or 270; ${argument.value} is treated as 0`,
      argument,
      'tspl.bad-rotation',
      { found: String(argument.value) },
    );
    return 0;
  }

  // --- geometry ------------------------------------------------------------

  private x(value: number): number {
    return Math.round(value + this.referenceX);
  }

  private y(value: number): number {
    return Math.round(value + this.referenceY);
  }

  private resize(widthDots: number, heightDots: number, at: TsplCommand): void {
    const width = Math.round(widthDots);
    const height = Math.round(heightDots);
    if (width < 1 || height < 1) {
      this.report('error', 'Label size must be positive', at);
      return;
    }
    if (width > this.maxDots || height > this.maxDots) {
      this.report(
        'error',
        `Label size ${width} by ${height} dots exceeds the ${this.maxDots} dot limit`,
        at,
        'tspl.label-too-large',
        { width, height, limit: this.maxDots },
      );
      return;
    }
    this.widthDots = width;
    this.heightDots = height;
    this.bitmap = new Bitmap1(width, height);
  }

  // --- command dispatch ----------------------------------------------------

  /** Records the area a drawing command covered, for an editor to select on. */
  private touch(x: number, y: number, width: number, height: number): void {
    if (this.current === undefined || width <= 0 || height <= 0) return;
    this.bounds.push({
      line: this.current.span.line,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  execute(command: TsplCommand): void {
    this.current = command;
    const context: CommandContext = { command, args: command.arguments };
    switch (command.name) {
      case 'SIZE':
        return this.doSize(context);
      case 'CLS':
        return void this.bitmap.clear();
      case 'DIRECTION':
        return this.doDirection(context);
      case 'REFERENCE':
        return this.doReference(context);
      case 'TEXT':
        return this.doText(context);
      case 'BLOCK':
        return this.doBlock(context);
      case 'BAR':
        return this.doBar(context);
      case 'BOX':
        return this.doBox(context);
      case 'ERASE':
        return this.doErase(context);
      case 'REVERSE':
        return this.doReverse(context);
      case 'BARCODE':
        return this.doBarcode(context);
      case 'QRCODE':
        return this.doQrCode(context);
      case 'DMATRIX':
        return this.doDataMatrix(context);
      case 'PDF417':
        return this.doPdf417(context);
      case 'PRINT':
        return this.doPrint(context);

      // Recognised, but with no effect on what the label looks like.
      case 'GAP':
      case 'BLINE':
      case 'OFFSET':
      case 'SHIFT':
      case 'SPEED':
      case 'DENSITY':
      case 'SET':
      case 'CODEPAGE':
      case 'COUNTRY':
      case 'HOME':
      case 'FEED':
      case 'BACKFEED':
      case 'FORMFEED':
      case 'SELFTEST':
      case 'EOJ':
      case 'SOUND':
      case 'LIMITFEED':
      case 'INITIALPRINTER':
      case 'CUT':
      case 'PEEL':
      case 'PARTIAL_CUTTER':
      // OUT sends a value back to the host — every TSC template carries one —
      // and puts nothing on the label.
      case 'OUT':
        return;

      case 'BITMAP':
      case 'PUTBMP':
      case 'PUTPCX':
      case 'DOWNLOAD':
        this.report(
          'warning',
          `${command.name} places an image, which this version does not render. ` +
            'The rest of the label is unaffected.',
          command,
          'tspl.image-not-drawn',
          { command: command.name },
        );
        return;

      default:
        this.report('warning', `Unknown command "${command.name}"`, command, 'tspl.unknown-command', {
          command: command.name,
        });
    }
  }

  private doSize(context: CommandContext): void {
    // A bare number in SIZE means inches, which surprises everyone once.
    const width = this.measureArg(context, 0, 'label width', 'inch');
    const height = this.measureArg(context, 1, 'label height', 'inch');
    if (width === undefined || height === undefined) return;
    this.resize(width, height, context.command);
  }

  private doDirection(context: CommandContext): void {
    const direction = this.numberArg(context, 0, 'direction');
    if (direction === 0 || direction === 1) this.direction = direction;
    else if (direction !== undefined) {
      this.report('warning', 'DIRECTION takes 0 or 1', context.args[0]!);
    }
    const mirror = context.args[1];
    if (mirror?.kind === 'number') this.mirrored = mirror.value === 1;
  }

  private doReference(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'reference x');
    const y = this.numberArg(context, 1, 'reference y');
    if (x !== undefined) this.referenceX = x;
    if (y !== undefined) this.referenceY = y;
  }

  private doBar(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'width');
    const height = this.numberArg(context, 3, 'height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) return;
    this.bitmap.fillRect(this.x(x), this.y(y), Math.round(width), Math.round(height));
    this.touch(this.x(x), this.y(y), width, height);
  }

  private doBox(context: CommandContext): void {
    const left = this.numberArg(context, 0, 'x start');
    const top = this.numberArg(context, 1, 'y start');
    const right = this.numberArg(context, 2, 'x end');
    const bottom = this.numberArg(context, 3, 'y end');
    const thickness = this.numberArg(context, 4, 'line thickness');
    if (
      left === undefined ||
      top === undefined ||
      right === undefined ||
      bottom === undefined ||
      thickness === undefined
    ) {
      return;
    }
    const radiusArgument = context.args[5];
    const radius = radiusArgument?.kind === 'number' ? radiusArgument.value : 0;

    // BOX takes opposite corners, not a size, and the corners may arrive in
    // either order.
    const x = this.x(Math.min(left, right));
    const y = this.y(Math.min(top, bottom));
    const width = Math.abs(right - left) + 1;
    const height = Math.abs(bottom - top) + 1;
    const stroke = { thickness: Math.max(1, Math.round(thickness)) };

    if (radius > 0) {
      roundedBox(this.bitmap, x, y, width, height, radius, stroke.thickness);
    } else {
      strokeBox(this.bitmap, x, y, width, height, stroke.thickness);
    }
    this.touch(x, y, width, height);
  }

  private doErase(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'width');
    const height = this.numberArg(context, 3, 'height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) return;
    for (let row = 0; row < Math.round(height); row++) {
      for (let column = 0; column < Math.round(width); column++) {
        this.bitmap.set(this.x(x) + column, this.y(y) + row, 0);
      }
    }
    this.touch(this.x(x), this.y(y), width, height);
  }

  private doReverse(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'width');
    const height = this.numberArg(context, 3, 'height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) return;
    this.bitmap.invertRect(this.x(x), this.y(y), Math.round(width), Math.round(height));
    this.touch(this.x(x), this.y(y), width, height);
  }

  private doText(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const fontName = this.stringArg(context, 2, 'font name');
    if (x === undefined || y === undefined || fontName === undefined) return;
    const rotation = this.rotationArg(context, 3);
    const xMultiplier = this.numberArg(context, 4, 'x multiplication') ?? 1;
    const yMultiplier = this.numberArg(context, 5, 'y multiplication') ?? 1;

    // The alignment argument is optional, so the content is simply the last one.
    const contentIndex = context.args.length - 1;
    if (contentIndex < 6) {
      this.report('error', 'TEXT is missing its content', context.command);
      return;
    }
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;
    const alignment = contentIndex > 6 ? (this.numberArg(context, 6, 'alignment') ?? 1) : 1;

    const resolved = resolveFont(this.fonts, fontName, xMultiplier, yMultiplier);
    if (resolved.warning) {
      this.report('warning', resolved.warning, context.args[2]!, 'tspl.font-substituted', {
        font: fontName,
      });
    }

    const width = measureText(content, resolved.style).width;
    const offset = alignment === 2 ? -width / 2 : alignment === 3 ? -width : 0;
    drawText(this.bitmap, content, this.x(x) + offset, this.y(y), resolved.style, {
      rotation,
      anchor: 'top-left',
    });
    const turned = rotation === 90 || rotation === 270;
    this.touch(
      this.x(x) + offset,
      this.y(y),
      turned ? resolved.lineHeight : width,
      turned ? width : resolved.lineHeight,
    );
  }

  private doBlock(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'block width');
    const height = this.numberArg(context, 3, 'block height');
    const fontName = this.stringArg(context, 4, 'font name');
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      fontName === undefined
    ) {
      return;
    }
    const rotation = this.rotationArg(context, 5);
    const xMultiplier = this.numberArg(context, 6, 'x multiplication') ?? 1;
    const yMultiplier = this.numberArg(context, 7, 'y multiplication') ?? 1;

    const contentIndex = context.args.length - 1;
    if (contentIndex < 8) {
      this.report('error', 'BLOCK is missing its content', context.command);
      return;
    }
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;

    // Optional space, alignment and fit arguments sit between the multipliers
    // and the content.
    const optional = context.args.slice(8, contentIndex);
    const spacing = optional[0]?.kind === 'number' ? optional[0].value : 0;
    const alignment = optional[1]?.kind === 'number' ? optional[1].value : 1;

    const resolved = resolveFont(this.fonts, fontName, xMultiplier, yMultiplier);
    if (resolved.warning) {
      this.report('warning', resolved.warning, context.args[4]!, 'tspl.font-substituted', {
        font: fontName,
      });
    }

    const lines = wrapText(content, width, (text) => measureText(text, resolved.style).width);
    const lineHeight = resolved.lineHeight + spacing;
    let lineY = this.y(y);

    for (const line of lines) {
      if (lineY + resolved.lineHeight > this.y(y) + height) {
        this.report(
          'warning',
          'BLOCK content is taller than the block; the overflow is not printed',
          context.command,
          'tspl.block-overflow',
        );
        break;
      }
      const lineWidth = measureText(line, resolved.style).width;
      const offset =
        alignment === 2 ? (width - lineWidth) / 2 : alignment === 3 ? width - lineWidth : 0;
      drawText(this.bitmap, line, this.x(x) + offset, lineY, resolved.style, {
        rotation,
        anchor: 'top-left',
      });
      lineY += lineHeight;
    }
    this.touch(this.x(x), this.y(y), width, height);
  }

  private doBarcode(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const type = this.stringArg(context, 2, 'barcode type');
    const height = this.numberArg(context, 3, 'bar height');
    if (x === undefined || y === undefined || type === undefined || height === undefined) return;

    const humanReadable = this.numberArg(context, 4, 'human readable') ?? 0;
    const rotation = this.rotationArg(context, 5);
    const narrow = this.numberArg(context, 6, 'narrow bar width') ?? 2;
    const wide = this.numberArg(context, 7, 'wide bar width') ?? narrow * 2;

    const contentIndex = context.args.length - 1;
    if (contentIndex < 8) {
      this.report('error', 'BARCODE is missing its content', context.command);
      return;
    }
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;
    const alignment = contentIndex > 8 ? (this.numberArg(context, 8, 'alignment') ?? 1) : 1;

    if (!LINEAR_TYPES.has(type.toUpperCase())) {
      // Our own refusal, not the encoder's, so it reads in the user's language.
      this.report(
        'error',
        `Barcode type "${type}" is not supported yet`,
        context.args[2]!,
        'tspl.symbology-unsupported',
        { symbology: type },
      );
      return;
    }

    const ratio = Math.min(3, Math.max(2, Math.round(wide / Math.max(1, narrow))));
    let symbol: LinearSymbol;
    try {
      symbol = encodeLinear(type, content, ratio as 2 | 3);
    } catch (error) {
      this.report(
        'error',
        error instanceof BarcodeError
          ? error.message
          : `Cannot encode a "${type}" barcode from "${content}"`,
        context.args[contentIndex]!,
        'tspl.barcode-failed',
        { symbology: type, data: content },
      );
      return;
    }

    const moduleWidth = Math.max(1, Math.round(narrow));
    const rendered = renderLinear(symbol, {
      moduleWidth,
      height: Math.max(1, Math.round(height)),
      descenderExtension: symbol.descenders ? Math.round(moduleWidth * 5) : 0,
      quietZone: false,
    });

    const hri =
      humanReadable > 0 ? this.renderHumanReadable(symbol.text, rendered.width) : undefined;
    const composed = hri ? stack(rendered, hri, Math.max(2, moduleWidth)) : rendered;
    const turned = rotation === 0 ? composed : composed.rotated(rotation);

    const offset = alignment === 2 ? -turned.width / 2 : alignment === 3 ? -turned.width : 0;
    this.bitmap.blit(turned, this.x(x) + Math.round(offset), this.y(y));
    this.touch(this.x(x) + offset, this.y(y), turned.width, turned.height);
  }

  private renderHumanReadable(text: string, barcodeWidth: number): Bitmap1 {
    const cell = INTERNAL_FONTS[HRI_FONT]!;
    const resolved = resolveFont(this.fonts, HRI_FONT, 1, 1);
    const width = measureText(text, resolved.style).width;
    const strip = new Bitmap1(Math.max(barcodeWidth, Math.ceil(width)), cell.height);
    drawText(strip, text, Math.max(0, (barcodeWidth - width) / 2), 0, resolved.style, {
      anchor: 'top-left',
    });
    return strip;
  }

  private doQrCode(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    if (x === undefined || y === undefined) return;

    const levelArgument = context.args[2];
    const level = readLevel(levelArgument);
    if (levelArgument !== undefined && level === undefined) {
      this.report('warning', 'QR error correction must be L, M, Q or H; using M', levelArgument);
    }
    const cell = this.numberArg(context, 3, 'cell width') ?? 4;
    const rotation = this.rotationArg(context, 5);

    const contentIndex = context.args.length - 1;
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;

    // Model, mask and area arguments may sit between rotation and content.
    for (const argument of context.args.slice(6, contentIndex)) {
      if (argument.kind === 'word' && /^M1$/i.test(argument.value)) {
        this.report(
          'warning',
          'QR model 1 is not supported; the symbol is drawn as model 2',
          argument,
          'tspl.qr-model-1',
        );
      }
    }

    this.placeMatrix(context, () => encodeQr(content, { errorCorrection: level ?? 'M' }), {
      x,
      y,
      moduleWidth: Math.max(1, Math.round(cell)),
      rotation,
    });
  }

  private doDataMatrix(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'maximum width');
    const height = this.numberArg(context, 3, 'maximum height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) return;

    const contentIndex = context.args.length - 1;
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;

    let symbol: MatrixSymbol;
    try {
      // A group separator in the payload is GS1's own: it goes between two
      // application identifiers of variable length, and a symbol carrying one
      // is encoded as GS1 — FNC1 first — so a scanner reports it as ]d2.
      symbol = encodeDataMatrix(content, { gs1: content.includes('\u001d') });
    } catch (error) {
      this.report('error', describe(error, 'Data Matrix', content), context.args[contentIndex]!);
      return;
    }
    // The command gives a box to fit inside, so the module size falls out of it.
    const moduleWidth = Math.max(
      1,
      Math.floor(Math.min(width / symbol.width, height / symbol.height)),
    );
    this.blitMatrix(symbol, x, y, moduleWidth, 0);
  }

  private doPdf417(context: CommandContext): void {
    const x = this.numberArg(context, 0, 'x');
    const y = this.numberArg(context, 1, 'y');
    const width = this.numberArg(context, 2, 'maximum width');
    const height = this.numberArg(context, 3, 'maximum height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) return;
    const rotation = this.rotationArg(context, 4);

    const contentIndex = context.args.length - 1;
    const content = this.stringArg(context, contentIndex, 'content');
    if (content === undefined) return;

    let moduleWidth = 2;
    let rowHeight = 6;
    let columns: number | undefined;
    let level: Pdf417ErrorCorrection | undefined;

    for (const argument of context.args.slice(5, contentIndex)) {
      if (argument.kind !== 'word') continue;
      const match = /^([EWHCR])\s*(\d+)$/i.exec(argument.value);
      if (!match) {
        this.report('warning', `Unrecognised PDF417 option "${argument.value}"`, argument, 'tspl.pdf417-option', {
          option: argument.value,
        });
        continue;
      }
      const value = Number(match[2]);
      switch (match[1]!.toUpperCase()) {
        case 'E':
          level = Math.min(8, Math.max(0, value)) as Pdf417ErrorCorrection;
          break;
        case 'W':
          moduleWidth = Math.max(1, value);
          break;
        case 'H':
          rowHeight = Math.max(1, value);
          break;
        case 'C':
          columns = value;
          break;
        default:
          break;
      }
    }

    let symbol: MatrixSymbol;
    try {
      symbol = encodePdf417(content, {
        ...(level === undefined ? {} : { errorCorrection: level }),
        ...(columns === undefined ? {} : { columns }),
      });
    } catch (error) {
      this.report('error', describe(error, 'PDF417', content), context.args[contentIndex]!);
      return;
    }

    // Shrink to fit the box the command allows, as a printer does.
    const fitWidth = Math.max(1, Math.floor(width / symbol.width));
    const fitHeight = Math.max(1, Math.floor(height / symbol.height));
    this.blitMatrix(
      symbol,
      x,
      y,
      Math.min(moduleWidth, fitWidth),
      rotation,
      Math.min(rowHeight, fitHeight),
    );
  }

  private placeMatrix(
    context: CommandContext,
    encode: () => MatrixSymbol,
    placement: { x: number; y: number; moduleWidth: number; rotation: Rotation },
  ): void {
    let symbol: MatrixSymbol;
    try {
      symbol = encode();
    } catch (error) {
      this.report('error', describe(error, context.command.name, ''), context.command);
      return;
    }
    this.blitMatrix(symbol, placement.x, placement.y, placement.moduleWidth, placement.rotation);
  }

  private blitMatrix(
    symbol: MatrixSymbol,
    x: number,
    y: number,
    moduleWidth: number,
    rotation: Rotation,
    moduleHeight?: number,
  ): void {
    const rendered = renderMatrix(symbol, {
      moduleWidth,
      ...(moduleHeight === undefined ? {} : { moduleHeight }),
      quietZone: false,
      rotation,
    });
    this.bitmap.blit(rendered, this.x(x), this.y(y));
    this.touch(this.x(x), this.y(y), rendered.width, rendered.height);
  }

  private doPrint(context: CommandContext): void {
    const sets = context.args[0]?.kind === 'number' ? context.args[0].value : 1;
    const copies = context.args[1]?.kind === 'number' ? context.args[1].value : 1;
    this.labels.push(this.snapshot(Math.max(1, Math.round(sets * copies))));
    this.printed = true;
  }

  private snapshot(copies: number): TsplLabel {
    let image = this.bitmap.clone();
    // DIRECTION 1 turns the label end for end, and the mirror flag flips it
    // across the feed axis. Both are applied at the end, exactly as the printer
    // applies them to the finished buffer.
    if (this.direction === 1) image = image.rotated(180);
    if (this.mirrored) image = mirror(image);
    return {
      bitmap: image,
      widthMm: dotsToMm(this.widthDots, this.dpi),
      heightMm: dotsToMm(this.heightDots, this.dpi),
      copies,
    };
  }

  finish(): void {
    if (!this.printed) this.labels.push(this.snapshot(1));
  }
}

function describe(error: unknown, what: string, content: string): string {
  if (error instanceof BarcodeError) return error.message;
  return `Cannot encode a ${what} symbol${content ? ` from "${content}"` : ''}`;
}

function readLevel(argument: TsplArgument | undefined): ErrorCorrectionLevel | undefined {
  if (argument === undefined) return undefined;
  const text = argument.kind === 'word' ? argument.value : String(argument.value);
  const upper = text.toUpperCase();
  return upper === 'L' || upper === 'M' || upper === 'Q' || upper === 'H' ? upper : undefined;
}

/** Barcode names this interpreter knows, upper-cased as TSPL writes them. */
const LINEAR_TYPES = new Set([
  '128',
  '128M',
  'CODE128',
  'EAN128',
  'GS1-128',
  '39',
  '39C',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  '25',
  'I2OF5',
  'ITF',
  '25C',
  'I2OF5C',
]);

function encodeLinear(type: string, content: string, ratio: 2 | 3): LinearSymbol {
  switch (type.toUpperCase()) {
    case '128':
    case '128M':
    case 'CODE128':
      return encodeCode128(content);
    case 'EAN128':
    case 'GS1-128':
      return encodeCode128(content, { gs1: true });
    case '39':
      return encodeCode39(content, { wideRatio: ratio });
    case '39C':
      return encodeCode39(content, { wideRatio: ratio, checkDigit: true });
    case 'EAN13':
      return encodeEan13(content);
    case 'EAN8':
      return encodeEan8(content);
    case 'UPCA':
      return encodeUpcA(content);
    case 'UPCE':
      return encodeUpcE(content);
    case '25':
    case 'I2OF5':
    case 'ITF':
      return encodeItf(content, { wideRatio: ratio });
    case '25C':
    case 'I2OF5C':
      return encodeItf(content, { wideRatio: ratio, checkDigit: true });
    default:
      throw new BarcodeError(`Barcode type "${type}" is not supported yet`);
  }
}

/** Places a caption strip under a barcode, centred on the wider of the two. */
function stack(top: Bitmap1, bottom: Bitmap1, gap: number): Bitmap1 {
  const width = Math.max(top.width, bottom.width);
  const combined = new Bitmap1(width, top.height + gap + bottom.height);
  combined.blit(top, Math.round((width - top.width) / 2), 0);
  combined.blit(bottom, Math.round((width - bottom.width) / 2), top.height + gap);
  return combined;
}

function mirror(source: Bitmap1): Bitmap1 {
  const out = new Bitmap1(source.width, source.height);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.get(x, y)) out.set(source.width - 1 - x, y, 1);
    }
  }
  return out;
}

function strokeBox(
  bitmap: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
): void {
  if (thickness * 2 >= width || thickness * 2 >= height) {
    bitmap.fillRect(x, y, width, height);
    return;
  }
  bitmap.fillRect(x, y, width, thickness);
  bitmap.fillRect(x, y + height - thickness, width, thickness);
  bitmap.fillRect(x, y + thickness, thickness, height - thickness * 2);
  bitmap.fillRect(x + width - thickness, y + thickness, thickness, height - thickness * 2);
}

function roundedBox(
  bitmap: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  thickness: number,
): void {
  strokeBox(bitmap, x, y, width, height, thickness);
  // Clip the corners back out, which is what a rounded box amounts to at this
  // scale and keeps the edges dot-exact.
  const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
  for (let dy = 0; dy < r; dy++) {
    for (let dx = 0; dx < r; dx++) {
      const distance = Math.hypot(r - dx - 0.5, r - dy - 0.5);
      if (distance <= r) continue;
      bitmap.set(x + dx, y + dy, 0);
      bitmap.set(x + width - 1 - dx, y + dy, 0);
      bitmap.set(x + dx, y + height - 1 - dy, 0);
      bitmap.set(x + width - 1 - dx, y + height - 1 - dy, 0);
    }
  }
}

/** Greedy word wrap; a word too long for the line is left to overflow. */
function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter((piece) => piece.length > 0)) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (measure(candidate) <= width || current.length === 0) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines;
}

export function renderTspl(source: string, options: TsplRenderOptions): TsplRenderResult {
  const parsed = parseTspl(source);
  const interpreter = new Interpreter(options);
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
