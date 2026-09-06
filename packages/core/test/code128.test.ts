import { describe, expect, it } from 'vitest';
import { encodeCode128, FNC1 } from '../src/barcode/code128.js';
import { renderLinear } from '../src/barcode/render.js';
import { BarcodeError } from '../src/barcode/types.js';
import { BarcodeFormat, decode } from './helpers/decode.js';

function roundTrip(data: string, moduleWidth = 3): string {
  const symbol = encodeCode128(data);
  const bitmap = renderLinear(symbol, { moduleWidth, height: 60 });
  return decode(bitmap, [BarcodeFormat.CODE_128]);
}

describe('Code 128 round trip', () => {
  const samples = [
    'A',
    '1',
    'ABC-123',
    'SKU 4820-117-A',
    '0123456789',
    '12345',
    'Label2026',
    'a1B2c3D4',
    'x'.repeat(40),
    '9'.repeat(40),
    '~!@#$%^&*()_+',
  ];

  for (const sample of samples) {
    it(`reads back ${JSON.stringify(sample)}`, () => {
      expect(roundTrip(sample)).toBe(sample);
    });
  }

  it('reads back a control character through the A subset', () => {
    expect(roundTrip('AB\tCD')).toBe('AB\tCD');
  });

  it('survives at one dot per module', () => {
    expect(roundTrip('4820-117-A', 1)).toBe('4820-117-A');
  });
});

describe('Code 128 subset choice', () => {
  const moduleCount = (data: string): number => encodeCode128(data).modules.length;

  it('halves the width of a long number by using subset C', () => {
    // Twenty digits: ten pairs in C against twenty characters in B.
    expect(moduleCount('12345678901234567890')).toBeLessThan(moduleCount('abcdefghijklmnopqrst'));
  });

  it('does not switch to C for a digit run too short to pay for it', () => {
    expect(moduleCount('AB12CD')).toBe(moduleCount('ABxyCD'));
  });

  it('switches into C mid-string when the run is long enough', () => {
    expect(moduleCount('AB12345678CD')).toBeLessThan(moduleCount('ABxxxxxxxxCD'));
  });

  it('shifts for a single foreign character instead of switching twice', () => {
    // One lowercase letter inside an otherwise upper-case, control-bearing run.
    expect(moduleCount('A\tBcD\t')).toBe(moduleCount('A\tBCD\t') + 11);
  });

  it('handles an odd-length digit run without losing a digit', () => {
    expect(roundTrip('123456789')).toBe('123456789');
  });
});

describe('Code 128 GS1', () => {
  it('accepts a leading FNC1 and reports the data without it', () => {
    const symbol = encodeCode128('0112345678901231', { gs1: true });
    expect(symbol.text).toBe('0112345678901231');
    const decoded = decode(renderLinear(symbol, { moduleWidth: 3, height: 60 }), [
      BarcodeFormat.CODE_128,
    ]);
    // ZXing marks the FNC1 group separator with a leading ']C1'-style prefix or
    // strips it; either way the payload digits must survive.
    expect(decoded).toContain('0112345678901231');
  });

  it('takes an explicit FNC1 in the middle of the data', () => {
    const symbol = encodeCode128(`01123456789012${FNC1}10ABC`);
    expect(symbol.modules.length).toBeGreaterThan(0);
  });
});

describe('Code 128 rejections', () => {
  it('refuses empty data', () => {
    expect(() => encodeCode128('')).toThrow(BarcodeError);
  });

  it('names the character it cannot encode', () => {
    expect(() => encodeCode128('Кабель')).toThrow(/covers ASCII only/);
  });

  it('refuses a fractional module width rather than rounding silently', () => {
    const symbol = encodeCode128('123');
    expect(() => renderLinear(symbol, { moduleWidth: 2.5, height: 40 })).toThrow(
      /whole number of dots/,
    );
  });
});
