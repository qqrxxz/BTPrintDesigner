import { describe, expect, it } from 'vitest';
import { generateCpcl } from '../src/generate/cpcl.js';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { importCpcl } from '../src/import/cpcl.js';
import { importTspl } from '../src/import/tspl.js';
import { importZpl } from '../src/import/zpl.js';
import { createDocument, type LabelDocument } from '../src/model/document.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';

const label = (quantity?: string): LabelDocument =>
  createDocument({ width: 58, height: 40, ...(quantity === undefined ? {} : { quantity }) });

describe('the quantity of a template', () => {
  it('goes out as the variable DataMobile fills', () => {
    expect(generateTspl(label('@Quant@'), { dpi: 203 }).source).toContain('PRINT 1,@Quant@');
    expect(generateZpl(label('@Quant@'), { dpi: 203 }).source).toContain('^PQ@Quant@');
    expect(generateCpcl(label('@Quant@'), { dpi: 203 }).source).toMatch(/^! 0 200 200 \d+ @Quant@$/m);
  });

  it('becomes the sample in the preview, where the interpreter wants a count', () => {
    const preview = generateTspl(label('@Quant@'), { dpi: 203, resolveVariables: true });
    expect(preview.source).toContain('PRINT 1,12');
    const chosen = { ...label('@Quant@'), variableSamples: { '@Quant@': '3' } };
    expect(generateZpl(chosen, { dpi: 203, resolveVariables: true }).source).toContain('^PQ3');
  });

  it('is one when nothing is said', () => {
    expect(generateTspl(label(), { dpi: 203 }).source).toContain('PRINT 1,1');
    expect(generateZpl(label(), { dpi: 203 }).source).toContain('^PQ1');
  });

  it('says so when it cannot be sent, rather than sending it', () => {
    const { source, issues } = generateTspl(label('двенадцать'), { dpi: 203 });
    expect(source).toContain('PRINT 1,1');
    expect(issues.map((issue) => issue.code)).toContain('generate.quantity-invalid');
  });
});

describe('reading the quantity back', () => {
  it('keeps the variable of each language as written', () => {
    const tspl = importTspl('SIZE 58 mm,40 mm\nCLS\nBAR 8,8,80,8\nPRINT 1,@Quant@\n');
    expect(tspl.document.quantity).toBe('@Quant@');
    const zpl = importZpl('^XA\n^FO8,8^GB80,8,8^FS\n^PQ@Quant@\n^XZ\n');
    expect(zpl.document.quantity).toBe('@Quant@');
    const cpcl = importCpcl('! 0 200 200 210 @Quant@\nLINE 8 8 80 8 3\nFORM\nPRINT\n');
    expect(cpcl.document.quantity).toBe('@Quant@');
  });

  it('writes back exactly what it read', () => {
    const source = 'SIZE 58 mm,40 mm\nCLS\nBAR 8,8,80,8\nPRINT 1,@Quant@\n';
    const again = generateTspl(importTspl(source).document, { dpi: 203 }).source;
    expect(again).toContain('PRINT 1,@Quant@');
  });

  it('leaves a single label unsaid', () => {
    expect(importTspl('SIZE 58 mm,40 mm\nCLS\nPRINT 1\n').document).not.toHaveProperty('quantity');
    expect(importZpl('^XA\n^PQ1\n^XZ\n').document).not.toHaveProperty('quantity');
  });

  it('survives a saved project', () => {
    const read = parseDocument(JSON.parse(serializeDocument(label('@Quant@')))).document!;
    expect(read.quantity).toBe('@Quant@');
  });
});
