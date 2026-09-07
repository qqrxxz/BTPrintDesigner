import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderZpl } from '../src/zpl/execute.js';
import { BarcodeFormat, decode } from './helpers/decode.js';
import { condensedBoldFont, monoFont } from './helpers/fonts.js';
import { compare, decodePng, toBitmap } from './helpers/png.js';

/**
 * ZPL against Labelary.
 *
 * This is the strictest check in the project, and the only one with an
 * independent renderer to check against. A label with no text on it has to come
 * out dot for dot identical: the geometry, the barcodes and the placement are
 * all decided by the standard, so any difference is an error on one side or the
 * other. Where a sample cannot match, it says why in its own note, and the
 * tolerance sits just above what is observed so a regression still fails.
 *
 * Three things are known to differ and none of them is a defect:
 *
 * - Labelary anti-aliases curves and slopes; this renderer prints a dot or does
 *   not, because that is what a thermal head does.
 * - QR mask selection and PDF417 compaction are encoder choices, not fixed by
 *   the standard. Where ours differs the test decodes the symbol instead, which
 *   is what actually matters.
 * - Resident fonts are substituted, so letterforms differ by design.
 */

interface Sample {
  readonly id: string;
  readonly zpl: string;
  readonly maxDiffering?: number;
  readonly minAgreement?: number;
  readonly note?: string;
  readonly decodes?: { format: keyof typeof BarcodeFormat; text: string };
}

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const config = JSON.parse(readFileSync(here('./golden/samples.json'), 'utf8')) as {
  size: { width: number; height: number };
  samples: Sample[];
};

const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });

describe('ZPL against Labelary', () => {
  for (const sample of config.samples) {
    it(`${sample.id}${sample.maxDiffering === 0 ? ' matches dot for dot' : ''}`, () => {
      const reference = toBitmap(decodePng(readFileSync(here(`./golden/${sample.id}.png`))));
      const rendered = renderZpl(sample.zpl, {
        fonts: fonts(),
        // Labelary sizes the canvas from the label dimensions in its URL; ours
        // is told the same size so the two images are comparable.
        defaultWidthDots: reference.width,
        defaultHeightDots: reference.height,
      });
      expect(rendered.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);

      const ours = rendered.labels[0]!.bitmap;
      expect(ours.width).toBe(reference.width);
      expect(ours.height).toBe(reference.height);

      const result = compare(ours, reference);
      if (sample.maxDiffering !== undefined) {
        expect(
          result.differing,
          `${result.differing} dots differ, first at ` +
            `${result.firstDifference?.x},${result.firstDifference?.y}`,
        ).toBeLessThanOrEqual(sample.maxDiffering);
      }
      if (sample.minAgreement !== undefined) {
        expect(result.agreement).toBeGreaterThanOrEqual(sample.minAgreement);
      }

      if (sample.decodes) {
        expect(decode(ours, [BarcodeFormat[sample.decodes.format]])).toBe(sample.decodes.text);
      }
    });
  }

  it('holds thirteen samples to a dot-for-dot match', () => {
    // If this number falls, something that used to be exact has drifted.
    const exact = config.samples.filter((sample) => sample.maxDiffering === 0);
    expect(exact).toHaveLength(13);
  });

  it('explains every sample that cannot match exactly', () => {
    for (const sample of config.samples) {
      if (sample.maxDiffering === 0) continue;
      expect(sample.note, `${sample.id} has a tolerance but no reason`).toBeTruthy();
    }
  });
});
