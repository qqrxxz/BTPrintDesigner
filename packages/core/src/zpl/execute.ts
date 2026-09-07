import { encodeCode128 } from '../barcode/code128.js';
import { encodeCode39 } from '../barcode/code39.js';
import { encodeDataMatrix } from '../barcode/datamatrix/encode.js';
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
import { resolveZplFont, type ZplFontSet } from './fonts.js';
import { letterParameter, numberParameter, parseZpl, type ZplCommand } from './parse.js';

/**
 * ZPL II interpreter.
 *
 * ZPL builds a label a field at a time: a position, then whatever the field
 * contains, then a separator that commits it. The interpreter follows the same
 * shape, holding a pending field until `^FS` closes it, which is also what
 * makes the forgiving behaviour easy — a field that never gets its separator is
 * committed when the next one starts rather than lost.
 *
 * As in the TSPL interpreter nothing throws: an unreadable command becomes a
 * diagnostic and the rest of the label still renders.
 */

export interface ZplRenderOptions {
  readonly dpi?: Dpi;
  readonly fonts: ZplFontSet;
  /** ZPL counts in dots, so a label with no ^PW or ^LL falls back to these. */
  readonly defaultWidthDots?: number;
  readonly defaultHeightDots?: number;
  readonly maxDots?: number;
}

export interface ZplLabel {
  readonly bitmap: Bitmap1;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly copies: number;
}

export interface ZplRenderResult {
  readonly labels: readonly ZplLabel[];
  readonly diagnostics: readonly Diagnostic[];
  readonly commands: readonly ZplCommand[];
  readonly bounds: readonly CommandBounds[];
}

/**
 * How far EAN and UPC guard bars run past the others.
 *
 * Measured against a Zebra rendering, this is a fixed physical length — a
 * shade over a millimetre and a half — and not five modules as the retail
 * standards describe it. A symbol at twice the module width gets the same
 * descender, so the constant scales with the resolution rather than the bars.
 */
const GUARD_DESCENDER_AT_203 = 13;

const DEFAULT_WIDTH_DOTS = 812;
const DEFAULT_HEIGHT_DOTS = 406;
const DEFAULT_MAX_DOTS = 20000;

type Orientation = 'N' | 'R' | 'I' | 'B';

const ROTATIONS: Readonly<Record<Orientation, Rotation>> = { N: 0, R: 90, I: 180, B: 270 };

interface FontState {
  readonly name: string;
  readonly height: number;
  readonly width: number;
}

interface BarcodeState {
  readonly kind:
    | 'code128'
    | 'code39'
    | 'ean13'
    | 'ean8'
    | 'upca'
    | 'upce'
    | 'itf'
    | 'qr'
    | 'datamatrix'
    | 'pdf417';
  readonly orientation: Orientation;
  readonly height: number;
  readonly interpretation: boolean;
  readonly above: boolean;
  readonly checkDigit: boolean;
  /** Module size for the two-dimensional symbologies. */
  readonly moduleSize: number;
  readonly errorCorrection?: string;
  readonly columns?: number;
  readonly rows?: number;
  /** ^BC's mode letter: N stays in subset B, A looks for the shortest encoding. */
  readonly mode?: string;
  readonly command: ZplCommand;
}

type Graphic =
  | { readonly kind: 'box'; readonly width: number; readonly height: number; readonly thickness: number; readonly radius: number; readonly reverse: boolean }
  | { readonly kind: 'circle'; readonly diameter: number; readonly thickness: number; readonly reverse: boolean }
  | { readonly kind: 'ellipse'; readonly width: number; readonly height: number; readonly thickness: number; readonly reverse: boolean }
  | { readonly kind: 'diagonal'; readonly width: number; readonly height: number; readonly thickness: number; readonly leaning: 'left' | 'right'; readonly reverse: boolean };

