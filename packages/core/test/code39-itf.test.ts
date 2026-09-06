import { describe, expect, it } from 'vitest';
import { encodeCode39 } from '../src/barcode/code39.js';
import { encodeItf, encodeItf14, itfCheckDigit } from '../src/barcode/itf.js';
import { renderLinear } from '../src/barcode/render.js';
import { BarcodeError } from '../src/barcode/types.js';
import { BarcodeFormat, decode } from './helpers/decode.js';

describe('Code 39 round trip', () => {
  const read = (data: string, options = {}): string =>
    decode(renderLinear(encodeCode39(data, options), { moduleWidth: 2, height: 60 }), [
      BarcodeFormat.CODE_39,
    ]);

  for (const sample of ['A', '1234', 'ABC-123', 'SKU 4820', 'A.B$C/D+E%F', 'ZYXWVU9876']) {
    it(`reads back ${JSON.stringify(sample)}`, () => {
      expect(read(sample)).toBe(sample);
    });
  }

  it('upper-cases input, because the symbology has no lower case', () => {
    expect(read('abc')).toBe('ABC');
    expect(encodeCode39('abc').text).toBe('ABC');
  });

  it('reads back with a check character appended', () => {
    expect(read('ABC-123', { checkDigit: true })).toBe(encodeCode39('ABC-123', { checkDigit: true }).text);
  });

  it('works at both allowed wide ratios', () => {
    expect(read('WIDE2', { wideRatio: 2 })).toBe('WIDE2');
    expect(read('WIDE3', { wideRatio: 3 })).toBe('WIDE3');
  });

  it('is narrower at ratio 2 than at ratio 3', () => {
    expect(encodeCode39('123456', { wideRatio: 2 }).modules.length).toBeLessThan(
      encodeCode39('123456', { wideRatio: 3 }).modules.length,
    );
  });

  it('refuses the start character inside the data', () => {
    expect(() => encodeCode39('A*B')).toThrow(/start and stop/);
  });

  it('names an unsupported character', () => {
    expect(() => encodeCode39('A#B')).toThrow(/cannot encode "#"/);
  });
});

describe('ITF round trip', () => {
  const read = (data: string, options = {}): string => {
    const symbol = encodeItf(data, options);
    return decode(renderLinear(symbol, { moduleWidth: 3, height: 60 }), [BarcodeFormat.ITF], [
      symbol.text.length,
    ]);
  };

  for (const sample of ['00123456', '9876543210', '12345678901234']) {
    it(`reads back ${sample}`, () => {
      expect(read(sample)).toBe(sample);
    });
  }

  it('encodes a four-digit symbol to the module count the standard implies', () => {
    // ZXing declines to read ITF shorter than six digits at any hint setting —
    // the symbology carries no length, so a short read is too dangerous to
    // report. Check the structure directly instead: four narrow start modules,
    // eighteen per digit pair at the default wide ratio, five for the stop.
    expect(encodeItf('1234').modules.length).toBe(4 + 18 * 2 + 5);
  });

  it('rejects an odd digit count rather than guessing', () => {
    expect(() => encodeItf('12345')).toThrow(/even count/);
  });

  it('pads an odd count when asked, and says so in the text', () => {
    const symbol = encodeItf('12345', { padOdd: true });
    expect(symbol.text).toBe('012345');
  });

  it('rejects non-digits', () => {
    expect(() => encodeItf('12A4')).toThrow(BarcodeError);
  });

  it('computes the modulo 10 check digit', () => {
    // GTIN-14 for a known case: 1234567890123 -> check digit 1.
    expect(itfCheckDigit([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2, 3])).toBe(1);
  });
});

describe('ITF-14', () => {
  it('appends the check digit to thirteen digits', () => {
    const symbol = encodeItf14('1234567890123');
    expect(symbol.text).toBe('12345678901231');
    expect(decode(renderLinear(symbol, { moduleWidth: 3, height: 60 }), [BarcodeFormat.ITF])).toBe(
      '12345678901231',
    );
  });

  it('accepts fourteen digits whose check digit is right', () => {
    expect(encodeItf14('12345678901231').text).toBe('12345678901231');
  });

  it('rejects fourteen digits whose check digit is wrong, and says what it should be', () => {
    expect(() => encodeItf14('12345678901239')).toThrow(/require 1$/);
  });

  it('rejects any other length', () => {
    expect(() => encodeItf14('123456789012')).toThrow(/13 or 14 digits/);
  });
});
