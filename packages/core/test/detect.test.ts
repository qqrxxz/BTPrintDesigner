import { describe, expect, it } from 'vitest';
import { detectLanguage, isProjectFile } from '../src/printer/detect.js';

describe('recognising a printer language', () => {
  it('knows ZPL by the command that opens a format', () => {
    expect(detectLanguage('^XA\n^FO10,10^FDx^FS\n^XZ')).toBe('zpl');
    expect(detectLanguage('  ^xa ^fo10,10 ^xz')).toBe('zpl');
  });

  it('knows CPCL by the header its label starts with', () => {
    expect(detectLanguage('! 0 200 200 320 1\nPRINT')).toBe('cpcl');
    expect(detectLanguage('! UTILITIES\nJOURNAL\nPRINT')).toBe('cpcl');
  });

  it('knows TSPL by the commands only it has', () => {
    expect(detectLanguage('SIZE 60 mm, 40 mm\nCLS\nPRINT 1')).toBe('tspl');
    expect(detectLanguage('BARCODE 10,10,"128",70,1,0,2,4,"x"')).toBe('tspl');
  });

  it('does not read Godex EZPL as ZPL, carets and all', () => {
    // EZPL leads with carets but has no ^XA, and nothing else here is TSPL.
    expect(detectLanguage('^O0\n^D0\n^C1\n^P1\n^Q38.0,3.0\n^W48\n^L\nAB,133,32,1,1,0,0,x\nE')).toBeUndefined();
  });

  it('does not read Honeywell Fingerprint as anything', () => {
    expect(
      detectLanguage('NEW\nCLIP OFF\nNASC 1251\nFONT "Swiss 721 BT", 8\nPRPOS 0,330\nPRTXT "x"\nPRINTFEED'),
    ).toBeUndefined();
  });

  it('says nothing about an empty file or prose', () => {
    expect(detectLanguage('')).toBeUndefined();
    expect(detectLanguage('Здравствуйте, во вложении шаблон.')).toBeUndefined();
  });
});

describe('recognising a project file', () => {
  it('takes JSON with a version', () => {
    expect(isProjectFile('{"version":1,"width":60,"height":40}')).toBe(true);
    expect(isProjectFile('\n  {"version":1}')).toBe(true);
  });

  it('leaves everything else alone', () => {
    expect(isProjectFile('{"width":60}')).toBe(false);
    expect(isProjectFile('^XA^XZ')).toBe(false);
    expect(isProjectFile('{not json')).toBe(false);
  });
});