interface Field {
  x: number;
  y: number;
  anchor: 'top-left' | 'baseline-left';
  justification: number;
  orientation: Orientation | undefined;
  font: FontState | undefined;
  reverse: boolean;
  block: { width: number; lines: number; spacing: number; justify: string } | undefined;
  content: string | undefined;
  barcode: BarcodeState | undefined;
  graphic: Graphic | undefined;
  command: ZplCommand | undefined;
}

function emptyField(): Field {
  return {
    x: 0,
    y: 0,
    anchor: 'top-left',
    justification: 0,
    orientation: undefined,
    font: undefined,
    reverse: false,
    block: undefined,
    content: undefined,
    barcode: undefined,
    graphic: undefined,
    command: undefined,
  };
}

class Interpreter {
  readonly diagnostics: Diagnostic[] = [];
  readonly labels: ZplLabel[] = [];
  readonly bounds: CommandBounds[] = [];

  private readonly dpi: Dpi;
  private readonly fonts: ZplFontSet;
  private readonly maxDots: number;

  private widthDots: number;
  private heightDots: number;
  private bitmap: Bitmap1;

  private homeX = 0;
  private homeY = 0;
  private defaultFont: FontState = { name: 'A', height: 9, width: 5 };
  private defaultOrientation: Orientation = 'N';
  private moduleWidth = 2;
  private wideRatio = 3;
  private barcodeHeight = 10;
  private labelReverse = false;
  private printOrientation: 'N' | 'I' = 'N';
  private copies = 1;
  private printed = false;

  private field = emptyField();

  constructor(options: ZplRenderOptions) {
    this.dpi = options.dpi ?? 203;
    this.fonts = options.fonts;
    this.maxDots = options.maxDots ?? DEFAULT_MAX_DOTS;
    this.widthDots = options.defaultWidthDots ?? DEFAULT_WIDTH_DOTS;
    this.heightDots = options.defaultHeightDots ?? DEFAULT_HEIGHT_DOTS;
    this.bitmap = new Bitmap1(this.widthDots, this.heightDots);
  }

