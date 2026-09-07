import { describe, expect, it } from 'vitest';
import {
  DATAMOBILE_GROUPS,
  DATAMOBILE_OPERATIONS,
  DATAMOBILE_VARIABLES,
  defaultContent,
  findVariable,
  isAvailable,
  sampleFor,
  variablesFor,
} from '../src/datamobile/variables.js';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { createDocument, type LabelDocument, type LabelElement } from '../src/model/document.js';
import {
  collectVariables,
  documentVariables,
  substituteVariables,
  unavailableVariables,
} from '../src/model/placeholders.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';

const barcode = (data: string): LabelElement => ({
  id: 'b',
  type: 'barcode',
  x: 4,
  y: 4,
  symbology: 'code128',
  data,
  moduleWidth: 0.25,
  height: 10,
});

const document = (elements: LabelElement[], overrides: Partial<LabelDocument> = {}) =>
  createDocument({ width: 60, height: 40, elements, ...overrides });

describe('the catalogue', () => {
  it('names every variable once', () => {
    const names = DATAMOBILE_VARIABLES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('wraps every name in at signs, as DataMobile spells them', () => {
    for (const entry of DATAMOBILE_VARIABLES) {
      expect(entry.name.startsWith('@'), entry.name).toBe(true);
      expect(entry.name.endsWith('@'), entry.name).toBe(true);
    }
  });

  it('gives every variable at least one operation and a sample', () => {
    for (const entry of DATAMOBILE_VARIABLES) {
      expect(entry.operations.length, entry.name).toBeGreaterThan(0);
      expect(entry.sample.length, entry.name).toBeGreaterThan(0);
      expect(entry.ru.length, entry.name).toBeGreaterThan(0);
      expect(entry.en.length, entry.name).toBeGreaterThan(0);
    }
  });

  it('only names operations the settings offer', () => {
    const known = new Set(DATAMOBILE_OPERATIONS.map((entry) => entry.id));
    for (const entry of DATAMOBILE_VARIABLES) {
      for (const operation of entry.operations) expect(known.has(operation), operation).toBe(true);
    }
  });

  it('keeps the vendor token inside every patterned name', () => {
    for (const entry of DATAMOBILE_VARIABLES) {
      if (!entry.pattern) continue;
      expect(entry.name, entry.name).toContain(entry.pattern.token);
    }
  });

  it('covers the variables the documentation leads with', () => {
    for (const name of ['@Barcode@', '@Price@', '@Name1@', '@Quant@', '@gtin@', '@Pack@']) {
      expect(findVariable(name), name).toBeDefined();
    }
  });
});

describe('what a new element says', () => {
  const kinds = ['text', 'barcode', 'matrix'] as const;

  it('offers a variable the operation actually has', () => {
    for (const operation of DATAMOBILE_OPERATIONS) {
      if (operation.id === 'all') continue;
      for (const kind of kinds) {
        const content = defaultContent(kind, operation.id);
        expect(content, `${operation.id}/${kind}`).toBeDefined();
        expect(isAvailable(content!, operation.id), `${operation.id}/${kind}`).toBe(true);
      }
    }
  });

  it('guesses nothing when the template is not tied to an operation', () => {
    for (const kind of kinds) {
      expect(defaultContent(kind, 'all')).toBeUndefined();
      expect(defaultContent(kind, undefined)).toBeUndefined();
    }
  });

  it('puts the product barcode on a product label, as one would by hand', () => {
    expect(defaultContent('barcode', 'art')).toBe('@Barcode@');
  });
});

describe('the groups', () => {
  it('names every group a variable belongs to, and no others', () => {
    const listed = DATAMOBILE_GROUPS.map((group) => group.id);
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(DATAMOBILE_VARIABLES.map((entry) => entry.group))).toEqual(new Set(listed));
  });
});

describe('looking a variable up', () => {
  it('finds a plain name', () => {
    expect(findVariable('@Barcode@')?.group).toBe('product');
  });

  it('ignores case, since a printer would not', () => {
    expect(findVariable('@barcode@')?.name).toBe('@Barcode@');
  });

  it('finds a patterned name with its number filled in', () => {
    // The catalogue holds @RowAttribute%dTitle@; a designer writes the real one.
    expect(findVariable('@RowAttribute2Title@')?.name).toBe('@RowAttribute%dTitle@');
    expect(findVariable('@tag3value@')?.name).toBe('@tag%dvalue@');
    expect(findVariable('@Qty_3102_GS1@')?.name).toBe('@Qty_310%s_GS1@');
  });

  it('returns nothing for a name DataMobile does not have', () => {
    expect(findVariable('@Bracode@')).toBeUndefined();
  });

  it('offers a different set to each operation', () => {
    expect(isAvailable('@Price@', 'art')).toBe(true);
    expect(isAvailable('@Price@', 'doc')).toBe(false);
    expect(isAvailable('@Pack@', 'upl')).toBe(true);
    expect(isAvailable('@Pack@', 'art')).toBe(false);
    expect(isAvailable('@gtin@', 'km')).toBe(true);
  });

  it('offers everything when the template is for any operation', () => {
    expect(variablesFor('all')).toHaveLength(DATAMOBILE_VARIABLES.length);
    expect(isAvailable('@Price@', 'all')).toBe(true);
  });

  it('offers fewer to a barcode copy than to a product label', () => {
    expect(variablesFor('copybarcode').length).toBeLessThan(variablesFor('art').length);
  });
});

describe('finding variables in text', () => {
  it('reports each one once, in order', () => {
    expect(collectVariables('@Name1@ / @Barcode@ / @Name1@').map((use) => use.name)).toEqual([
      '@Name1@',
      '@Barcode@',
    ]);
  });

  it('flags a name DataMobile does not know', () => {
    expect(collectVariables('@Bracode@')).toEqual([{ name: '@Bracode@', known: false }]);
  });

  it('leaves an email address alone', () => {
    expect(collectVariables('sales@example.com')).toEqual([]);
  });

  it('collects from text, barcodes and matrix symbols alike', () => {
    const used = documentVariables(
      document([
        { id: 't', type: 'text', x: 1, y: 1, content: '@Name1@', style: { heightMm: 3 } },
        barcode('@Barcode@'),
        { id: 'm', type: 'matrix', x: 1, y: 1, symbology: 'qr', data: '@BarcodeFull@', moduleWidth: 0.5 },
      ]),
    );
    expect(used.map((use) => use.name)).toEqual(['@Name1@', '@Barcode@', '@BarcodeFull@']);
  });

  it('names the variables an operation does not offer', () => {
    const label = document([
      { id: 't', type: 'text', x: 1, y: 1, content: '@Price@ @Comment@', style: { heightMm: 3 } },
    ]);
    expect(unavailableVariables(label, 'doc').map((use) => use.name)).toEqual(['@Price@']);
    expect(unavailableVariables(label, 'art')).toEqual([]);
  });
});

describe('substituting for the preview', () => {
  it('puts a sample of realistic length in place of a variable', () => {
    // The point of the sample: nine characters of "@Barcode@" would be judged
    // as fitting where thirteen digits do not.
    const sample = sampleFor('@Barcode@')!;
    expect(sample).toHaveLength(13);
    expect(substituteVariables('SKU @Barcode@')).toBe(`SKU ${sample}`);
  });

  it('substitutes a patterned name with the sample of its group', () => {
    expect(substituteVariables('@tag1value@')).toBe(sampleFor('@tag%dvalue@'));
  });

  it('leaves an unknown name exactly as written', () => {
    expect(substituteVariables('@Bracode@')).toBe('@Bracode@');
  });
});

describe('generating with variables', () => {
  const label = document([barcode('@Barcode@')], { operation: 'art' });

  it('keeps the variable in the file DataMobile will read', () => {
    // DataMobile is what fills these in; a generator that resolved them would
    // produce a label with one product's barcode frozen into it.
    expect(generateTspl(label, { dpi: 203 }).source).toContain('"@Barcode@"');
    expect(generateZpl(label, { dpi: 203 }).source).toContain('@Barcode@');
  });

  it('substitutes for the preview when asked', () => {
    const { source } = generateTspl(label, { dpi: 203, resolveVariables: true });
    expect(source).toContain(sampleFor('@Barcode@')!);
    expect(source).not.toContain('@Barcode@');
  });

  it('says nothing when every variable suits the operation', () => {
    expect(generateTspl(label, { dpi: 203 }).issues).toEqual([]);
  });

  it('warns about a variable the operation does not offer', () => {
    const wrong = document([barcode('@Price@')], { operation: 'doc' });
    const issue = generateTspl(wrong, { dpi: 203 }).issues[0]!;
    expect(issue).toMatchObject({ severity: 'warning', code: 'generate.variable-unavailable' });
    expect(issue.values).toMatchObject({ name: '@Price@', operation: 'doc' });
  });

  it('warns about a misspelt variable, which would print as itself', () => {
    const typo = document([barcode('@Bracode@')], { operation: 'art' });
    const issue = generateTspl(typo, { dpi: 203 }).issues[0]!;
    expect(issue.code).toBe('generate.variable-unknown');
    expect(issue.message).toMatch(/capitals/);
  });

  it('says nothing about operations when the template is for any of them', () => {
    const any = document([barcode('@Price@')], { operation: 'all' });
    expect(generateTspl(any, { dpi: 203 }).issues).toEqual([]);
  });

  it('still warns about a misspelt name with no operation set', () => {
    const typo = document([barcode('@Bracode@')]);
    expect(generateTspl(typo, { dpi: 203 }).issues[0]!.code).toBe('generate.variable-unknown');
  });
});

describe('symbols whose command carries their size', () => {
  const matrix = (symbology: 'datamatrix' | 'pdf417', data: string): LabelElement => ({
    id: 'm',
    type: 'matrix',
    x: 4,
    y: 4,
    symbology,
    data,
    moduleWidth: 0.5,
  });

  it('warns that a longer value than the sample will not fit', () => {
    // TSPL's DMATRIX states the symbol's own width and height, so the size is
    // fixed when the template is written, not when DataMobile fills it in.
    const label = document([matrix('datamatrix', '@Barcode@')], { operation: 'art' });
    const issue = generateTspl(label, { dpi: 203 }).issues.find(
      (entry) => entry.code === 'generate.variable-symbol-size',
    );
    expect(issue?.severity).toBe('warning');
    expect(issue?.values).toMatchObject({ symbology: 'Data Matrix' });
  });

  it('says nothing when the value is written out in full', () => {
    const label = document([matrix('datamatrix', '4006381333931')], { operation: 'art' });
    expect(generateTspl(label, { dpi: 203 }).issues).toEqual([]);
  });

  it('sizes the symbol for the sample, so the preview is honest', () => {
    const label = document([matrix('pdf417', '@Barcode@')], { operation: 'art' });
    const withVariable = generateTspl(label, { dpi: 203 }).source;
    const withSample = generateTspl(
      document([matrix('pdf417', sampleFor('@Barcode@')!)], { operation: 'art' }),
      { dpi: 203 },
    ).source;
    // Same command, same measurements; only the payload differs.
    const measurements = (source: string) => source.replace(/"[^"]*"/g, '""');
    expect(measurements(withVariable)).toBe(measurements(withSample));
  });
});

describe('the operation in a saved file', () => {
  it('round-trips', () => {
    const saved = serializeDocument(document([], { operation: 'km' }));
    expect(parseDocument(JSON.parse(saved)).document!.operation).toBe('km');
  });

  it('falls back on an operation DataMobile does not have', () => {
    const result = parseDocument({ version: 1, width: 60, height: 40, operation: 'invoices' });
    expect(result.document!.operation).toBe('all');
    expect(result.issues[0]!.path).toBe('operation');
  });

  it('leaves the field out when the label is not a template', () => {
    expect(document([])).not.toHaveProperty('operation');
  });
});
