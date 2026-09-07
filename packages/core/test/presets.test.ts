import { describe, expect, it } from 'vitest';
import { DATAMOBILE_OPERATIONS, type DataMobileOperation } from '../src/datamobile/variables.js';
import { generateCpcl } from '../src/generate/cpcl.js';
import { generateTspl } from '../src/generate/tspl.js';
import { generateZpl } from '../src/generate/zpl.js';
import { createDocument, type LabelDocument } from '../src/model/document.js';
import { PRESETS, PRESET_GROUPS, findPreset, type Preset } from '../src/model/presets.js';
import { renderTspl } from '../src/tspl/execute.js';
import { renderZpl } from '../src/zpl/execute.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

const labelWith = (preset: Preset, operation: DataMobileOperation): LabelDocument => {
  const document = createDocument({ width: 60, height: 40, operation });
  return { ...document, elements: [preset.make('e1', { x: 4, y: 4 }, document)] };
};

const operations = DATAMOBILE_OPERATIONS.map((entry) => entry.id);

describe('every preset, on every operation', () => {
  it('draws without an error, which is what the preview will do', () => {
    // Generating alone proves little: a command is written whatever its payload
    // says. A UPC-A holding thirteen digits, or a variable in a symbology whose
    // payload is a fixed shape, only fails when something encodes it — so the
    // presets are put through the same path the preview takes.
    for (const preset of PRESETS) {
      for (const operation of operations) {
        const label = labelWith(preset, operation);

        const tspl = generateTspl(label, { dpi: 203, resolveVariables: true }).source;
        const drawnTspl = renderTspl(tspl, { fonts: fonts(), dpi: 203 });
        expect(
          drawnTspl.diagnostics.filter((entry) => entry.severity === 'error'),
          `${preset.id} / ${operation} / TSPL`,
        ).toEqual([]);

        const zpl = generateZpl(label, { dpi: 203, resolveVariables: true }).source;
        const drawnZpl = renderZpl(zpl, { fonts: fonts(), dpi: 203 });
        expect(
          drawnZpl.diagnostics.filter((entry) => entry.severity === 'error'),
          `${preset.id} / ${operation} / ZPL`,
        ).toEqual([]);
      }
    }
  });

  it('puts something on the label rather than an empty image', () => {
    for (const preset of PRESETS) {
      const source = generateTspl(labelWith(preset, 'art'), {
        dpi: 203,
        resolveVariables: true,
      }).source;
      const image = renderTspl(source, { fonts: fonts(), dpi: 203 }).labels[0]!.bitmap;
      let dots = 0;
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) if (image.get(x, y)) dots++;
      }
      expect(dots, preset.id).toBeGreaterThan(20);
    }
  });

  it('only uses variables the operation offers', () => {
    for (const preset of PRESETS) {
      for (const operation of operations) {
        const issues = generateTspl(labelWith(preset, operation), { dpi: 203 }).issues;
        const wrong = issues.filter(
          (issue) =>
            issue.code === 'generate.variable-unknown' ||
            issue.code === 'generate.variable-unavailable',
        );
        expect(wrong, `${preset.id} / ${operation}`).toEqual([]);
      }
    }
  });

  it('survives CPCL, which cannot draw everything', () => {
    // CPCL has no Data Matrix and no rounded corner; those are honest refusals
    // and not a preset's fault, so this only asks that it does not throw.
    for (const preset of PRESETS) {
      expect(() => generateCpcl(labelWith(preset, 'art'), { dpi: 203 })).not.toThrow();
    }
  });
});

describe('a value with a line break in it', () => {
  // DataMobile's scanning log is one of these: several codes, one per line.
  const label = (data: string): LabelDocument => {
    const document = createDocument({ width: 60, height: 40 });
    return {
      ...document,
      elements: [
        { id: 't', type: 'text', x: 4, y: 30, content: data, style: { heightMm: 3 } },
        { id: 'm', type: 'matrix', x: 4, y: 4, symbology: 'qr', data, moduleWidth: 0.5 },
      ],
    };
  };

  it('does not leave TSPL with a stray command', () => {
    const { source, issues } = generateTspl(label('AAA\nBBB'), { dpi: 203 });
    expect(source).not.toMatch(/\n(AAA|BBB)/);
    expect(issues.map((issue) => issue.code)).toContain('generate.line-break-flattened');
    const drawn = renderTspl(source, { fonts: fonts(), dpi: 203 });
    expect(drawn.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  });

  it('does not leave CPCL text with a stray command', () => {
    // A CPCL symbol block does carry a break — its payload is the lines up to
    // ENDQR — so only the one-line text command is flattened.
    const { source, issues } = generateCpcl(label('AAA\nBBB'), { dpi: 203 });
    expect(issues.map((issue) => issue.code)).toContain('generate.line-break-flattened');
    expect(source).toMatch(/TEXT [^\n]*AAA BBB/);
    expect(source).toContain('MA,AAA\nBBB');
  });

  it('leaves ZPL alone, which carries the break as data', () => {
    const { source, issues } = generateZpl(label('AAA\nBBB'), { dpi: 203 });
    expect(source).toContain('AAA\nBBB');
    expect(issues.map((issue) => issue.code)).not.toContain('generate.line-break-flattened');
  });
});

describe('the catalogue itself', () => {
  it('gives each preset its own identifier', () => {
    const ids = PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPreset('barcode:code128')?.group).toBe('barcode');
    expect(findPreset('nothing:here')).toBeUndefined();
  });

  it('names every group a preset belongs to, and no others', () => {
    const listed = PRESET_GROUPS.map((group) => group.id);
    expect(new Set(PRESETS.map((preset) => preset.group))).toEqual(new Set(listed));
  });

  it('names every preset in both languages', () => {
    for (const preset of PRESETS) {
      expect(preset.ru.length, preset.id).toBeGreaterThan(0);
      expect(preset.en.length, preset.id).toBeGreaterThan(0);
    }
  });
});
