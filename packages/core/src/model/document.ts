import type { Rotation } from '../bitmap/Bitmap1.js';
import type { DataMobileOperation } from '../datamobile/variables.js';

/**
 * The label document model.
 *
 * This is the source of truth a project file holds, and it is deliberately
 * language-neutral: one document exports to TSPL, ZPL or CPCL. Everything
 * measurable is in millimetres so a design survives being retargeted from a
 * 203 dpi printer to a 600 dpi one — dots appear only when a generator emits
 * code for a particular printer.
 *
 * The one thing that is not stored in millimetres is what the standards
 * themselves count in modules or cells; those are noted where they occur.
 */

export const DOCUMENT_VERSION = 1;

export interface LabelDocument {
  readonly version: typeof DOCUMENT_VERSION;
  readonly name: string;
  /** Label size in millimetres. */
  readonly width: number;
  readonly height: number;
  /** Gap between labels on the roll, in millimetres. */
  readonly gap?: { readonly height: number; readonly offset: number };
  /**
   * The DataMobile print template this label is.
   *
   * DataMobile assigns a template to an operation and offers a different set of
   * variables to each; naming the operation is what lets the designer be told
   * that `@Price@` means nothing on a document template. Absent when the label
   * is not a DataMobile template at all.
   */
  readonly operation?: DataMobileOperation;
  /**
   * Printer setup lines reproduced verbatim, between the size and the first
   * element.
   *
   * Speed, density, code page and the like are the printer's business, not the
   * design's, but dropping them on the way through would change how a job
   * behaves. Keeping them as text means a file imported from a real printer
   * survives a round trip without the model having to model them.
   */
  readonly preamble?: readonly string[];
  readonly elements: readonly LabelElement[];
  /**
   * Values substituted for placeholders when previewing.
   *
   * Preview data belongs in the document because "does the long value still
   * fit" is a question about this design, not about the run that will use it.
   */
  readonly sampleData?: Readonly<Record<string, string>>;
  /**
   * Values to show in place of DataMobile variables, by variable name.
   *
   * The catalogue carries a sample for every variable, but a sample of a
   * realistic length is not always the length that matters here: a warehouse
   * whose product names run to forty characters wants to see forty of them.
   * What is set here wins over the catalogue's own sample.
   */
  readonly variableSamples?: Readonly<Record<string, string>>;
}

export interface ElementBase {
  readonly id: string;
  /** A human name, so the canvas and the layer list can say something useful. */
  readonly name?: string;
  /** Top-left corner in millimetres. */
  readonly x: number;
  readonly y: number;
  readonly rotation?: Rotation;
}

/**
 * Text sizing.
 *
 * `heightMm` is the character cell, matching how printer fonts are specified,
 * so a value converts to a resident font cell without a second guess.
 * `residentFont` pins a specific printer font — set when a design is imported
 * from code that named one, left unset when the designer only chose a size.
 */
export interface TextStyleSpec {
  readonly heightMm: number;
  /** Horizontal stretch; 1 is natural. */
  readonly widthScale?: number;
  readonly residentFont?: string;
  readonly residentMultiplier?: { readonly x: number; readonly y: number };
  /** Extra space between lines of a wrapped block, in millimetres. */
  readonly lineGapMm?: number;
}

export type TextAlignment = 'left' | 'center' | 'right';

export interface TextElement extends ElementBase {
  readonly type: 'text';
  /** May contain placeholders written as {{name}}. */
  readonly content: string;
  readonly style: TextStyleSpec;
  readonly align?: TextAlignment;
  /**
   * Turns the element into a wrapped block. Without it the text is one line
   * that runs as far as it runs.
   */
  readonly box?: { readonly width: number; readonly height: number };
}

/**
 * What a rectangle does to the area it covers.
 *
 * `invert` and `erase` are not decoration: inverting a strip is how every
 * printer language draws white text on black, and erasing is how a template
 * clears room for a variable field. Modelling them as fills keeps those idioms
 * inside the document instead of forcing a design that uses them out of the
 * canvas and into raw code.
 */
export type RectangleFill = 'solid' | 'outline' | 'invert' | 'erase';

