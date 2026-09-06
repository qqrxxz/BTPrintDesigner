import { BarcodeError, requireDigits, type HriGroup, type LinearSymbol } from './types.js';

/**
 * The EAN and UPC family (ISO/IEC 15420).
 *
 * These are fixed-length retail symbols with no room to negotiate: the module
 * count, the quiet zones and the guard pattern are all mandated, and a scanner
 * at a till will reject anything that drifts. The encoders here therefore
 * compute check digits rather than trusting the caller, and verify one that is
 * supplied instead of silently re-deriving it — a mistyped GTIN should be an
 * error message, not a label that scans as a different product.
 */

/** Seven modules per digit. Left-odd set. */
const SET_L: readonly string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

/** Left-even set: the same digits mirrored, which is what encodes the parity. */
const SET_G: readonly string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];

/** Right set: the complement of L, so right-hand digits start with a bar. */
const SET_R: readonly string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];

const NORMAL_GUARD = '101';
const CENTRE_GUARD = '01010';
const UPCE_END_GUARD = '010101';

/**
 * Which of the six left-hand digits use the even set, per leading digit.
 *
 * EAN-13 carries thirteen digits in twelve digits' worth of modules; the
 * thirteenth is encoded entirely in this parity pattern.
 */
const EAN13_PARITY: readonly string[] = [
  'OOOOOO', 'OOEOEE', 'OOEEOE', 'OOEEEO', 'OEOOEE',
  'OEEOOE', 'OEEEOO', 'OEOEOE', 'OEOEEO', 'OEEOEO',
];

/** UPC-E parity by check digit, for number system 0. System 1 inverts it. */
const UPCE_PARITY: readonly string[] = [
  'EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO',
  'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE',
];

function toModules(bits: string): boolean[] {
  return Array.from(bits, (bit) => bit === '1');
}

/**
 * The check digit shared by the whole family: weights alternate 3 and 1 from
 * the right of the data, and the result completes the sum to a multiple of ten.
 */
export function eanCheckDigit(digits: readonly number[]): number {
  let sum = 0;
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i]! * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Normalises input that may or may not already carry its check digit.
 *
 * A supplied check digit is verified, never overwritten. Overwriting would turn
 * a typo into a label that scans cleanly as the wrong product, which is the
 * worst failure this whole program can produce.
 */
function withCheckDigit(data: string, dataLength: number, symbology: string): number[] {
  const digits = requireDigits(data, symbology);
  if (digits.length === dataLength) {
    return [...digits, eanCheckDigit(digits)];
  }
  if (digits.length === dataLength + 1) {
    const expected = eanCheckDigit(digits.slice(0, dataLength));
    if (digits[dataLength] !== expected) {
      throw new BarcodeError(
        `${symbology} check digit is ${digits[dataLength]!}, but the data requires ${expected}`,
      );
    }
    return digits;
  }
  throw new BarcodeError(
    `${symbology} needs ${dataLength} or ${dataLength + 1} digits, got ${digits.length}`,
  );
}

interface Assembly {
  readonly modules: boolean[];
  readonly descenders: boolean[];
}

function assemble(parts: readonly { bits: string; guard: boolean }[]): Assembly {
  const modules: boolean[] = [];
  const descenders: boolean[] = [];
  for (const part of parts) {
    for (const module of toModules(part.bits)) {
      modules.push(module);
      descenders.push(part.guard);
    }
  }
  return { modules, descenders };
}

export function encodeEan13(data: string): LinearSymbol {
  const digits = withCheckDigit(data, 12, 'EAN-13');
  const parity = EAN13_PARITY[digits[0]!]!;

  const parts: { bits: string; guard: boolean }[] = [{ bits: NORMAL_GUARD, guard: true }];
  for (let i = 0; i < 6; i++) {
    const set = parity[i] === 'E' ? SET_G : SET_L;
    parts.push({ bits: set[digits[i + 1]!]!, guard: false });
  }
  parts.push({ bits: CENTRE_GUARD, guard: true });
  for (let i = 0; i < 6; i++) {
    parts.push({ bits: SET_R[digits[i + 7]!]!, guard: false });
  }
  parts.push({ bits: NORMAL_GUARD, guard: true });

  const { modules, descenders } = assemble(parts);
  const text = digits.join('');
  const hri: HriGroup[] = [
    // The leading digit lives in the left quiet zone, outside the bars.
    { text: text.slice(0, 1), startModule: -9, endModule: -1 },
    { text: text.slice(1, 7), startModule: 3, endModule: 45 },
    { text: text.slice(7), startModule: 50, endModule: 92 },
  ];

  return {
    symbology: 'ean13',
    modules,
    descenders,
    quietZone: { left: 11, right: 7 },
    text,
    hri,
  };
}

