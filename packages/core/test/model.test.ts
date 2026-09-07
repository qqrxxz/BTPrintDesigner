import { describe, expect, it } from 'vitest';
import { createDocument, elementBounds, type LabelElement } from '../src/model/document.js';
import {
  documentPlaceholders,
  findPlaceholders,
  substitute,
} from '../src/model/placeholders.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';

const text = (overrides: Partial<Extract<LabelElement, { type: 'text' }>> = {}) => ({
  id: 't1',
  type: 'text' as const,
  x: 3,
  y: 4,
  content: 'Hello',
  style: { heightMm: 3 },
  ...overrides,
});

describe('placeholders', () => {
  it('finds each name once, in order', () => {
    expect(findPlaceholders('{{sku}} / {{lot}} / {{sku}}')).toEqual(['sku', 'lot']);
  });

  it('tolerates spaces inside the braces', () => {
    expect(findPlaceholders('{{ sku }}')).toEqual(['sku']);
  });

  it('ignores text that only looks like a placeholder', () => {
    expect(findPlaceholders('{sku} {{ }} {{1bad}}')).toEqual([]);
  });

  it('substitutes values', () => {
    const result = substitute('{{sku}}-{{lot}}', { sku: '4820', lot: '2026-09' });
    expect(result.text).toBe('4820-2026-09');
    expect(result.missing).toEqual([]);
  });

  it('leaves an unresolved placeholder in place rather than blanking it', () => {
    // Blanking would shrink the text and hide the collision the preview exists
    // to reveal.
    const result = substitute('{{sku}}-{{lot}}', { sku: '4820' });
    expect(result.text).toBe('4820-{{lot}}');
    expect(result.missing).toEqual(['lot']);
  });

  it('reports a missing name once however often it appears', () => {
    expect(substitute('{{a}} {{a}}', {}).missing).toEqual(['a']);
  });

  it('collects placeholders from text, barcodes and matrix symbols', () => {
    const document = createDocument({
      elements: [
        text({ content: 'SKU {{sku}}' }),
        { id: 'b1', type: 'barcode', x: 0, y: 0, symbology: 'code128', data: '{{sku}}-{{lot}}', moduleWidth: 0.25, height: 10 },
        { id: 'm1', type: 'matrix', x: 0, y: 0, symbology: 'qr', data: '{{url}}', moduleWidth: 0.4 },
      ],
    });
    expect(documentPlaceholders(document)).toEqual(['sku', 'lot', 'url']);
  });
});

describe('element bounds', () => {
  it('measures a rectangle', () => {
    expect(
      elementBounds({ id: 'r', type: 'rectangle', x: 1, y: 2, width: 10, height: 5, fill: 'solid' }),
    ).toEqual({ x: 1, y: 2, width: 10, height: 5 });
  });

  it('measures a line from either direction', () => {
    const bounds = elementBounds({
      id: 'l',
      type: 'line',
      x: 20,
      y: 5,
      x2: 4,
      y2: 5,
      thickness: 0.5,
    })!;
    expect(bounds.x).toBe(4);
    expect(bounds.width).toBeCloseTo(16.5, 6);
  });

  it('measures a text box but declines to guess at a free line', () => {
    expect(elementBounds(text({ box: { width: 30, height: 8 } }))).toEqual({
      x: 3,
      y: 4,
      width: 30,
      height: 8,
    });
    expect(elementBounds(text())).toBeUndefined();
  });
});

describe('reading a document', () => {
  const valid = {
    version: 1 as const,
    name: 'Cable',
    width: 60,
    height: 40,
    elements: [text()],
  };

  it('round-trips through serialisation', () => {
    const { document } = parseDocument(JSON.parse(serializeDocument(createDocument(valid))));
    expect(document).toMatchObject({ name: 'Cable', width: 60, height: 40 });
    expect(document!.elements).toHaveLength(1);
  });

  it('refuses a file from a newer format rather than mangling it', () => {
    const result = parseDocument({ ...valid, version: 99 });
    expect(result.document).toBeUndefined();
    expect(result.issues[0]!.message).toMatch(/newer version/);
  });

  it('recovers a bad number with a warning instead of failing the file', () => {
    const result = parseDocument({ ...valid, width: 'wide' });
    expect(result.document!.width).toBe(60);
    expect(result.issues[0]).toMatchObject({ severity: 'warning', path: 'width' });
  });

  it('drops an element of unknown type and names its path', () => {
    const result = parseDocument({
      ...valid,
      elements: [text(), { id: 'x', type: 'hologram', x: 0, y: 0 }],
    });
    expect(result.document!.elements).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ severity: 'error', path: 'elements[1].type' });
  });

  it('drops an element with no id, which nothing could refer to', () => {
    const result = parseDocument({ ...valid, elements: [{ type: 'text', x: 0, y: 0 }] });
    expect(result.document!.elements).toHaveLength(0);
    expect(result.issues[0]!.path).toBe('elements[0].id');
  });

  it('keeps a duplicate id but says so', () => {
    const result = parseDocument({ ...valid, elements: [text(), text()] });
    expect(result.document!.elements).toHaveLength(2);
    expect(result.issues.some((issue) => /Duplicate id/.test(issue.message))).toBe(true);
  });

  it('falls back on an out-of-range rotation', () => {
    const result = parseDocument({ ...valid, elements: [text({ rotation: 45 as 90 })] });
    expect(result.document!.elements[0]!.rotation).toBe(0);
    expect(result.issues[0]!.message).toMatch(/Rotation must be/);
  });

  it('falls back on an unknown symbology', () => {
    const result = parseDocument({
      ...valid,
      elements: [{ id: 'b', type: 'barcode', x: 0, y: 0, symbology: 'aztec', data: 'x', moduleWidth: 0.25, height: 10 }],
    });
    expect(result.document!.elements[0]).toMatchObject({ symbology: 'code128' });
  });

  it('rejects a value that is not a document at all', () => {
    expect(parseDocument('nonsense').document).toBeUndefined();
    expect(parseDocument(null).document).toBeUndefined();
  });

  it('keeps only text sample values', () => {
    const result = parseDocument({ ...valid, sampleData: { sku: '4820', qty: 12 } });
    expect(result.document!.sampleData).toEqual({ sku: '4820' });
    expect(result.issues[0]!.path).toBe('sampleData.qty');
  });

  it('accepts a document with no elements', () => {
    const result = parseDocument({ version: 1, name: 'Blank', width: 30, height: 20 });
    expect(result.document!.elements).toEqual([]);
    expect(result.issues).toHaveLength(0);
  });
});
