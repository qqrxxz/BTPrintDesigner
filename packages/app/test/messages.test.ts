import { describe, expect, it } from 'vitest';
import { generateTspl } from '../../core/src/generate/tspl.js';
import { importTspl } from '../../core/src/import/tspl.js';
import { createDocument } from '../../core/src/model/document.js';
import { parseTspl } from '../../core/src/tspl/parse.js';
import { translate } from '../src/messages.js';

describe('translating engine messages', () => {
  it('falls back to the English wording when there is no code', () => {
    expect(translate('ru', 'Something happened')).toBe('Something happened');
  });

  it('falls back when the code has no translation', () => {
    expect(translate('ru', 'Untranslated', 'no.such.code')).toBe('Untranslated');
  });

  it('leaves English alone', () => {
    expect(translate('en', 'Unknown command "FOO"', 'tspl.unknown-command', { command: 'FOO' })).toBe(
      'Unknown command "FOO"',
    );
  });

  it('substitutes values into the translation', () => {
    expect(translate('ru', 'x', 'tspl.unknown-command', { command: 'FROBNICATE' })).toBe(
      'Неизвестная команда «FROBNICATE»',
    );
  });

  it('keeps the braces of a placeholder name intact', () => {
    expect(translate('ru', 'x', 'generate.placeholder-missing', { name: 'sku' })).toContain(
      '{{sku}}',
    );
  });

  it('leaves an unfilled slot visible rather than blanking it', () => {
    // A missing value is a bug in the caller, and a gap in the sentence is
    // easier to notice than a silently shortened one.
    expect(translate('ru', 'x', 'tspl.unknown-command', {})).toContain('{command}');
  });
});

/**
 * The engine's messages are only translatable if they carry a code, so these
 * check the codes actually arrive rather than trusting that they do.
 */
describe('the engine tags its messages', () => {
  it('tags a parse error', () => {
    const { diagnostics } = parseTspl('CLS\n123,456');
    expect(diagnostics[0]!.code).toBe('parse.expected-command');
  });

  it('tags a generation warning with the values its wording needs', () => {
    const document = createDocument({
      elements: [
        {
          id: 'b',
          type: 'barcode',
          x: 4,
          y: 4,
          symbology: 'code128',
          data: 'X',
          moduleWidth: 0.05,
          height: 10,
        },
      ],
    });
    const issue = generateTspl(document, { dpi: 203 }).issues[0]!;
    expect(issue.code).toBe('generate.snapped');
    expect(translate('ru', issue.message, issue.code, issue.values)).toMatch(/печатается 1/);
  });

  it('tags every reason the importer detaches on', () => {
    const source = [
      'SIZE 60 mm, 40 mm',
      'CLS',
      'PUTBMP 10,10,"logo.bmp"',
      'FROBNICATE 1',
      'BARCODE 0,0,"MSI",80,0,0,2,4,"1"',
      'PRINT 1,1',
    ].join('\n');
    const { unmapped } = importTspl(source);
    expect(unmapped).toHaveLength(3);
    for (const entry of unmapped) {
      expect(entry.code).toBeDefined();
      expect(translate('ru', entry.reason, entry.code, entry.values)).not.toBe(entry.reason);
    }
  });
});
