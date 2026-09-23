import { describe, expect, it } from 'vitest';
import { createDocument, parseDocument, serializeDocument, type LabelDocument } from '@btpd/core';
import { documentToSave, reopenedDesign } from '../src/project.js';

const design = (overrides: Partial<LabelDocument> = {}): LabelDocument =>
  createDocument({ name: 'Ценник', width: 58, height: 40, ...overrides });

const HAND_WRITTEN = 'SIZE 58 mm,40 mm\nCLS\nSOUND 3,200\nTEXT 8,8,"2",0,1,1,1,"руками"\nPRINT 1,@Quant@\n';

describe('saving while the code is in charge', () => {
  it('writes the hand-written code into the project', () => {
    // Saving the elements alone threw these lines away while the title bar
    // said the work was saved.
    const saved = documentToSave({ document: design(), mode: 'detached', code: HAND_WRITTEN });
    expect(saved.code).toBe(HAND_WRITTEN);
  });

  it('keeps it through a file on disk', () => {
    const saved = documentToSave({ document: design(), mode: 'detached', code: HAND_WRITTEN });
    const read = parseDocument(JSON.parse(serializeDocument(saved))).document!;
    expect(read.code).toBe(HAND_WRITTEN);
  });

  it('writes the design alone when the design is in charge', () => {
    expect(documentToSave({ document: design(), mode: 'linked', code: HAND_WRITTEN })).not.toHaveProperty(
      'code',
    );
  });

  it('never carries an old copy of the code into a design saved later', () => {
    const stale = design({ code: 'CLS' });
    expect(documentToSave({ document: stale, mode: 'linked', code: '' })).not.toHaveProperty('code');
  });
});

describe('opening a project that carried its code', () => {
  it('brings back what the code cannot say for itself', () => {
    const saved = design({
      operation: 'art',
      encoding: 'windows-1251',
      variableSamples: { '@Name1@': 'Кабель' },
      code: HAND_WRITTEN,
    });
    const fromCode = createDocument({ name: 'Imported label', width: 58, height: 40 });
    const shown = reopenedDesign(fromCode, saved, 'ignored');
    expect(shown).toMatchObject({
      name: 'Ценник',
      operation: 'art',
      encoding: 'windows-1251',
      variableSamples: { '@Name1@': 'Кабель' },
    });
    expect(shown).not.toHaveProperty('code');
  });

  it('names a plain printer file after the file', () => {
    const fromCode = createDocument({ name: 'Imported label', width: 58, height: 40 });
    expect(reopenedDesign(fromCode, undefined, 'art_TSPL_58x40_TSC').name).toBe('art_TSPL_58x40_TSC');
  });
});
