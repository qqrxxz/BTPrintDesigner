import { describe, expect, it } from 'vitest';
import { encodeCode128, FNC1 } from '../src/barcode/code128.js';
import { renderLinear } from '../src/barcode/render.js';
import { BarcodeFormat, decode } from './helpers/decode.js';
import { generateCpcl } from '../src/generate/cpcl.js';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { renderCpcl } from '../src/cpcl/execute.js';
import { importTspl } from '../src/import/tspl.js';
import { importZpl } from '../src/import/zpl.js';
import { createDocument, GROUP_SEPARATOR, type LabelDocument } from '../src/model/document.js';
import { applyGs1Separator } from '../src/model/gs1.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';
import { renderTspl } from '../src/tspl/execute.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

/** 01 is fixed length, 21 is not, so a separator has to follow the serial. */
const PAYLOAD = '010400638133393121ABCDE~13103000123';

const label = (overrides: Partial<LabelDocument> = {}, data = PAYLOAD): LabelDocument =>
  createDocument({
    width: 60,
    height: 40,
    elements: [
      {
        id: 'm1',
        type: 'matrix',
        x: 4,
        y: 4,
        symbology: 'gs1-datamatrix',
        data,
        moduleWidth: 0.5,
        gs1Separator: '~1',
      },
    ],
    ...overrides,
  });

describe('the separator token', () => {
  it('stands for the group separator, and nothing else changes', () => {
    expect(applyGs1Separator('a~1b', '~1')).toBe(`a${GROUP_SEPARATOR}b`);
    expect(applyGs1Separator('a~]b', '~]')).toBe(`a${GROUP_SEPARATOR}b`);
    expect(applyGs1Separator('a~d029b', '~d029')).toBe(`a${GROUP_SEPARATOR}b`);
    expect(applyGs1Separator('a_1b', '_1')).toBe(`a${GROUP_SEPARATOR}b`);
  });

  it('is left alone when the element does not use one', () => {
    expect(applyGs1Separator('a~1b', 'none')).toBe('a~1b');
    expect(applyGs1Separator('a~1b', undefined)).toBe('a~1b');
  });
});

describe('generating a GS1 Data Matrix', () => {
  it('keeps the token in the file the printer receives', () => {
    // The printer is what understands `~1`; turning it into a raw control
    // character here would send something the setup did not ask for.
    expect(generateTspl(label(), { dpi: 203 }).source).toContain('~1');
    expect(generateTspl(label(), { dpi: 203 }).source).not.toContain(GROUP_SEPARATOR);
    expect(generateZpl(label(), { dpi: 203 }).source).toContain('~1');
  });

  it('writes the separator itself into the preview', () => {
    const { source } = generateTspl(label(), { dpi: 203, resolveVariables: true });
    expect(source).toContain(GROUP_SEPARATOR);
    expect(source).not.toContain('~1');
  });

  it('sizes the box for the separator rather than for the token', () => {
    // Two characters of `~1` where one control character will be could push the
    // payload into a larger symbol than the printer will produce.
    const withToken = generateTspl(label(), { dpi: 203 }).source;
    const withCharacter = generateTspl(
      label({}, PAYLOAD.replace('~1', GROUP_SEPARATOR)),
      { dpi: 203 },
    ).source;
    const box = (source: string) => /DMATRIX \d+,\d+,(\d+),(\d+)/.exec(source)!.slice(1).join('x');
    expect(box(withToken)).toBe(box(withCharacter));
  });

  it('draws, and the drawn symbol is a GS1 symbol', () => {
    const { source } = generateTspl(label(), { dpi: 203, resolveVariables: true });
    const drawn = renderTspl(source, { fonts: fonts(), dpi: 203 });
    expect(drawn.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);

    // Same payload without the separator: the GS1 symbol carries one codeword
    // more, so it is never the smaller of the two.
    const plain = generateTspl(label({}, PAYLOAD.replace('~1', '')), {
      dpi: 203,
      resolveVariables: true,
    }).source;
    const size = (text: string) => Number(/DMATRIX \d+,\d+,(\d+)/.exec(text)![1]);
    expect(size(source)).toBeGreaterThanOrEqual(size(plain));
  });
});

describe('a GS1 Data Matrix through a file and back', () => {
  it('round-trips the symbology and the token', () => {
    const saved = serializeDocument(label());
    const read = parseDocument(JSON.parse(saved)).document!;
    const element = read.elements[0] as { symbology: string; gs1Separator?: string };
    expect(element.symbology).toBe('gs1-datamatrix');
    expect(element.gs1Separator).toBe('~1');
  });

  it('falls back on a token nobody offers', () => {
    const result = parseDocument({
      version: 1,
      width: 60,
      height: 40,
      elements: [
        { id: 'm', type: 'matrix', x: 1, y: 1, symbology: 'gs1-datamatrix', data: 'x', moduleWidth: 0.5, gs1Separator: '<GS>' },
      ],
    });
    expect((result.document!.elements[0] as { gs1Separator?: string }).gs1Separator).toBe('none');
  });

  it('reads code with a separator in it back as a GS1 symbol', () => {
    const { source } = generateTspl(label(), { dpi: 203, resolveVariables: true });
    const imported = importTspl(source, { dpi: 203 });
    expect((imported.document.elements[0] as { symbology: string }).symbology).toBe(
      'gs1-datamatrix',
    );
  });
});

