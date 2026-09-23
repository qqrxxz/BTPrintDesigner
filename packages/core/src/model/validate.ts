import type { Rotation } from '../bitmap/Bitmap1.js';
import { DATAMOBILE_OPERATIONS, type DataMobileOperation } from '../datamobile/variables.js';
import { ENCODING_CHOICES } from '../printer/encoding.js';
import {
  DOCUMENT_VERSION,
  GS1_SEPARATORS,
  type LabelDocument,
  type LabelElement,
  type LinearSymbology,
  type MatrixSymbology,
  type TextAlignment,
  type TextStyleSpec,
} from './document.js';

/**
 * Validation for documents read from disk.
 *
 * A project file is the one thing whose loss the user cannot undo, so reading
 * one is forgiving: anything recoverable is recovered with a warning, and only
 * what would produce a nonsensical label is dropped. Every issue carries a path
 * so the message can name the element rather than the file.
 */

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly path: string;
  readonly message: string;
}

export interface DocumentParseResult {
  /** Absent only when the value is not a document at all. */
  readonly document?: LabelDocument;
  readonly issues: readonly ValidationIssue[];
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
const LINEAR_SYMBOLOGIES: readonly LinearSymbology[] = [
  'code128',
  'gs1-128',
  'code39',
  'itf',
  'ean13',
  'ean8',
  'upca',
  'upce',
];
const MATRIX_SYMBOLOGIES: readonly MatrixSymbology[] = [
  'qr',
  'datamatrix',
  'gs1-datamatrix',
  'pdf417',
];
const ALIGNMENTS: readonly TextAlignment[] = ['left', 'center', 'right'];
const OPERATIONS: readonly DataMobileOperation[] = DATAMOBILE_OPERATIONS.map((entry) => entry.id);

class Reader {
  readonly issues: ValidationIssue[] = [];

  error(path: string, message: string): undefined {
    this.issues.push({ severity: 'error', path, message });
    return undefined;
  }

  warn(path: string, message: string): void {
    this.issues.push({ severity: 'warning', path, message });
  }

  /** A finite number, or the fallback with a warning. */
  number(value: unknown, path: string, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value !== undefined) {
      this.warn(path, `Expected a number, found ${describe(value)}; using ${fallback}`);
    }
    return fallback;
  }

  positive(value: unknown, path: string, fallback: number): number {
    const number = this.number(value, path, fallback);
    if (number > 0) return number;
    this.warn(path, `Expected a positive number, found ${number}; using ${fallback}`);
    return fallback;
  }

  string(value: unknown, path: string, fallback: string): string {
    if (typeof value === 'string') return value;
    if (value !== undefined) {
      this.warn(path, `Expected text, found ${describe(value)}`);
    }
    return fallback;
  }

  rotation(value: unknown, path: string): Rotation {
    if (value === undefined) return 0;
    if (typeof value === 'number' && (ROTATIONS as readonly number[]).includes(value)) {
      return value as Rotation;
    }
    this.warn(path, `Rotation must be 0, 90, 180 or 270, found ${describe(value)}; using 0`);
    return 0;
  }

