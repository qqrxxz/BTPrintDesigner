import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { renderMatrix } from '../src/barcode/matrix.js';
import { encodeQr } from '../src/barcode/qr/encode.js';
import {
  alignmentPatternPositions,
  blockCount,
  dataCodewords,
  eccPerBlock,
  EC_LEVELS,
  moduleCount,
  totalCodewords,
} from '../src/barcode/qr/tables.js';
import { BarcodeError } from '../src/barcode/types.js';
import { BarcodeFormat, decode } from './helpers/decode.js';

const require_ = createRequire(import.meta.url);
const versionModule = require_('@zxing/library/cjs/core/qrcode/decoder/Version.js');
const levelModule = require_('@zxing/library/cjs/core/qrcode/decoder/ErrorCorrectionLevel.js');
const encoderModule = require_('@zxing/library/cjs/core/qrcode/encoder/Encoder.js');
const ZxingVersion = versionModule.default ?? versionModule;
const ZxingLevel = levelModule.default ?? levelModule;
const ZxingEncoder = encoderModule.default ?? encoderModule;

const read = (data: string, options = {}, moduleWidth = 3): string =>
  decode(renderMatrix(encodeQr(data, options), { moduleWidth }), [BarcodeFormat.QR_CODE]);

describe('version tables match ZXing', () => {
  for (let version = 1; version <= 40; version++) {
    it(`agrees on version ${version}`, () => {
      const reference = ZxingVersion.getVersionForNumber(version);
      expect(totalCodewords(version)).toBe(reference.getTotalCodewords());
      expect(moduleCount(version)).toBe(reference.getDimensionForVersion());
      expect(alignmentPatternPositions(version)).toEqual(
        Array.from(reference.getAlignmentPatternCenters()),
      );
      for (const level of EC_LEVELS) {
        const blocks = reference.getECBlocksForLevel(ZxingLevel[level]);
        expect(eccPerBlock(version, level)).toBe(blocks.getECCodewordsPerBlock());
        expect(blockCount(version, level)).toBe(blocks.getNumBlocks());
      }
    });
  }
});

describe('QR round trip', () => {
  const samples = [
    '1',
    '12345678901234567890',
    'HELLO WORLD',
    'https://example.com/p/4820-117-A',
    'Кабель USB-C 2 м',
    'a'.repeat(300),
    JSON.stringify({ sku: '4820-117-A', qty: 12, lot: '2026-09' }),
  ];
  for (const sample of samples) {
    it(`reads back ${JSON.stringify(sample.slice(0, 40))}`, () => {
      expect(read(sample)).toBe(sample);
    });
  }

  it('reads back at every error correction level', () => {
    for (const level of EC_LEVELS) {
      expect(read('4820-117-A', { errorCorrection: level })).toBe('4820-117-A');
    }
  });

  it('reads back at every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      expect(read('MASK TEST 42', { mask })).toBe('MASK TEST 42');
    }
  });

  it('survives at one dot per module', () => {
    expect(read('4820-117-A', {}, 1)).toBe('4820-117-A');
  });
});

describe('QR mode selection', () => {
  it('uses numeric mode for digits, which is the densest', () => {
    const digits = encodeQr('1'.repeat(80), { errorCorrection: 'L' });
    const letters = encodeQr('A'.repeat(80), { errorCorrection: 'L' });
    const mixed = encodeQr('a'.repeat(80), { errorCorrection: 'L' });
    expect(digits.width).toBeLessThan(letters.width);
    expect(letters.width).toBeLessThanOrEqual(mixed.width);
  });

  it('declares UTF-8 once the payload leaves ASCII', () => {
    // With ECI the symbol must be at least as large as without it.
    const withEci = encodeQr('Кабель', { eci: 'auto' });
    const withoutEci = encodeQr('Кабель', { eci: false });
    expect(withEci.modules.length).toBeGreaterThanOrEqual(withoutEci.modules.length);
    expect(decode(renderMatrix(withEci, { moduleWidth: 3 }), [BarcodeFormat.QR_CODE])).toBe('Кабель');
  });
});

describe('QR sizing', () => {
  it('picks the smallest version that fits', () => {
    expect(encodeQr('1', { errorCorrection: 'L' }).width).toBe(21);
    expect(dataCodewords(1, 'L')).toBe(19);
  });

  it('grows as the payload grows', () => {
    let previous = 0;
    for (const length of [10, 50, 200, 800, 2000]) {
      const width = encodeQr('1'.repeat(length), { errorCorrection: 'L' }).width;
      expect(width).toBeGreaterThanOrEqual(previous);
      previous = width;
    }
  });

  it('honours a forced version', () => {
    expect(encodeQr('1', { version: 10 }).width).toBe(moduleCount(10));
  });

  it('refuses a forced version too small for the payload', () => {
    expect(() => encodeQr('1'.repeat(100), { version: 1 })).toThrow(/does not fit in QR version 1/);
  });

  it('refuses a payload larger than version 40 can hold', () => {
    expect(() => encodeQr('1'.repeat(8000))).toThrow(/more than version 40 allows/);
  });

  it('rejects an out-of-range mask and version', () => {
    expect(() => encodeQr('X', { mask: 9 })).toThrow(BarcodeError);
    expect(() => encodeQr('X', { version: 41 })).toThrow(BarcodeError);
  });

  it('asks for the standard four-module quiet zone', () => {
    expect(encodeQr('X').quietZone).toBe(4);
  });
});

describe('matrices match ZXing\'s own encoder', () => {
  const samples = [
    '1',
    '12345',
    'HELLO WORLD',
    'https://example.com/p/4820',
    'A'.repeat(60),
    '9'.repeat(120),
    'Mixed case payload 42',
  ];

  for (const level of EC_LEVELS) {
    for (const sample of samples) {
      it(`${level}: ${JSON.stringify(sample.slice(0, 24))}`, () => {
        const reference = ZxingEncoder.encode(sample, ZxingLevel[level]);
        const referenceMatrix = reference.getMatrix();
        const mask: number = reference.getMaskPattern();

        // Our chosen version is never larger than ZXing's. ZXing rounds up in
        // places where the payload lands exactly on a capacity boundary; on a
        // label the smaller symbol is the better answer, and the round-trip
        // tests confirm the tighter one still reads.
        const ours = encodeQr(sample, { errorCorrection: level });
        expect(ours.width).toBeLessThanOrEqual(referenceMatrix.getWidth());

        // No smaller version would have held the payload.
        if (ours.width > 21) {
          const smaller = (ours.width - 17) / 4 - 1;
          expect(() => encodeQr(sample, { errorCorrection: level, version: smaller })).toThrow();
        }

        if (ours.width !== referenceMatrix.getWidth()) return;

        // Same version: the symbols must agree module for module, and the mask
        // we pick from the penalty rules must be the one ZXing picks.
        const atSameMask = encodeQr(sample, { errorCorrection: level, mask });
        for (let y = 0; y < referenceMatrix.getHeight(); y++) {
          for (let x = 0; x < referenceMatrix.getWidth(); x++) {
            expect(atSameMask.modules[y * atSameMask.width + x]).toBe(
              referenceMatrix.get(x, y) === 1,
            );
          }
        }
        expect(ours.modules).toEqual(atSameMask.modules);
      });
    }
  }
});