  private report(
    severity: Diagnostic['severity'],
    message: string,
    at: ZplCommand,
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

  private touch(at: ZplCommand | undefined, x: number, y: number, width: number, height: number): void {
    if (at === undefined || width <= 0 || height <= 0) return;
    this.bounds.push({
      line: at.span.line,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  private resize(width: number, height: number, at: ZplCommand): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w > this.maxDots || h > this.maxDots) {
      this.report(
        'error',
        `Label size ${w} by ${h} dots exceeds the ${this.maxDots} dot limit`,
        at,
        'zpl.label-too-large',
        { width: w, height: h, limit: this.maxDots },
      );
      return;
    }
    if (w === this.widthDots && h === this.heightDots) return;
    const previous = this.bitmap;
    this.widthDots = w;
    this.heightDots = h;
    this.bitmap = new Bitmap1(w, h);
    // A size command usually comes before anything is drawn; if it does not,
    // keeping what was already there beats losing it.
    this.bitmap.blit(previous, 0, 0);
  }

  execute(command: ZplCommand): void {
    switch (command.name) {
      case 'XA':
        this.field = emptyField();
        return;
      case 'XZ':
        this.commit();
        this.snapshot();
        return;
      case 'PW':
        return this.resize(numberParameter(command, 0, this.widthDots), this.heightDots, command);
      case 'LL':
        return this.resize(this.widthDots, numberParameter(command, 0, this.heightDots), command);
      case 'LH':
        this.homeX = numberParameter(command, 0, 0);
        this.homeY = numberParameter(command, 1, 0);
        return;
      case 'LR':
        this.labelReverse = letterParameter(command, 0, 'N') === 'Y';
        return;
      case 'PO':
        this.printOrientation = letterParameter(command, 0, 'N') === 'I' ? 'I' : 'N';
        return;
      case 'PQ':
        this.copies = Math.max(1, Math.round(numberParameter(command, 0, 1)));
        return;
      case 'CF':
        this.defaultFont = {
          name: letterParameter(command, 0, this.defaultFont.name),
          height: numberParameter(command, 1, this.defaultFont.height),
          width: numberParameter(command, 2, 0),
        };
        return;
      case 'FW':
        this.defaultOrientation = orientation(letterParameter(command, 0, 'N'));
        return;
      case 'BY':
        this.moduleWidth = Math.max(1, Math.round(numberParameter(command, 0, this.moduleWidth)));
        this.wideRatio = numberParameter(command, 1, this.wideRatio);
        this.barcodeHeight = numberParameter(command, 2, this.barcodeHeight);
        return;

      case 'FO':
      case 'FT':
        // A field that never got its separator is committed here rather than
        // dropped; real files leave one out more often than not.
        this.commit();
        this.field = emptyField();
        this.field.x = numberParameter(command, 0, 0);
        this.field.y = numberParameter(command, 1, 0);
        this.field.justification = numberParameter(command, 2, 0);
        this.field.anchor = command.name === 'FT' ? 'baseline-left' : 'top-left';
        this.field.command = command;
        return;

      case 'A':
        return this.setFont(command);
      case 'FR':
        this.field.reverse = true;
        return;
      case 'FB':
        this.field.block = {
          width: numberParameter(command, 0, 0),
          lines: Math.max(1, Math.round(numberParameter(command, 1, 1))),
          spacing: numberParameter(command, 2, 0),
          justify: letterParameter(command, 3, 'L'),
        };
        return;
      case 'FD':
      case 'FV':
        this.field.content = command.parameters[0] ?? '';
        this.field.command ??= command;
        return;
      case 'FS':
        this.commit();
        this.field = emptyField();
        return;

      case 'GB':
        this.field.graphic = {
          kind: 'box',
          width: numberParameter(command, 0, 0),
          height: numberParameter(command, 1, 0),
          thickness: Math.max(1, Math.round(numberParameter(command, 2, 1))),
          radius: numberParameter(command, 4, 0),
          reverse: letterParameter(command, 3, 'B') === 'W',
        };
        this.field.command ??= command;
        return;
      case 'GC':
        this.field.graphic = {
          kind: 'circle',
          diameter: numberParameter(command, 0, 3),
          thickness: Math.max(1, Math.round(numberParameter(command, 1, 1))),
          reverse: letterParameter(command, 2, 'B') === 'W',
        };
        this.field.command ??= command;
        return;
      case 'GE':
        this.field.graphic = {
          kind: 'ellipse',
          width: numberParameter(command, 0, 1),
          height: numberParameter(command, 1, 1),
          thickness: Math.max(1, Math.round(numberParameter(command, 2, 1))),
          reverse: letterParameter(command, 3, 'B') === 'W',
        };
        this.field.command ??= command;
        return;
      case 'GD':
        this.field.graphic = {
          kind: 'diagonal',
          width: numberParameter(command, 0, 1),
          height: numberParameter(command, 1, 1),
          thickness: Math.max(1, Math.round(numberParameter(command, 2, 1))),
          leaning: letterParameter(command, 4, 'R') === 'L' ? 'left' : 'right',
          reverse: letterParameter(command, 3, 'B') === 'W',
        };
        this.field.command ??= command;
        return;

      case 'BC':
      case 'B3':
      case 'BE':
      case 'B8':
      case 'BU':
      case 'B9':
      case 'B2':
      case 'BQ':
      case 'BX':
      case 'B7':
        return this.setBarcode(command);

      case 'GF':
        this.report(
          'warning',
          '^GF places an image, which this version does not render. ' +
            'The rest of the label is unaffected.',
          command,
          'zpl.image-not-drawn',
          { command: command.name },
        );
        this.field = emptyField();
        return;

      // Recognised, and with no effect on what the label looks like.
      case 'CI':
      case 'CT':
      case 'CC':
      case 'CD':
      case 'MD':
      case 'MN':
      case 'MM':
      case 'MT':
      case 'MU':
      case 'PR':
      case 'JM':
      case 'JZ':
      case 'JU':
      case 'SN':
      case 'FX':
      case 'LT':
      case 'LS':
      case 'PM':
      case 'PF':
      case 'XB':
        return;

      default:
        if (command.prefix === '~') return; // Control commands do not draw.
        this.report(
          'warning',
          `Unknown command "^${command.name}"`,
          command,
          'zpl.unknown-command',
          { command: `^${command.name}` },
        );
    }
  }

  private setFont(command: ZplCommand): void {
    // ^A glues the font name and orientation onto the command: ^A0N,30,30.
    const glued = command.parameters[0] ?? '';
    const name = glued.slice(0, 1).toUpperCase() || this.defaultFont.name;
    const facing = glued.slice(1, 2).toUpperCase();
    if (facing.length > 0) this.field.orientation = orientation(facing);
    this.field.font = {
      name,
      height: numberParameter(command, 1, 0),
      width: numberParameter(command, 2, 0),
    };
    this.field.command ??= command;
  }

  private setBarcode(command: ZplCommand): void {
    const facing = orientation(letterParameter(command, 0, this.defaultOrientation));
    const common = {
      orientation: facing,
      moduleSize: this.moduleWidth,
      command,
    };

    switch (command.name) {
      case 'BC':
        this.field.barcode = {
          ...common,
          kind: 'code128',
          height: numberParameter(command, 1, this.barcodeHeight),
          interpretation: letterParameter(command, 2, 'Y') !== 'N',
          above: letterParameter(command, 3, 'N') === 'Y',
          checkDigit: letterParameter(command, 4, 'N') === 'Y',
          mode: letterParameter(command, 5, 'N'),
        };
        return;
      case 'B3':
        this.field.barcode = {
          ...common,
          kind: 'code39',
          checkDigit: letterParameter(command, 1, 'N') === 'Y',
          height: numberParameter(command, 2, this.barcodeHeight),
          interpretation: letterParameter(command, 3, 'Y') !== 'N',
          above: letterParameter(command, 4, 'N') === 'Y',
        };
        return;
      case 'B2':
        this.field.barcode = {
          ...common,
          kind: 'itf',
          height: numberParameter(command, 1, this.barcodeHeight),
          interpretation: letterParameter(command, 2, 'Y') !== 'N',
          above: letterParameter(command, 3, 'N') === 'Y',
          checkDigit: letterParameter(command, 4, 'N') === 'Y',
        };
        return;
      case 'BE':
      case 'B8':
      case 'BU':
      case 'B9': {
        const kinds = { BE: 'ean13', B8: 'ean8', BU: 'upca', B9: 'upce' } as const;
        this.field.barcode = {
          ...common,
          kind: kinds[command.name as keyof typeof kinds],
          height: numberParameter(command, 1, this.barcodeHeight),
          interpretation: letterParameter(command, 2, 'Y') !== 'N',
          above: letterParameter(command, 3, 'N') === 'Y',
          checkDigit: false,
        };
        return;
      }
      case 'BQ':
        this.field.barcode = {
          ...common,
          kind: 'qr',
          height: 0,
          interpretation: false,
          above: false,
          checkDigit: false,
          moduleSize: Math.max(1, Math.round(numberParameter(command, 2, 1))),
          errorCorrection: letterParameter(command, 3, ''),
        };
        return;
      case 'BX':
        this.field.barcode = {
          ...common,
          kind: 'datamatrix',
          height: 0,
          interpretation: false,
          above: false,
          checkDigit: false,
          moduleSize: Math.max(1, Math.round(numberParameter(command, 1, 5))),
          columns: numberParameter(command, 3, 0),
          rows: numberParameter(command, 4, 0),
        };
        return;
      case 'B7':
        this.field.barcode = {
          ...common,
          kind: 'pdf417',
          height: Math.max(1, Math.round(numberParameter(command, 1, 3))),
          interpretation: false,
          above: false,
          checkDigit: false,
          errorCorrection: String(numberParameter(command, 2, 0)),
          columns: numberParameter(command, 3, 0),
          rows: numberParameter(command, 4, 0),
        };
        return;
      default:
        return;
    }
  }

  /** Draws whatever the pending field describes, then forgets it. */
  private commit(): void {
    const field = this.field;
    if (field.graphic) this.drawGraphic(field, field.graphic);
    else if (field.barcode && field.content !== undefined) this.drawBarcode(field, field.barcode);
    else if (field.content !== undefined && field.content.length > 0) this.drawText(field);
    this.field = emptyField();
  }

  private x(field: Field): number {
    return Math.round(field.x + this.homeX);
  }

  private y(field: Field): number {
    return Math.round(field.y + this.homeY);
  }

  private facing(field: Field): Orientation {
    return field.orientation ?? this.defaultOrientation;
  }

  private drawGraphic(field: Field, graphic: Graphic): void {
    const x = this.x(field);
    const y = this.y(field);
    // A white graphic knocks a hole in what is under it, which is how ZPL
    // clears a strip for a reversed field.
    const mode = graphic.reverse ? 'and' : 'or';
    const erase = graphic.reverse;

    const paint = (draw: (target: Bitmap1) => void, width: number, height: number): void => {
      if (!erase) {
        draw(this.bitmap);
      } else {
        const stamp = new Bitmap1(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
        draw(stamp);
        for (let row = 0; row < stamp.height; row++) {
          for (let column = 0; column < stamp.width; column++) {
            if (stamp.get(column, row)) this.bitmap.set(x + column, y + row, 0);
          }
        }
      }
      this.touch(field.command, x, y, width, height);
    };
    void mode;

    switch (graphic.kind) {
      case 'box': {
        const width = Math.max(graphic.thickness, Math.round(graphic.width));
        const height = Math.max(graphic.thickness, Math.round(graphic.height));
        paint(
          (target) => {
            const offsetX = target === this.bitmap ? x : 0;
            const offsetY = target === this.bitmap ? y : 0;
            drawBox(target, offsetX, offsetY, width, height, graphic.thickness, graphic.radius);
          },
          width,
          height,
        );
        return;
      }
      case 'circle': {
        const diameter = Math.max(graphic.thickness * 2, Math.round(graphic.diameter));
        paint(
          (target) => {
            const offsetX = target === this.bitmap ? x : 0;
            const offsetY = target === this.bitmap ? y : 0;
            drawEllipse(target, offsetX, offsetY, diameter, diameter, graphic.thickness);
          },
          diameter,
          diameter,
        );
        return;
      }
      case 'ellipse': {
        const width = Math.max(graphic.thickness * 2, Math.round(graphic.width));
        const height = Math.max(graphic.thickness * 2, Math.round(graphic.height));
        paint(
          (target) => {
            const offsetX = target === this.bitmap ? x : 0;
            const offsetY = target === this.bitmap ? y : 0;
            drawEllipse(target, offsetX, offsetY, width, height, graphic.thickness);
          },
          width,
          height,
        );
        return;
      }
      case 'diagonal': {
        const width = Math.max(1, Math.round(graphic.width));
        const height = Math.max(1, Math.round(graphic.height));
        paint(
          (target) => {
            const offsetX = target === this.bitmap ? x : 0;
            const offsetY = target === this.bitmap ? y : 0;
            drawDiagonal(
              target,
              offsetX,
              offsetY,
              width,
              height,
              graphic.thickness,
              graphic.leaning,
            );
          },
          width,
          height,
        );
        return;
      }
    }
  }

  private drawText(field: Field): void {
    const font = field.font ?? this.defaultFont;
    const resolved = resolveZplFont(this.fonts, font.name, font.height, font.width);
    if (resolved.warning && field.command) {
      this.report('warning', resolved.warning, field.command, 'zpl.font-substituted', {
        font: font.name,
      });
    }

    const content = field.content ?? '';
    const rotation = ROTATIONS[this.facing(field)];
    const lines = field.block
      ? wrapText(content, field.block.width, (text) => measureText(text, resolved.style).width).slice(
          0,
          field.block.lines,
        )
      : [content];
    const lineHeight = resolved.lineHeight + (field.block?.spacing ?? 0);

    const x = this.x(field);
    const y = this.y(field);
    let widest = 0;

    lines.forEach((line, index) => {
      const width = measureText(line, resolved.style).width;
      widest = Math.max(widest, width);
      let offset = 0;
      if (field.block) {
        const justify = field.block.justify;
        if (justify === 'C') offset = (field.block.width - width) / 2;
        else if (justify === 'R') offset = field.block.width - width;
      } else if (field.justification === 1) {
        offset = -width;
      }
      drawText(this.bitmap, line, x + offset, y + index * lineHeight, resolved.style, {
        rotation,
        anchor: field.anchor,
        mode: field.reverse || this.labelReverse ? 'xor' : 'or',
      });
    });

    const height = lineHeight * lines.length;
    const turned = rotation === 90 || rotation === 270;
    this.touch(
      field.command,
      x,
      field.anchor === 'baseline-left' ? y - resolved.lineHeight : y,
      turned ? height : Math.max(widest, field.block?.width ?? 0),
      turned ? Math.max(widest, field.block?.width ?? 0) : height,
    );
  }

  private drawBarcode(field: Field, barcode: BarcodeState): void {
    const raw = field.content ?? '';
    const rotation = ROTATIONS[barcode.orientation];
    const x = this.x(field);
    const y = this.y(field);

    if (barcode.kind === 'qr' || barcode.kind === 'datamatrix' || barcode.kind === 'pdf417') {
      let symbol: MatrixSymbol;
      try {
        symbol = this.encodeMatrix(barcode, raw);
      } catch (error) {
        this.report(
          'error',
          error instanceof BarcodeError ? error.message : 'This symbol cannot be encoded',
          barcode.command,
          'zpl.symbol-failed',
          { symbology: barcode.kind },
        );
        return;
      }
      const rendered = renderMatrix(symbol, {
        moduleWidth: barcode.moduleSize,
        ...(barcode.kind === 'pdf417' ? { moduleHeight: barcode.height } : {}),
        quietZone: false,
        rotation,
      });
      // ^BQ leaves two cells of clearance above the symbol; the field origin is
      // the corner of that clearance, not of the first module.
      const inset = barcode.kind === 'qr' ? barcode.moduleSize * 2 : 0;
      this.bitmap.blit(rendered, x, y + inset);
      this.touch(field.command ?? barcode.command, x, y + inset, rendered.width, rendered.height);
      return;
    }

    let symbol: LinearSymbol;
    try {
      symbol = this.encodeLinear(barcode, raw);
    } catch (error) {
      this.report(
        'error',
        error instanceof BarcodeError ? error.message : 'This barcode cannot be encoded',
        barcode.command,
        'zpl.barcode-failed',
        { symbology: barcode.kind, data: raw },
      );
      return;
    }

    const rendered = renderLinear(symbol, {
      moduleWidth: barcode.moduleSize,
      height: Math.max(1, Math.round(barcode.height)),
      descenderExtension: symbol.descenders
        ? Math.round((GUARD_DESCENDER_AT_203 / 203) * this.dpi)
        : 0,
      quietZone: false,
    });

    let composed = rendered;
    if (barcode.interpretation) {
      const font = field.font ?? this.defaultFont;
      const resolved = resolveZplFont(this.fonts, font.name, font.height, font.width);
      const line = measureText(symbol.text, resolved.style);
      const strip = new Bitmap1(
        Math.max(rendered.width, Math.ceil(line.width)),
        Math.ceil(resolved.lineHeight),
      );
      drawText(strip, symbol.text, Math.max(0, (rendered.width - line.width) / 2), 0, resolved.style, {
        anchor: 'top-left',
      });
      composed = barcode.above ? stack(strip, rendered) : stack(rendered, strip);
    }

    const turned = rotation === 0 ? composed : composed.rotated(rotation);
    this.bitmap.blit(turned, x, y);
    this.touch(field.command ?? barcode.command, x, y, turned.width, turned.height);
  }

  private encodeLinear(barcode: BarcodeState, data: string): LinearSymbol {
    const ratio = this.wideRatio >= 2.5 ? 3 : 2;
    switch (barcode.kind) {
      case 'code128':
        // Only ^BC's automatic mode hunts for the shortest encoding; the
        // default mode stays in subset B however many digits it is given.
        return encodeCode128(data, { subset: barcode.mode === 'A' ? 'auto' : 'B' });
      case 'code39':
        return encodeCode39(data, { wideRatio: ratio, checkDigit: barcode.checkDigit });
      case 'ean13':
        return encodeEan13(data);
      case 'ean8':
        return encodeEan8(data);
      case 'upca':
        return encodeUpcA(data);
      case 'upce':
        return encodeUpcE(data);
      default:
        return encodeItf(data, { wideRatio: ratio, checkDigit: barcode.checkDigit });
    }
  }

  private encodeMatrix(barcode: BarcodeState, data: string): MatrixSymbol {
    if (barcode.kind === 'qr') {
      // ^BQ takes its error correction and input mode from the front of the
      // field data, not from the command: ^FDQA,payload.
      const match = /^([HQML])([AM]),(.*)$/s.exec(data);
      const level = (match?.[1] ??
        (barcode.errorCorrection && 'LMQH'.includes(barcode.errorCorrection)
          ? barcode.errorCorrection
          : 'M')) as ErrorCorrectionLevel;
      return encodeQr(match?.[3] ?? data, { errorCorrection: level });
    }
    // A group separator in the payload is GS1's own separator, so the symbol
    // is encoded as GS1: FNC1 first, which is what a scanner reads as ]d2.
    if (barcode.kind === 'datamatrix') return encodeDataMatrix(data, { gs1: data.includes('\u001d') });
    const level = Number(barcode.errorCorrection ?? 0);
    return encodePdf417(data, {
      ...(barcode.columns && barcode.columns > 0 ? { columns: barcode.columns } : {}),
      ...(Number.isFinite(level) && level > 0
        ? { errorCorrection: Math.min(8, Math.max(0, level)) as 0 }
        : {}),
    });
  }

  private snapshot(): void {
    let image = this.bitmap.clone();
    if (this.printOrientation === 'I') image = image.rotated(180);
    if (this.labelReverse) image.invert();
    this.labels.push({
      bitmap: image,
      widthMm: dotsToMm(this.widthDots, this.dpi),
      heightMm: dotsToMm(this.heightDots, this.dpi),
      copies: this.copies,
    });
    this.printed = true;
    this.bitmap = new Bitmap1(this.widthDots, this.heightDots);
    this.copies = 1;
  }

  finish(): void {
    this.commit();
    if (!this.printed) this.snapshot();
  }
}

function orientation(letter: string): Orientation {
  const value = letter.toUpperCase();
  return value === 'R' || value === 'I' || value === 'B' ? value : 'N';
}

function stack(top: Bitmap1, bottom: Bitmap1): Bitmap1 {
  const width = Math.max(top.width, bottom.width);
  const combined = new Bitmap1(width, top.height + bottom.height);
  combined.blit(top, Math.round((width - top.width) / 2), 0);
  combined.blit(bottom, Math.round((width - bottom.width) / 2), top.height);
  return combined;
}

function drawBox(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  radius: number,
): void {
  if (thickness * 2 >= width || thickness * 2 >= height) {
    target.fillRect(x, y, width, height);
    return;
  }
  if (radius <= 0) {
    target.fillRect(x, y, width, thickness);
    target.fillRect(x, y + height - thickness, width, thickness);
    target.fillRect(x, y + thickness, thickness, height - thickness * 2);
    target.fillRect(x + width - thickness, y + thickness, thickness, height - thickness * 2);
    return;
  }

  // ^GB rounds by eighths of the shorter side: 0 is square, 8 is as round as
  // the box allows. The border then follows that rounded outline, which is why
  // this cannot be a square box with its corners rubbed out — doing that leaves
  // the corners empty instead of curved.
  const corner = (Math.min(width, height) / 2) * (Math.min(8, radius) / 8);
  const innerRadius = Math.max(0, corner - thickness);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const px = column + 0.5;
      const py = row + 0.5;
      if (roundedDistance(px, py, width, height, corner) > 0) continue;
      const inside = roundedDistance(
        px - thickness,
        py - thickness,
        width - thickness * 2,
        height - thickness * 2,
        innerRadius,
      );
      if (inside < 0) continue;
      target.set(x + column, y + row, 1);
    }
  }
}

/**
 * Signed distance from a point to a rounded rectangle: negative inside.
 *
 * Clamping the point into the rectangle shrunk by the radius turns the corner
 * arcs into a single distance test, which is what makes the border above one
 * loop rather than four cases.
 */
function roundedDistance(
  px: number,
  py: number,
  width: number,
  height: number,
  radius: number,
): number {
  const r = Math.min(radius, width / 2, height / 2);
  const nearestX = Math.min(Math.max(px, r), width - r);
  const nearestY = Math.min(Math.max(py, r), height - r);
  const dx = px - nearestX;
  const dy = py - nearestY;
  if (dx === 0 && dy === 0) return -1;
  return Math.hypot(dx, dy) - r;
}

function drawEllipse(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
): void {
  const rx = width / 2;
  const ry = height / 2;
  const cx = x + rx;
  const cy = y + ry;
  const innerX = Math.max(0, rx - thickness);
  const innerY = Math.max(0, ry - thickness);

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const px = x + column + 0.5;
      const py = y + row + 0.5;
      const outer = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      if (outer > 1) continue;
      if (innerX > 0 && innerY > 0) {
        const inner = ((px - cx) / innerX) ** 2 + ((py - cy) / innerY) ** 2;
        if (inner < 1) continue;
      }
      target.set(x + column, y + row, 1);
    }
  }
}

