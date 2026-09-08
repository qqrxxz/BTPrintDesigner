import { describe, expect, it } from 'vitest';
import { generateTspl } from '../src/generate/tspl.js';
import { createDocument } from '../src/model/document.js';
import { parseDocument, serializeDocument } from '../src/model/validate.js';
import { declaredEncoding, encodeText, resolveEncoding } from '../src/printer/encoding.js';

const back = (bytes: Uint8Array, encoding: string) => new TextDecoder(encoding).decode(bytes);

describe('what the code declares', () => {
  it('reads TSPL"s code page', () => {
    expect(declaredEncoding('SIZE 60 mm, 40 mm\nCODEPAGE 1251\nCLS')).toBe('windows-1251');
    expect(declaredEncoding('CODEPAGE UTF-8\nCLS')).toBe('utf-8');
  });

  it('reads ZPL"s ^CI28 as Unicode', () => {
    expect(declaredEncoding('^XA\n^CI28\n^XZ')).toBe('utf-8');
  });

  it('reads CPCL"s ENCODING', () => {
    expect(declaredEncoding('! 0 200 200 320 1\nENCODING UTF-8\nPRINT')).toBe('utf-8');
  });

  it('says nothing when the code says nothing', () => {
    expect(declaredEncoding('^XA\n^FO10,10^FDx^FS\n^XZ')).toBeUndefined();
  });

  it('is what auto follows, with UTF-8 for silence', () => {
    expect(resolveEncoding('auto', 'CODEPAGE 1251\nCLS')).toBe('windows-1251');
    expect(resolveEncoding(undefined, 'CODEPAGE 1251\nCLS')).toBe('windows-1251');
    expect(resolveEncoding('auto', 'CLS')).toBe('utf-8');
    // A choice is a choice: it wins over what the code declares.
    expect(resolveEncoding('utf-8', 'CODEPAGE 1251\nCLS')).toBe('utf-8');
  });
});

describe('writing the bytes', () => {
  const russian = 'Кабель USB-C 2 м, 1 299 руб';

  it('writes Windows-1251 a printer told CODEPAGE 1251 can read', () => {
    const { bytes, unsupported } = encodeText(russian, 'windows-1251');
    expect(unsupported).toEqual([]);
    // One byte per character, which is the point of a single-byte page.
    expect(bytes.length).toBe(russian.length);
    expect(back(bytes, 'windows-1251')).toBe(russian);
  });

  it('writes UTF-8 when that is what was asked for', () => {
    const { bytes } = encodeText(russian, 'utf-8');
    expect(bytes.length).toBeGreaterThan(russian.length);
    expect(back(bytes, 'utf-8')).toBe(russian);
  });

  it('names a character the page has no byte for rather than dropping it', () => {
    // 1251 covers Cyrillic and the euro but nothing of Latin-1's accents.
    const { bytes, unsupported } = encodeText('Müller 12 €', 'windows-1251');
    expect(unsupported).toEqual(['ü']);
    expect(back(bytes, 'windows-1251')).toBe('M?ller 12 €');
  });

  it('carries a whole label through', () => {
    const label = createDocument({
      width: 58,
      height: 40,
      elements: [
        { id: 't1', type: 'text', x: 4, y: 4, content: 'Кабель', style: { heightMm: 3 } },
      ],
    });
    const { source } = generateTspl(label, { dpi: 203 });
    const { bytes, unsupported } = encodeText(source, 'windows-1251');
    expect(unsupported).toEqual([]);
    expect(back(bytes, 'windows-1251')).toBe(source);
  });
});

describe('the choice in a saved file', () => {
  it('round-trips', () => {
    const saved = serializeDocument(
      createDocument({ width: 60, height: 40, encoding: 'windows-1251' }),
    );
    expect(parseDocument(JSON.parse(saved)).document!.encoding).toBe('windows-1251');
  });

  it('falls back on an encoding this program does not write', () => {
    const result = parseDocument({ version: 1, width: 60, height: 40, encoding: 'koi8-r' });
    expect(result.document!.encoding).toBe('auto');
    expect(result.issues[0]!.path).toBe('encoding');
  });
});