export function encodeEan8(data: string): LinearSymbol {
  const digits = withCheckDigit(data, 7, 'EAN-8');

  const parts: { bits: string; guard: boolean }[] = [{ bits: NORMAL_GUARD, guard: true }];
  for (let i = 0; i < 4; i++) parts.push({ bits: SET_L[digits[i]!]!, guard: false });
  parts.push({ bits: CENTRE_GUARD, guard: true });
  for (let i = 0; i < 4; i++) parts.push({ bits: SET_R[digits[i + 4]!]!, guard: false });
  parts.push({ bits: NORMAL_GUARD, guard: true });

  const { modules, descenders } = assemble(parts);
  const text = digits.join('');
  return {
    symbology: 'ean8',
    modules,
    descenders,
    quietZone: { left: 7, right: 7 },
    text,
    hri: [
      { text: text.slice(0, 4), startModule: 3, endModule: 31 },
      { text: text.slice(4), startModule: 36, endModule: 64 },
    ],
  };
}

/**
 * UPC-A. Structurally an EAN-13 whose leading digit is zero, which is why the
 * modules come out identical — only the human-readable line differs.
 */
export function encodeUpcA(data: string): LinearSymbol {
  const digits = withCheckDigit(data, 11, 'UPC-A');
  const asEan = encodeEan13(`0${digits.join('')}`);
  const text = digits.join('');
  return {
    ...asEan,
    symbology: 'upca',
    text,
    hri: [
      { text: text.slice(0, 1), startModule: -9, endModule: -1 },
      { text: text.slice(1, 6), startModule: 10, endModule: 45 },
      { text: text.slice(6, 11), startModule: 50, endModule: 85 },
      { text: text.slice(11), startModule: 95, endModule: 103 },
    ],
  };
}

/**
 * Expands a UPC-E payload to the UPC-A it stands for.
 *
 * The compression is a fixed set of zero-suppression rules keyed by the last
 * digit; the check digit is defined over the expansion, not over the six digits
 * printed on the label.
 */
export function upcEToUpcA(numberSystem: number, digits: readonly number[]): number[] {
  const [a, b, c, d, e, f] = digits as [number, number, number, number, number, number];
  if (f <= 2) return [numberSystem, a, b, f, 0, 0, 0, 0, c, d, e];
  if (f === 3) return [numberSystem, a, b, c, 0, 0, 0, 0, 0, d, e];
  if (f === 4) return [numberSystem, a, b, c, d, 0, 0, 0, 0, 0, e];
  return [numberSystem, a, b, c, d, e, 0, 0, 0, 0, f];
}

export interface UpcEOptions {
  /** 0 or 1; UPC-E exists only for these two number systems. */
  readonly numberSystem?: 0 | 1;
}

export function encodeUpcE(data: string, options: UpcEOptions = {}): LinearSymbol {
  const digits = requireDigits(data, 'UPC-E');
  if (digits.length !== 6 && digits.length !== 7) {
    throw new BarcodeError(`UPC-E needs 6 or 7 digits, got ${digits.length}`);
  }

  const numberSystem = options.numberSystem ?? 0;
  if (numberSystem !== 0 && numberSystem !== 1) {
    throw new BarcodeError('UPC-E exists only for number systems 0 and 1');
  }

  const payload = digits.slice(0, 6);
  const expanded = upcEToUpcA(numberSystem, payload);
  const check = eanCheckDigit(expanded);
  if (digits.length === 7 && digits[6] !== check) {
    throw new BarcodeError(`UPC-E check digit is ${digits[6]!}, but the data requires ${check}`);
  }

  const parity = UPCE_PARITY[check]!;
  const parts: { bits: string; guard: boolean }[] = [{ bits: NORMAL_GUARD, guard: true }];
  for (let i = 0; i < 6; i++) {
    // Number system 1 uses the opposite parity throughout.
    const even = (parity[i] === 'E') !== (numberSystem === 1);
    parts.push({ bits: (even ? SET_G : SET_L)[payload[i]!]!, guard: false });
  }
  parts.push({ bits: UPCE_END_GUARD, guard: true });

  const { modules, descenders } = assemble(parts);
  const text = `${numberSystem}${payload.join('')}${check}`;
  return {
    symbology: 'upce',
    modules,
    descenders,
    quietZone: { left: 9, right: 7 },
    text,
    hri: [
      { text: String(numberSystem), startModule: -8, endModule: -1 },
      { text: payload.join(''), startModule: 3, endModule: 45 },
      { text: String(check), startModule: 52, endModule: 60 },
    ],
  };
}