describe('a value set for a variable', () => {
  const withVariable = createDocument({
    width: 60,
    height: 40,
    operation: 'art',
    elements: [{ id: 't1', type: 'text', x: 4, y: 4, content: '@Name1@', style: { heightMm: 3 } }],
  });

  it('is what the preview shows, in place of the catalogue sample', () => {
    const chosen = { ...withVariable, variableSamples: { '@Name1@': 'Очень длинное имя товара' } };
    const { source } = generateTspl(chosen, { dpi: 203, resolveVariables: true });
    expect(source).toContain('Очень длинное имя товара');
  });

  it('is matched the way variable names are, ignoring case', () => {
    const chosen = { ...withVariable, variableSamples: { '@name1@': 'Кабель' } };
    expect(generateTspl(chosen, { dpi: 203, resolveVariables: true }).source).toContain('Кабель');
  });

  it('never reaches the file DataMobile reads', () => {
    const chosen = { ...withVariable, variableSamples: { '@Name1@': 'Кабель' } };
    const { source } = generateTspl(chosen, { dpi: 203 });
    expect(source).toContain('@Name1@');
    expect(source).not.toContain('Кабель');
  });

  it('round-trips through a saved file', () => {
    const chosen = { ...withVariable, variableSamples: { '@Name1@': 'Кабель' } };
    const read = parseDocument(JSON.parse(serializeDocument(chosen))).document!;
    expect(read.variableSamples).toEqual({ '@Name1@': 'Кабель' });
  });
});

describe('GS1-128, which spells the separator FNC1', () => {
  const barcodeLabel = (data = PAYLOAD): LabelDocument =>
    createDocument({
      width: 60,
      height: 40,
      elements: [
        {
          id: 'b1',
          type: 'barcode',
          x: 4,
          y: 4,
          symbology: 'gs1-128',
          data,
          moduleWidth: 0.25,
          height: 12,
          gs1Separator: '~1',
        },
      ],
    });

  it('keeps the token in the file and writes the character in the preview', () => {
    expect(generateTspl(barcodeLabel(), { dpi: 203 }).source).toContain('~1');
    const preview = generateTspl(barcodeLabel(), { dpi: 203, resolveVariables: true }).source;
    expect(preview).toContain(GROUP_SEPARATOR);
    expect(preview).not.toContain('~1');
  });

  it('draws, with the separator encoded as FNC1 rather than a control code', () => {
    const preview = generateTspl(barcodeLabel(), { dpi: 203, resolveVariables: true }).source;
    const drawn = renderTspl(preview, { fonts: fonts(), dpi: 203 });
    expect(drawn.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);

    // The separator in the data and FNC1 written out by hand are the same
    // symbol, which is what "translated rather than encoded" means.
    const fromSeparator = encodeCode128(PAYLOAD.replace('~1', GROUP_SEPARATOR), { gs1: true });
    const fromFunctionCode = encodeCode128(PAYLOAD.replace('~1', FNC1), { gs1: true });
    expect(fromSeparator.modules).toEqual(fromFunctionCode.modules);

  });

  it('scans: an independent decoder reads the payload back', () => {
    const symbol = encodeCode128(PAYLOAD.replace('~1', GROUP_SEPARATOR), { gs1: true });
    const bitmap = renderLinear(symbol, { moduleWidth: 3, height: 60 });
    // ZXing drops the function codes from the text it returns, so what comes
    // back is the payload without its separators.
    expect(decode(bitmap, [BarcodeFormat.CODE_128])).toBe(PAYLOAD.replace('~1', ''));
  });

  it('leaves the token unescaped in ZPL, where a tilde would otherwise be hidden', () => {
    const { source } = generateZpl(barcodeLabel(), { dpi: 203 });
    expect(source).toContain('~1');
    expect(source).not.toContain('_7E');
  });

  it('is read back as GS1-128 from ^BC mode D', () => {
    const { source } = generateZpl(barcodeLabel(), { dpi: 203 });
    const imported = importZpl(source, { dpi: 203 });
    expect((imported.document.elements[0] as { symbology: string }).symbology).toBe('gs1-128');
  });

  it('goes to CPCL as UCCEAN128, which is what CPCL calls it', () => {
    const { source } = generateCpcl(barcodeLabel(), { dpi: 203 });
    expect(source).toContain('UCCEAN128');
    const drawn = renderCpcl(
      generateCpcl(barcodeLabel(), { dpi: 203, resolveVariables: true }).source,
      { fonts: fonts(), dpi: 203 },
    );
    expect(drawn.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });
});
