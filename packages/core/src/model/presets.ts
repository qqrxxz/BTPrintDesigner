/**
 * The catalogue of things an editor can put on a label.
 *
 * A preset is not just an element type: it is a type with the settings that
 * make it useful straight away. Which variable a new element carries depends on
 * the operation the template is for — a barcode on a product label is the
 * product's barcode virtually every time — and a symbology whose payload has a
 * fixed shape gets a literal sample instead, because DataMobile's own sample
 * for `@Barcode@` is thirteen digits and neither UPC-A nor ITF can hold that.
 *
 * Names live here beside the presets, the way the DataMobile catalogue keeps
 * its own, so an interface in either language has nothing to invent.
 */
import { defaultContent, isAvailable, type DataMobileOperation } from '../datamobile/variables.js';
import type { PrinterLanguage } from '../printer/profiles.js';
import type {
  LabelDocument,
  LabelElement,
  LinearSymbology,
  MatrixSymbology,
  TextStyleSpec,
} from './document.js';

export type PresetGroup = 'text' | 'barcode' | 'matrix' | 'shape';

export const PRESET_GROUPS: readonly { id: PresetGroup; ru: string; en: string }[] = [
  { id: 'text', ru: 'Текст', en: 'Text' },
  { id: 'barcode', ru: 'Штрихкоды', en: 'Barcodes' },
  { id: 'matrix', ru: 'Двумерные коды', en: '2D codes' },
  { id: 'shape', ru: 'Фигуры', en: 'Shapes' },
];

export interface Preset {
  readonly id: string;
  readonly group: PresetGroup;
  /** The prefix new element ids take, so the generated code stays readable. */
  readonly prefix: string;
  readonly ru: string;
  readonly en: string;
  make(
    id: string,
    at: { x: number; y: number },
    document: LabelDocument,
    language: PrinterLanguage,
  ): LabelElement;
}

/**
 * How a new piece of text is sized.
 *
 * TSPL labels are written with the printer's own fonts and a multiplier — that
 * is what every template from DataMobile does, and what a TSC prints without
 * being asked to scale anything. Font 1 is the 8 by 12 cell, which is 1.5 mm
 * tall at 203 dpi, so the height in the panel says the same thing the printer
 * will do. The other two languages have no such default worth pinning, and get
 * a height the generator turns into whatever the language asks for.
 */
function textStyle(language: PrinterLanguage): TextStyleSpec {
  if (language === 'tspl') {
    return { heightMm: 1.5, residentFont: '1', residentMultiplier: { x: 1, y: 1 } };
  }
  return { heightMm: 3 };
}

/** The variable this operation would put in an element of this kind. */
function content(
  kind: 'text' | 'barcode' | 'matrix',
  document: LabelDocument,
  fallback: string,
): string {
  return defaultContent(kind, document.operation) ?? fallback;
}

function barcode(
  symbology: LinearSymbology,
  name: string,
  data: (document: LabelDocument) => string,
): Preset {
  return {
    id: `barcode:${symbology}`,
    group: 'barcode',
    prefix: 'b',
    ru: name,
    en: name,
    make: (id, at, document) => ({
      id,
      type: 'barcode',
      x: at.x,
      y: at.y,
      symbology,
      data: data(document),
      moduleWidth: 0.25,
      height: 12,
      humanReadable: true,
    }),
  };
}

function matrix(symbology: MatrixSymbology, name: string, moduleWidth: number): Preset {
  return {
    id: `matrix:${symbology}`,
    group: 'matrix',
    prefix: 'm',
    ru: name,
    en: name,
    make: (id, at, document) => ({
      id,
      type: 'matrix',
      x: at.x,
      y: at.y,
      symbology,
      data: content('matrix', document, 'https://example.com'),
      moduleWidth,
    }),
  };
}

/** Where each operation keeps its GS1 payload, when it has one. */
const GS1_VARIABLE: Partial<Record<DataMobileOperation, string>> = {
  art: '@BarcodeFull@',
  art_in_doc: '@BarcodeFull@',
  promoart: '@BarcodeFull@',
  km: '@BarcodeFull@',
  copybarcode: '@gs1barcode@',
};

export const PRESETS: readonly Preset[] = [
  {
    id: 'text:line',
    group: 'text',
    prefix: 't',
    ru: 'Строка',
    en: 'Line',
    make: (id, at, document, language) => ({
      id,
      type: 'text',
      x: at.x,
      y: at.y,
      content: content('text', document, 'Text'),
      style: textStyle(language),
    }),
  },
  {
    // TSPL's BLOCK, ZPL's ^FB: text that wraps inside a box instead of running
    // off the edge of the label. Product names are why this exists.
    id: 'text:block',
    group: 'text',
    prefix: 't',
    ru: 'Блок с переносом',
    en: 'Wrapped block',
    make: (id, at, document, language) => ({
      id,
      type: 'text',
      x: at.x,
      y: at.y,
      content: content('text', document, 'Текст'),
      style: textStyle(language),
      box: { width: 40, height: 12 },
    }),
  },

  barcode('code128', 'Code 128', (document) => content('barcode', document, '4820-117-A')),
  // GS1-128 carries application identifiers, so it takes the variable that
  // holds them — never the plain barcode, and never a document's own number.
  barcode('gs1-128', 'GS1-128', (document) =>
    document.operation === undefined || document.operation === 'all'
      ? '0104006381333931'
      : (GS1_VARIABLE[document.operation] ?? '0104006381333931'),
  ),
  barcode('code39', 'Code 39', (document) => content('barcode', document, '4820-117-A')),
  // EAN-13 wants thirteen digits, which is exactly what the plain barcode
  // variable's sample is — a document's own number is not.
  barcode('ean13', 'EAN-13', (document) =>
    document.operation !== undefined && isAvailable('@Barcode@', document.operation)
      ? '@Barcode@'
      : '4006381333931',
  ),
  // The rest fix the number of digits, so a thirteen-digit sample will not do.
  barcode('itf', 'ITF', () => '04006381333931'),
  barcode('ean8', 'EAN-8', () => '20123451'),
  barcode('upca', 'UPC-A', () => '036000291452'),
  barcode('upce', 'UPC-E', () => '0123457'),

  matrix('qr', 'QR', 0.5),
  matrix('datamatrix', 'DataMatrix', 0.5),
  matrix('gs1-datamatrix', 'GS1 DataMatrix', 0.5),
  matrix('pdf417', 'PDF417', 0.25),

  {
    id: 'shape:frame',
    group: 'shape',
    prefix: 'r',
    ru: 'Рамка',
    en: 'Frame',
    make: (id, at) => ({
      id,
      type: 'rectangle',
      x: at.x,
      y: at.y,
      width: 30,
      height: 15,
      fill: 'outline',
      lineWidth: 0.3,
    }),
  },
  {
    id: 'shape:fill',
    group: 'shape',
    prefix: 'r',
    ru: 'Заливка',
    en: 'Filled box',
    make: (id, at) => ({
      id,
      type: 'rectangle',
      x: at.x,
      y: at.y,
      width: 30,
      height: 8,
      fill: 'solid',
    }),
  },
  {
    id: 'shape:rule',
    group: 'shape',
    prefix: 'l',
    ru: 'Линия',
    en: 'Rule',
    make: (id, at) => ({
      id,
      type: 'line',
      x: at.x,
      y: at.y,
      x2: at.x + 30,
      y2: at.y,
      thickness: 0.4,
    }),
  },
];

export function presetsOf(group: PresetGroup): Preset[] {
  return PRESETS.filter((preset) => preset.group === group);
}

export function findPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}
