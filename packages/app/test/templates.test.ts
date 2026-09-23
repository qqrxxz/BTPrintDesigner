import { describe, expect, it } from 'vitest';
import {
  DATAMOBILE_OPERATIONS,
  detectLanguage,
  encodeText,
  principalLabel,
  resolveEncoding,
} from '@btpd/core';
import { renderCpcl } from '../../core/src/cpcl/execute.js';
import { renderTspl } from '../../core/src/tspl/execute.js';
import { renderZpl } from '../../core/src/zpl/execute.js';
import { condensedBoldFont, monoFont } from '../../core/test/helpers/fonts.js';
import { generateCpcl } from '../../core/src/generate/cpcl.js';
import { generateTspl } from '../../core/src/generate/tspl.js';
import { generateZpl } from '../../core/src/generate/zpl.js';
import { importCpcl } from '../../core/src/import/cpcl.js';
import { importTspl } from '../../core/src/import/tspl.js';
import { importZpl } from '../../core/src/import/zpl.js';
import { STOCK_TEMPLATES, templatesFor } from '../src/templates.js';

const importers = { tspl: importTspl, zpl: importZpl, cpcl: importCpcl };
const generators = { tspl: generateTspl, zpl: generateZpl, cpcl: generateCpcl };

describe('the bundled templates', () => {
  it('are all there, with their text', () => {
    expect(STOCK_TEMPLATES.length).toBe(16);
    for (const entry of STOCK_TEMPLATES) {
      expect(entry.source.length, entry.file).toBeGreaterThan(50);
    }
  });

  it('are in the language the catalogue says', () => {
    for (const entry of STOCK_TEMPLATES) {
      expect(detectLanguage(entry.source), entry.file).toBe(entry.language);
    }
  });

  it('open as designs the panel can edit, not as walls of complaint', () => {
    // The point of shipping these is that they open ready to change. If a
    // vendor command stops being understood, this is where it shows.
    for (const entry of STOCK_TEMPLATES) {
      const result = importers[entry.language](entry.source, { dpi: 203 });
      expect(result.unmapped.map((line) => line.source), entry.file).toEqual([]);
      expect(result.mode, entry.file).toBe('linked');
      expect(result.document.elements.length, entry.file).toBeGreaterThan(3);
    }
  });

  it('carry the DataMobile variables they are templates for', () => {
    for (const entry of STOCK_TEMPLATES) {
      expect(entry.source, entry.file).toMatch(/@[A-Za-z][A-Za-z0-9_.]*@/);
    }
  });

  it('name only operations DataMobile has', () => {
    const known = new Set(DATAMOBILE_OPERATIONS.map((operation) => operation.id));
    for (const entry of STOCK_TEMPLATES) {
      expect(entry.operations.length, entry.file).toBeGreaterThan(0);
      for (const operation of entry.operations) expect(known.has(operation), operation).toBe(true);
    }
  });

  it('offers every operation something, and everything for "any"', () => {
    expect(templatesFor('all')).toHaveLength(STOCK_TEMPLATES.length);
    expect(templatesFor(undefined)).toHaveLength(STOCK_TEMPLATES.length);
    for (const operation of DATAMOBILE_OPERATIONS) {
      if (operation.id === 'all') continue;
      expect(templatesFor(operation.id).length, operation.id).toBeGreaterThan(0);
    }
  });
});

describe('exporting a template again', () => {
  it('writes the bytes the template itself asks for', () => {
    // Every TSC template says CODEPAGE 1251, and a printer told that and then
    // handed UTF-8 prints nonsense where the Russian was.
    for (const entry of STOCK_TEMPLATES) {
      const encoding = resolveEncoding(undefined, entry.source);
      const declared = /CODEPAGE\s+1251/i.test(entry.source);
      expect(encoding, entry.file).toBe(declared ? 'windows-1251' : 'utf-8');
    }
  });

  it('loses nothing on the way out', () => {
    for (const entry of STOCK_TEMPLATES) {
      const encoding = resolveEncoding(undefined, entry.source);
      const { bytes, unsupported } = encodeText(entry.source, encoding);
      expect(unsupported, entry.file).toEqual([]);
      expect(new TextDecoder(encoding).decode(bytes), entry.file).toBe(entry.source);
    }
  });
});

