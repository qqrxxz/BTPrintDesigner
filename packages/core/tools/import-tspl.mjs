/**
 * Reads a TSPL file back into a document and reports whether the canvas can
 * safely drive it.
 *
 *   node tools/import-tspl.mjs label.tspl
 *
 * With no argument it reads out/model-203dpi.tspl, which the model tool writes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateTspl, importTspl, serializeDocument } from '../dist/index.js';

const fallback = fileURLToPath(new URL('../out/model-203dpi.tspl', import.meta.url));
const path = process.argv[2] ?? fallback;
const source = readFileSync(path, 'utf8');

const result = importTspl(source, { name: path.split('/').at(-1) });

console.log(`${path}: ${result.mode}`);
console.log(
  `${result.document.elements.length} element(s), ${result.copies} cop${result.copies === 1 ? 'y' : 'ies'}`,
);

for (const diagnostic of result.diagnostics) {
  console.log(`  ${diagnostic.severity} line ${diagnostic.line}: ${diagnostic.message}`);
}
for (const entry of result.unmapped) {
  console.log(`  detaches at line ${entry.line}: ${entry.source}`);
  console.log(`    ${entry.reason}`);
}

if (result.mode === 'linked') {
  const regenerated = generateTspl(result.document, { copies: result.copies });
  const same = regenerated.source.trim() === source.trim();
  console.log(`regenerated code is ${same ? 'identical' : 'equivalent but not identical'}`);
  if (!same) console.log(regenerated.source);
} else {
  console.log('The code stays the source of truth; the canvas would lose the lines above.');
}

if (process.argv.includes('--json')) console.log(serializeDocument(result.document));
