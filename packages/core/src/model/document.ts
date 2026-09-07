import type { Rotation } from '../bitmap/Bitmap1.js';

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
  readonly elements: readonly LabelElement[];
  /**
   * Values substituted for placeholders when previewing.
   *
   * Preview data belongs in the document because "does the long value still
   * fit" is a question about this design, not about the run that will use it.
   */
  readonly sampleData?: Readonly<Record<string, string>>;
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

export interface RectangleElement extends ElementBase {
  readonly type: 'rectangle';
  readonly width: number;
  readonly height: number;
  readonly fill: 'solid' | 'outline';
  /** Border width in millimetres; ignored when solid. */
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

export type MatrixSymbology = 'qr' | 'datamatrix' | 'pdf417';

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