  oneOf<T extends string>(
    value: unknown,
    path: string,
    allowed: readonly T[],
    fallback: T,
  ): T {
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
    this.warn(
      path,
      `Expected one of ${allowed.join(', ')}, found ${describe(value)}; using ${fallback}`,
    );
    return fallback;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value) ?? typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTextStyle(reader: Reader, value: unknown, path: string): TextStyleSpec {
  const record = isRecord(value) ? value : {};
  if (!isRecord(value)) reader.warn(path, 'Missing text style; using a 3 mm cell');

  const style: {
    heightMm: number;
    widthScale?: number;
    residentFont?: string;
    residentMultiplier?: { x: number; y: number };
    lineGapMm?: number;
  } = {
    heightMm: reader.positive(record['heightMm'], `${path}.heightMm`, 3),
  };
  if (record['widthScale'] !== undefined) {
    style.widthScale = reader.positive(record['widthScale'], `${path}.widthScale`, 1);
  }
  if (record['residentFont'] !== undefined) {
    style.residentFont = reader.string(record['residentFont'], `${path}.residentFont`, '0');
  }
  if (isRecord(record['residentMultiplier'])) {
    const multiplier = record['residentMultiplier'];
    style.residentMultiplier = {
      x: reader.positive(multiplier['x'], `${path}.residentMultiplier.x`, 1),
      y: reader.positive(multiplier['y'], `${path}.residentMultiplier.y`, 1),
    };
  }
  if (record['lineGapMm'] !== undefined) {
    style.lineGapMm = reader.number(record['lineGapMm'], `${path}.lineGapMm`, 0);
  }
  return style;
}

function readElement(reader: Reader, value: unknown, path: string): LabelElement | undefined {
  if (!isRecord(value)) return reader.error(path, `Expected an element, found ${describe(value)}`);

  const id = reader.string(value['id'], `${path}.id`, '');
  if (id === '') return reader.error(`${path}.id`, 'An element needs an id');

  const base = {
    id,
    ...(typeof value['name'] === 'string' ? { name: value['name'] } : {}),
    x: reader.number(value['x'], `${path}.x`, 0),
    y: reader.number(value['y'], `${path}.y`, 0),
    rotation: reader.rotation(value['rotation'], `${path}.rotation`),
  };

  switch (value['type']) {
    case 'text': {
      const element: LabelElement = {
        ...base,
        type: 'text',
        content: reader.string(value['content'], `${path}.content`, ''),
        style: readTextStyle(reader, value['style'], `${path}.style`),
        ...(value['align'] === undefined
          ? {}
          : { align: reader.oneOf(value['align'], `${path}.align`, ALIGNMENTS, 'left') }),
        ...(isRecord(value['box'])
          ? {
              box: {
                width: reader.positive(value['box']['width'], `${path}.box.width`, 20),
                height: reader.positive(value['box']['height'], `${path}.box.height`, 10),
              },
            }
          : {}),
        ...(value['anchor'] === 'baseline' ? { anchor: 'baseline' as const } : {}),
        ...(value['alignSpan'] === 'to-edge' ? { alignSpan: 'to-edge' as const } : {}),
      };
      return element;
    }
    case 'rectangle':
      return {
        ...base,
        type: 'rectangle',
        width: reader.positive(value['width'], `${path}.width`, 10),
        height: reader.positive(value['height'], `${path}.height`, 10),
        fill: reader.oneOf(
          value['fill'],
          `${path}.fill`,
          ['solid', 'outline', 'invert', 'erase'] as const,
          'outline',
        ),
        ...(value['lineWidth'] === undefined
          ? {}
          : { lineWidth: reader.positive(value['lineWidth'], `${path}.lineWidth`, 0.3) }),
        ...(value['cornerRadius'] === undefined
          ? {}
          : { cornerRadius: reader.number(value['cornerRadius'], `${path}.cornerRadius`, 0) }),
      };
    case 'line':
      return {
        ...base,
        type: 'line',
        x2: reader.number(value['x2'], `${path}.x2`, 0),
        y2: reader.number(value['y2'], `${path}.y2`, 0),
        thickness: reader.positive(value['thickness'], `${path}.thickness`, 0.3),
      };
    case 'barcode':
      return {
        ...base,
        type: 'barcode',
        symbology: reader.oneOf(
          value['symbology'],
          `${path}.symbology`,
          LINEAR_SYMBOLOGIES,
          'code128',
        ),
        data: reader.string(value['data'], `${path}.data`, ''),
        moduleWidth: reader.positive(value['moduleWidth'], `${path}.moduleWidth`, 0.25),
        height: reader.positive(value['height'], `${path}.height`, 10),
        ...(value['humanReadable'] === undefined
          ? {}
          : { humanReadable: value['humanReadable'] === true }),
        ...(value['wideRatio'] === undefined
          ? {}
          : { wideRatio: value['wideRatio'] === 2 ? (2 as const) : (3 as const) }),
        ...(value['gs1Separator'] === undefined
          ? {}
          : {
              gs1Separator: reader.oneOf(
                value['gs1Separator'],
                `${path}.gs1Separator`,
                GS1_SEPARATORS,
                'none',
              ),
            }),
        ...(value['checkDigit'] === undefined ? {} : { checkDigit: value['checkDigit'] === true }),
      };
    case 'matrix':
      return {
        ...base,
        type: 'matrix',
        symbology: reader.oneOf(
          value['symbology'],
          `${path}.symbology`,
          MATRIX_SYMBOLOGIES,
          'qr',
        ),
        data: reader.string(value['data'], `${path}.data`, ''),
        moduleWidth: reader.positive(value['moduleWidth'], `${path}.moduleWidth`, 0.4),
        ...(value['errorCorrection'] === undefined
          ? {}
          : {
              errorCorrection: reader.oneOf(
                value['errorCorrection'],
                `${path}.errorCorrection`,
                ['L', 'M', 'Q', 'H'] as const,
                'M',
              ),
            }),
        ...(value['columns'] === undefined
          ? {}
          : { columns: reader.positive(value['columns'], `${path}.columns`, 3) }),
        ...(value['pdf417ErrorCorrection'] === undefined
          ? {}
          : {
              pdf417ErrorCorrection: reader.number(
                value['pdf417ErrorCorrection'],
                `${path}.pdf417ErrorCorrection`,
                2,
              ),
            }),
        ...(value['gs1Separator'] === undefined
          ? {}
          : {
              gs1Separator: reader.oneOf(
                value['gs1Separator'],
                `${path}.gs1Separator`,
                GS1_SEPARATORS,
                'none',
              ),
            }),
      };
    default:
      return reader.error(
        `${path}.type`,
        `Unknown element type ${describe(value['type'])}; the element is dropped`,
      );
  }
}

export function parseDocument(value: unknown): DocumentParseResult {
  const reader = new Reader();
  if (!isRecord(value)) {
    reader.error('', `Expected a label document, found ${describe(value)}`);
    return { issues: reader.issues };
  }

  const version = value['version'];
  if (version !== DOCUMENT_VERSION) {
    if (typeof version === 'number' && version > DOCUMENT_VERSION) {
      reader.error(
        'version',
        `This file was written by a newer version (format ${version}); ` +
          `this build understands format ${DOCUMENT_VERSION}`,
      );
      return { issues: reader.issues };
    }
    reader.warn('version', `Expected format ${DOCUMENT_VERSION}, found ${describe(version)}`);
  }

  const elements: LabelElement[] = [];
  const rawElements = value['elements'];
  if (Array.isArray(rawElements)) {
    const seen = new Set<string>();
    rawElements.forEach((raw, index) => {
      const element = readElement(reader, raw, `elements[${index}]`);
      if (!element) return;
      if (seen.has(element.id)) {
        reader.warn(`elements[${index}].id`, `Duplicate id "${element.id}"; the element is kept`);
      }
      seen.add(element.id);
      elements.push(element);
    });
  } else if (rawElements !== undefined) {
    reader.warn('elements', 'Expected a list of elements');
  }

  const sampleData: Record<string, string> = {};
  if (isRecord(value['sampleData'])) {
    for (const [key, entry] of Object.entries(value['sampleData'])) {
      if (typeof entry === 'string') sampleData[key] = entry;
      else reader.warn(`sampleData.${key}`, 'Sample values must be text');
    }
  }

  const variableSamples: Record<string, string> = {};
  if (isRecord(value['variableSamples'])) {
    for (const [key, entry] of Object.entries(value['variableSamples'])) {
      if (typeof entry === 'string') variableSamples[key] = entry;
      else reader.warn(`variableSamples.${key}`, 'Sample values must be text');
    }
  }

  const preamble: string[] = [];
  if (Array.isArray(value['preamble'])) {
    value['preamble'].forEach((line, index) => {
      if (typeof line === 'string') preamble.push(line);
      else reader.warn(`preamble[${index}]`, 'Preamble lines must be text');
    });
  } else if (value['preamble'] !== undefined) {
    reader.warn('preamble', 'Expected a list of setup lines');
  }

  const document: LabelDocument = {
    version: DOCUMENT_VERSION,
    name: reader.string(value['name'], 'name', 'Label'),
    width: reader.positive(value['width'], 'width', 60),
    height: reader.positive(value['height'], 'height', 40),
    ...(value['operation'] === undefined
      ? {}
      : { operation: reader.oneOf(value['operation'], 'operation', OPERATIONS, 'all') }),
    ...(isRecord(value['gap'])
      ? {
          gap: {
            height: reader.number(value['gap']['height'], 'gap.height', 2),
            offset: reader.number(value['gap']['offset'], 'gap.offset', 0),
          },
        }
      : {}),
    ...(preamble.length > 0 ? { preamble } : {}),
    elements,
    ...(Object.keys(sampleData).length > 0 ? { sampleData } : {}),
    ...(Object.keys(variableSamples).length > 0 ? { variableSamples } : {}),
    ...(isRecord(value['declaredSize'])
      ? {
          declaredSize: {
            width: value['declaredSize']['width'] !== false,
            height: value['declaredSize']['height'] !== false,
          },
        }
      : {}),
    ...(typeof value['code'] === 'string' && value['code'].trim() !== ''
      ? { code: value['code'] }
      : {}),
    ...(typeof value['quantity'] === 'string' && value['quantity'].trim() !== ''
      ? { quantity: value['quantity'].trim() }
      : {}),
    ...(value['encoding'] === undefined
      ? {}
      : { encoding: reader.oneOf(value['encoding'], 'encoding', ENCODING_CHOICES, 'auto') }),
  };

  return { document, issues: reader.issues };
}

export function serializeDocument(document: LabelDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
