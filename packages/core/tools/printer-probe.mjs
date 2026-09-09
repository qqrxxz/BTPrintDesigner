/**
 * Three labels that ask the printer four questions.
 *
 * Every one of them came out of a scan of the font sample, where the Cyrillic
 * printed as question marks and the first row of every grid was missing
 * altogether. Both are things this program has been assuming rather than
 * knowing, and a printer is the only place to find out.
 *
 *   1. Does CODEPAGE have to come after CLS? The vendor's own templates put it
 *      there; this program puts it before, and CLS may well reset it.
 *   2. Do the resident fonts have Cyrillic at all, in either order?
 *   3. How is a double quote written inside a string? The sample's `\"` broke
 *      the whole command, so the escape this program emits is not the one the
 *      firmware reads. `CHR$(34)` is the other candidate — the firmware runs
 *      BASIC, which is why every vendor template carries an `OUT A$`.
 *   4. Is a backslash literal? The sample printed `\\` as two of them, so it
 *      looks that way, and this program doubles them on the way out.
 *
 *   node tools/printer-probe.mjs [directory]
 */
import { writeFileSync } from 'node:fs';

const LABEL = { width: 58, height: 60 };
const RUSSIAN = 'Привет руб 0123';

/** Windows-1251 as a character to byte map, from the platform's own decoder. */
const decoder = new TextDecoder('windows-1251');
const table = new Map();
for (let byte = 0; byte < 256; byte++) {
  const character = decoder.decode(new Uint8Array([byte]));
  if (character !== '�' && !table.has(character)) table.set(character, byte);
}

function bytes(text) {
  return [...text].map((character) => table.get(character) ?? 0x3f);
}

const parts = [];
function line(text) {
  parts.push(bytes(`${text}\n`));
}

function header(codepageFirst) {
  line(`SIZE ${LABEL.width} mm, ${LABEL.height} mm`);
  line('GAP 2 mm, 0 mm');
  line('DIRECTION 0');
  if (codepageFirst) line('CODEPAGE 1251');
  line('CLS');
  if (!codepageFirst) line('CODEPAGE 1251');
}

// --- A and B: the same Cyrillic, with CODEPAGE on either side of CLS --------

for (const [name, codepageFirst] of [
  ['A CODEPAGE BEFORE CLS', true],
  ['B CODEPAGE AFTER CLS', false],
]) {
  header(codepageFirst);
  line(`TEXT 24,16,"2",0,1,1,1,"${name}"`);
  line(`TEXT 24,56,"1",0,1,1,1,"F1 ${RUSSIAN}"`);
  line(`TEXT 24,88,"2",0,1,1,1,"F2 ${RUSSIAN}"`);
  line(`TEXT 24,128,"3",0,1,1,1,"F3 ${RUSSIAN}"`);
  // The same words through the scalable font, which has its own path through
  // the firmware and may know characters the bitmap cells do not.
  line(`TEXT 24,176,"0",0,24,24,1,"F0 ${RUSSIAN}"`);
  line('PRINT 1,1');
}

// --- C: how a quote and a backslash have to be written ----------------------

header(false);
line('TEXT 24,16,"2",0,1,1,1,"C QUOTE AND BACKSLASH"');
// Each line prints its own name, so a line that never arrives is obvious.
line('TEXT 24,56,"2",0,1,1,1,"Q1 A" + CHR$(34) + "B"');
line('TEXT 24,88,"2",0,1,1,1,"Q2 C\\"D"');
line('TEXT 24,120,"2",0,1,1,1,"Q3 E\\\\F"');
line('TEXT 24,152,"2",0,1,1,1,"Q4 G\\H"');
line('TEXT 24,184,"2",0,1,1,1,"Q5 LAST LINE PRINTED"');
line('PRINT 1,1');

const total = parts.reduce((sum, part) => sum + part.length, 0);
const file = new Uint8Array(total);
let at = 0;
for (const part of parts) {
  file.set(part, at);
  at += part.length;
}

const directory = process.argv[2] ?? '.';
const target = `${directory}/printer-probe-${LABEL.width}x${LABEL.height}.prn`;
writeFileSync(target, file);
console.error(`wrote ${target} (${file.length} bytes, 3 labels)`);
