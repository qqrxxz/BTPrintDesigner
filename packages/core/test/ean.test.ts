import { describe, expect, it } from 'vitest';
import {
  eanCheckDigit,
  encodeEan13,
  encodeEan8,
  encodeUpcA,
  encodeUpcE,
  upcEToUpcA,
} from '../src/barcode/ean.js';
import { renderLinear } from '../src/barcode/render.js';
import { BarcodeFormat, decode } from './helpers/decode.js';

const read = (symbol: ReturnType<typeof encodeEan13>, formats: BarcodeFormat[]): string =>
  decode(renderLinear(symbol, { moduleWidth: 3, height: 70, descenderExtension: 8 }), formats);

describe('check digits', () => {
  it('matches known GTINs', () => {
    expect(eanCheckDigit([4, 0, 0, 6, 3, 8, 1, 3, 3, 3, 9, 3])).toBe(1);
    expect(eanCheckDigit([9, 7, 8, 3, 1, 6, 1, 4, 8, 4, 1, 0])).toBe(0);
    expect(eanCheckDigit([7, 3, 5, 1, 3, 5, 0])).toBe(6);
  });
});

describe('EAN-13', () => {
  it('reads back a symbol built from twelve digits', () => {
    const symbol = encodeEan13('400638133393');
    expect(symbol.text).toBe('4006381333931');
    expect(read(symbol, [BarcodeFormat.EAN_13])).toBe('4006381333931');
  });

  it('accepts a full thirteen digits when the check digit agrees', () => {
    expect(encodeEan13('4006381333931').text).toBe('4006381333931');
  });

  it('refuses a wrong check digit instead of correcting it', () => {
    expect(() => encodeEan13('4006381333935')).toThrow(/check digit is 5.*requires 1/);
  });

  it('encodes the leading digit purely as parity, in ninety-five modules', () => {
    const symbol = encodeEan13('400638133393');
    expect(symbol.modules.length).toBe(95);
  });

  it('distinguishes leading digits that differ only in parity', () => {
    // Same twelve trailing digits, different leading digit: the bars for the
    // right-hand half are identical and only the left-hand parity differs.
    const zero = encodeEan13('000638133393');
    const nine = encodeEan13('900638133393');
    expect(zero.modules).not.toEqual(nine.modules);
    // ZXing reports a zero-leading EAN-13 in its UPC-A form, dropping that
    // leading zero, even when only EAN_13 is hinted. Both spellings name the
    // same symbol.
    expect([zero.text, zero.text.slice(1)]).toContain(read(zero, [BarcodeFormat.EAN_13]));
    expect(read(nine, [BarcodeFormat.EAN_13])).toBe(nine.text);
  });

  it('marks the guard bars as descenders and nothing else', () => {
    const symbol = encodeEan13('400638133393');
    const descenderCount = symbol.descenders!.filter(Boolean).length;
    expect(descenderCount).toBe(3 + 5 + 3);
  });

  it('asks for a wider quiet zone on the left than the right', () => {
    expect(encodeEan13('400638133393').quietZone).toEqual({ left: 11, right: 7 });
  });
});

describe('EAN-8', () => {
  it('reads back a symbol built from seven digits', () => {
    const symbol = encodeEan8('7351350');
    expect(symbol.text).toBe('73513506');
    expect(read(symbol, [BarcodeFormat.EAN_8])).toBe('73513506');
  });

  it('is sixty-seven modules wide', () => {
    expect(encodeEan8('7351350').modules.length).toBe(67);
  });

  it('rejects the wrong digit count with the counts named', () => {
    expect(() => encodeEan8('123456')).toThrow(/needs 7 or 8 digits, got 6/);
  });
});

describe('UPC-A', () => {
  it('reads back a symbol built from eleven digits', () => {
    const symbol = encodeUpcA('03600029145');
    expect(symbol.text).toBe('036000291452');
    expect(read(symbol, [BarcodeFormat.UPC_A, BarcodeFormat.EAN_13])).toContain('036000291452');
  });

  it('produces the same modules as the EAN-13 with a leading zero', () => {
    expect(encodeUpcA('03600029145').modules).toEqual(encodeEan13('0036000291452').modules);
  });
});

describe('UPC-E', () => {
  it('expands by the zero-suppression rules', () => {
    expect(upcEToUpcA(0, [1, 2, 3, 0, 0, 0])).toEqual([0, 1, 2, 0, 0, 0, 0, 0, 3, 0, 0]);
    expect(upcEToUpcA(0, [1, 2, 3, 4, 5, 3])).toEqual([0, 1, 2, 3, 0, 0, 0, 0, 0, 4, 5]);
    expect(upcEToUpcA(0, [1, 2, 3, 4, 5, 4])).toEqual([0, 1, 2, 3, 4, 0, 0, 0, 0, 0, 5]);
    expect(upcEToUpcA(0, [1, 2, 3, 4, 5, 7])).toEqual([0, 1, 2, 3, 4, 5, 0, 0, 0, 0, 7]);
  });

  it('derives its check digit from the expanded UPC-A, not from the six digits shown', () => {
    // No round trip here: ZXing's UPC-E reader is marked experimental and its
    // JavaScript port drops the number system and check digit entirely, so it
    // cannot confirm anything. The module tables are cross-checked against
    // ZXing's constants in ean-tables.test.ts instead.
    const expanded = upcEToUpcA(0, [1, 2, 3, 4, 5, 6]);
    expect(encodeUpcE('123456').text).toBe(`0123456${eanCheckDigit(expanded)}`);
  });

  it('is fifty-one modules wide', () => {
    expect(encodeUpcE('123456').modules.length).toBe(51);
  });

  it('rejects a number system other than 0 or 1', () => {
    expect(() => encodeUpcE('123456', { numberSystem: 2 as 0 })).toThrow(/number systems 0 and 1/);
  });

  it('verifies a supplied check digit', () => {
    const correct = encodeUpcE('123456').text;
    const check = correct[correct.length - 1]!;
    expect(() => encodeUpcE(`123456${(Number(check) + 1) % 10}`)).toThrow(/check digit/);
  });
});