export interface RectangleElement extends ElementBase {
  readonly type: 'rectangle';
  readonly width: number;
  readonly height: number;
  readonly fill: RectangleFill;
  /** Border width in millimetres; only an outline uses it. */
  readonly lineWidth?: number;
  readonly cornerRadius?: number;
}

export interface LineElement extends ElementBase {
  readonly type: 'line';
  /** End point in millimetres, relative to the label origin like `x` and `y`. */
  readonly x2: number;
  readonly y2: number;
  readonly thickness: number;
}

export type LinearSymbology =
  | 'code128'
  | 'gs1-128'
  | 'code39'
  | 'itf'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce';

export interface BarcodeElement extends ElementBase {
  readonly type: 'barcode';
  readonly symbology: LinearSymbology;
  /** May contain placeholders. */
  readonly data: string;
  /**
   * Narrow module width in millimetres.
   *
   * Stored in millimetres like everything else, but a generator snaps it to a
   * whole number of dots and says what it landed on: a barcode whose modules
   * straddle dot boundaries does not scan.
   */
  readonly moduleWidth: number;
  readonly height: number;
  readonly humanReadable?: boolean;
  /** Wide-to-narrow ratio, for the two-width symbologies. */
  readonly wideRatio?: 2 | 3;
  readonly checkDigit?: boolean;
}

export type MatrixSymbology = 'qr' | 'datamatrix' | 'gs1-datamatrix' | 'pdf417';

/**
 * How the GS1 separator is written inside a symbol's data.
 *
 * Between two application identifiers of variable length, GS1 wants the ASCII
 * group separator, and no keyboard has one. Every printer and every piece of
 * middleware therefore spells it its own way, and which spelling reaches the
 * printer is decided by the setup, not by us — so the element says which one
 * its data uses, and the preview reads that token as the separator it stands
 * for. `none` leaves the data exactly as written.
 */
export type Gs1Separator = 'none' | '~]' | '~d029' | '~1' | '_1';

export const GS1_SEPARATORS: readonly Gs1Separator[] = ['none', '~]', '~d029', '~1', '_1'];

/** The character the tokens above stand for: ASCII 29, the group separator. */
export const GROUP_SEPARATOR = '\u001d';

export interface MatrixElement extends ElementBase {
  readonly type: 'matrix';
  readonly symbology: MatrixSymbology;
  readonly data: string;
  /** Module size in millimetres, snapped to whole dots when generating. */
  readonly moduleWidth: number;
  /** QR only. */
  readonly errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  /** PDF417 only. */
  readonly columns?: number;
  /** PDF417 only, 0 to 8. */
  readonly pdf417ErrorCorrection?: number;
  /**
   * GS1 Data Matrix only: which token in the data stands for the separator.
   *
   * The token stays in the file the printer receives, because that is what the
   * printer understands; the preview reads it as ASCII 29 so the symbol on
   * screen is the symbol that will be printed.
   */
  readonly gs1Separator?: Gs1Separator;
}

export type LabelElement =
  | TextElement
  | RectangleElement
  | LineElement
  | BarcodeElement
  | MatrixElement;

export function createDocument(overrides: Partial<LabelDocument> = {}): LabelDocument {
  return {
    version: DOCUMENT_VERSION,
    name: 'Label',
    width: 60,
    height: 40,
    elements: [],
    ...overrides,
  };
}

/** Bounding box in millimetres, as far as the model can know it. */
export function elementBounds(
  element: LabelElement,
): { x: number; y: number; width: number; height: number } | undefined {
  switch (element.type) {
    case 'rectangle':
      return { x: element.x, y: element.y, width: element.width, height: element.height };
    case 'line':
      return {
        x: Math.min(element.x, element.x2),
        y: Math.min(element.y, element.y2),
        width: Math.abs(element.x2 - element.x) + element.thickness,
        height: Math.abs(element.y2 - element.y) + element.thickness,
      };
    case 'text':
      if (element.box) {
        return { x: element.x, y: element.y, width: element.box.width, height: element.box.height };
      }
      // A single line's width depends on the substituted value and the
      // substitute face, so only the renderer can answer it.
      return undefined;
    case 'barcode':
      return undefined;
    case 'matrix':
      return undefined;
  }
}
