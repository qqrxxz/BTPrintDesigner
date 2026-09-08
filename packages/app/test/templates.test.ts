import { describe, expect, it } from 'vitest';
import { detectLanguage, DATAMOBILE_OPERATIONS } from '@btpd/core';
import { importCpcl } from '../../core/src/import/cpcl.js';
import { importTspl } from '../../core/src/import/tspl.js';
import { importZpl } from '../../core/src/import/zpl.js';
import { STOCK_TEMPLATES, templatesFor } from '../src/templates.js';

const importers = { tspl: importTspl, zpl: importZpl, cpcl: importCpcl };

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
