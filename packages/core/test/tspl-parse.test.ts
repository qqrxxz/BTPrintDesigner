import { describe, expect, it } from 'vitest';
import { parseTspl } from '../src/tspl/parse.js';

describe('TSPL parsing', () => {
  it('upper-cases command names, as a printer does', () => {
    const { commands } = parseTspl('text 10,10,"3",0,1,1,"hi"');
    expect(commands[0]!.name).toBe('TEXT');
  });

  it('keeps commas inside quoted content', () => {
    const { commands } = parseTspl('TEXT 10,10,"3",0,1,1,"Kabel, 2 m, black"');
    const content = commands[0]!.arguments.at(-1)!;
    expect(content).toMatchObject({ kind: 'string', value: 'Kabel, 2 m, black' });
  });

  it('unescapes quotes and backslashes but leaves other backslashes alone', () => {
    const { commands } = parseTspl(String.raw`TEXT 0,0,"3",0,1,1,"a\"b\\c\d"`);
    expect(commands[0]!.arguments.at(-1)!.value).toBe(String.raw`a"b\c\d`);
  });

  it('reads a unit suffix where the source spells one', () => {
    const { commands } = parseTspl('SIZE 60 mm, 40 mm');
    expect(commands[0]!.arguments[0]).toMatchObject({ kind: 'number', value: 60, unit: 'mm' });
    expect(commands[0]!.arguments[1]).toMatchObject({ kind: 'number', value: 40, unit: 'mm' });
  });

  it('leaves the unit unset when the source omits it', () => {
    const { commands } = parseTspl('SIZE 4,3');
    expect(commands[0]!.arguments[0]).toMatchObject({ kind: 'number', value: 4 });
    expect(commands[0]!.arguments[0]).not.toHaveProperty('unit');
  });

  it('classifies bare words, which QR and PDF417 options use', () => {
    const { commands } = parseTspl('QRCODE 10,10,M,4,A,0,"x"');
    expect(commands[0]!.arguments[2]).toMatchObject({ kind: 'word', value: 'M' });
    expect(commands[0]!.arguments[4]).toMatchObject({ kind: 'word', value: 'A' });
  });

  it('accepts negative and fractional numbers', () => {
    const { commands } = parseTspl('REFERENCE -12,3.5');
    expect(commands[0]!.arguments.map((argument) => argument.value)).toEqual([-12, 3.5]);
  });

  it('skips blank lines and both comment spellings', () => {
    const source = ['// a comment', '', 'REM another', 'CLS', '  ', 'PRINT 1'].join('\n');
    const { commands } = parseTspl(source);
    expect(commands.map((command) => command.name)).toEqual(['CLS', 'PRINT']);
  });

  it('records where each command starts', () => {
    const { commands } = parseTspl('CLS\n  BAR 1,2,3,4');
    expect(commands[1]!.span).toMatchObject({ line: 2, column: 3 });
  });

  it('records where each argument starts', () => {
    const { commands } = parseTspl('BAR 10,20,30,40');
    expect(commands[0]!.arguments[1]!.span).toMatchObject({ line: 1, column: 8 });
  });

  it('keeps the original line, for code the model cannot hold', () => {
    const { commands } = parseTspl('  SET TEAR ON  ');
    expect(commands[0]!.source).toBe('SET TEAR ON');
  });

  it('reports an unterminated string and keeps what it read', () => {
    const { commands, diagnostics } = parseTspl('TEXT 0,0,"3",0,1,1,"unfinished');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', line: 1 });
    expect(commands[0]!.arguments.at(-1)!.value).toBe('unfinished');
  });

  it('reports a line that does not start with a command name', () => {
    const { diagnostics } = parseTspl('CLS\n123,456');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', line: 2 });
  });

  it('carries on after a bad line', () => {
    const { commands } = parseTspl('!!!\nCLS\nPRINT 1');
    expect(commands.map((command) => command.name)).toEqual(['CLS', 'PRINT']);
  });

  it('handles all three line endings', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const { commands } = parseTspl(`CLS${ending}PRINT 1`);
      expect(commands).toHaveLength(2);
    }
  });

  it('accepts a command with no arguments', () => {
    const { commands, diagnostics } = parseTspl('CLS');
    expect(commands[0]!.arguments).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });
});