/**
 * A diagonal line, with its thickness measured across the row rather than
 * perpendicular to the stroke.
 *
 * That is what the printer does, and the difference is not small: for a line
 * leaning about thirty degrees, a perpendicular reading makes the stroke twice
 * as wide as it should be. Each row therefore gets a run of exactly `thickness`
 * dots, centred where the corner-to-corner line crosses it.
 */
function drawDiagonal(
  target: Bitmap1,
  x: number,
  y: number,
  width: number,
  height: number,
  thickness: number,
  leaning: 'left' | 'right',
): void {
  for (let row = 0; row < height; row++) {
    const along = (row + 0.5) / height;
    // The corner-to-corner line is the stroke's left edge, not its centre: the
    // thickness hangs off to the right of it, which is where the printer puts
    // it and why the whole line sits half a thickness further right than a
    // centred reading would place it.
    const edge = Math.round(leaning === 'right' ? width * (1 - along) : width * along);
    for (let column = edge; column < edge + thickness; column++) {
      if (column < 0 || column >= width) continue;
      target.set(x + column, y + row, 1);
    }
  }
}

/** Greedy word wrap; a word too long for the line is left to overflow. */
function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((piece) => piece.length > 0)) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate) <= width || current.length === 0) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

export function renderZpl(source: string, options: ZplRenderOptions): ZplRenderResult {
  const parsed = parseZpl(source);
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