describe('editing a template keeps its DataMobile variables', () => {
  it('writes back every variable the vendor put in, @Quant@ included', () => {
    // Opening a template and changing anything used to turn PRINT 1,@Quant@
    // into PRINT 1,1 — eleven of these sixteen printed one label from then on,
    // whatever quantity was typed into DataMobile.
    for (const entry of STOCK_TEMPLATES) {
      const imported = importers[entry.language](entry.source, { dpi: 203 });
      const written = generators[entry.language](imported.document, { dpi: 203 }).source;
      const variables = new Set(entry.source.match(/@[A-Za-z][A-Za-z0-9_.]*@/g) ?? []);
      for (const variable of variables) expect(written, `${entry.file}: ${variable}`).toContain(variable);
    }
  });
});

describe('the preview of a template', () => {
  const fonts = () => ({ scalable: condensedBoldFont(), fixed: monoFont() });
  const renderers = { tspl: renderTspl, zpl: renderZpl, cpcl: renderCpcl };
  const draw = (language: 'tspl' | 'zpl' | 'cpcl', source: string) =>
    principalLabel(renderers[language](source, { fonts: fonts(), dpi: 203 }).labels)!.bitmap;

  it('shows the label, not the setup job in front of it', () => {
    // Three of the vendor's files begin with a job that only sets the printer
    // up, and the preview used to show that one: a blank sheet.
    for (const entry of STOCK_TEMPLATES) {
      expect(draw(entry.language, entry.source).data.some((byte) => byte !== 0), entry.file).toBe(true);
    }
  });

  it('prints dot for dot the same after a trip through the editor', () => {
    // The promise of the whole program: open a template, change nothing, and
    // what goes to the printer draws exactly what the vendor's file drew.
    for (const entry of STOCK_TEMPLATES) {
      const document = importers[entry.language](entry.source, { dpi: 203 }).document;
      const written = generators[entry.language](document, { dpi: 203 }).source;
      const before = draw(entry.language, entry.source);
      const after = draw(entry.language, written);
      expect(`${after.width}x${after.height}`, entry.file).toBe(`${before.width}x${before.height}`);
      let differing = 0;
      for (let at = 0; at < before.data.length; at++) {
        let bits = before.data[at]! ^ after.data[at]!;
        while (bits) {
          differing += bits & 1;
          bits >>= 1;
        }
      }
      expect(differing, `${entry.file}: dots that changed`).toBe(0);
    }
  });
});

describe('the fonts a template names', () => {
  /**
   * The preview draws every resident font with a substitute, so a font that
   * went missing on the way through draws the same dots and the pixel test
   * cannot see it — while the printer prints another typeface, often one
   * without Cyrillic. This looks at the file instead.
   */
  const fontsIn = (language: 'tspl' | 'zpl' | 'cpcl', source: string): Set<string> => {
    const found = new Set<string>();
    if (language === 'zpl') {
      for (const match of source.matchAll(/\^A([0-9A-Z@])[NRIB]?,[^,^]*,[^,^]*(?:,([^\^,]+))?/g)) {
        found.add(match[2] !== undefined ? match[2].trim().toUpperCase() : match[1]!);
      }
    } else if (language === 'cpcl') {
      for (const match of source.matchAll(/^(?:T|TEXT|T90|TEXT90|VT|VTEXT|T180|TEXT180|T270|TEXT270)\s+(\S+)\s+(\S+)/gm)) {
        found.add(`${match[1]} ${match[2]}`);
      }
    } else {
      for (const match of source.matchAll(/^(?:TEXT|BLOCK)\s[^"]*"([^"]+)"/gm)) found.add(match[1]!);
    }
    return found;
  };

  it('are the fonts it still names after a trip through the editor', () => {
    for (const entry of STOCK_TEMPLATES) {
      const document = importers[entry.language](entry.source, { dpi: 203 }).document;
      const written = generators[entry.language](document, { dpi: 203 }).source;
      const after = fontsIn(entry.language, written);
      for (const font of fontsIn(entry.language, entry.source)) {
        expect(after.has(font), `${entry.file}: ${font}`).toBe(true);
      }
    }
  });
});
