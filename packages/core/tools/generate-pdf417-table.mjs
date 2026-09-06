/**
 * Generates src/barcode/pdf417/patterns.ts.
 *
 * The PDF417 codeword patterns are a table in ISO/IEC 15438: 929 codewords in
 * each of three clusters, each a seventeen-module bar and space sequence. The
 * order is not derivable — it is not a sort of the bit patterns, and the
 * cluster is not a simple function of the element widths — so the table has to
 * exist as data.
 *
 * Rather than transcribe 2787 numbers by hand, this script reads them out of
 * the tables in @zxing/library, already a development dependency, which carries
 * the same standard's data for its decoder. The generated file is verified by
 * decoding: every symbol this project produces is read back by an independent
 * decoder in the tests, which no wrong pattern would survive.
 *
 *   node tools/generate-pdf417-table.mjs
 */
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const module_ = require_('@zxing/library/cjs/core/pdf417/PDF417Common.js');
const common = module_.default ?? module_;

const symbols = Array.from(common.SYMBOL_TABLE);
const codewords = Array.from(common.CODEWORD_TABLE);
if (symbols.length !== 2787 || codewords.length !== 2787) {
  throw new Error(`expected 2787 entries, found ${symbols.length}/${codewords.length}`);
}

const CLUSTERS = 3;
const CODEWORDS = 929;
const table = Array.from({ length: CLUSTERS }, () => new Array(CODEWORDS).fill(-1));

for (let i = 0; i < symbols.length; i++) {
  const value = codewords[i] - 1;
  const cluster = Math.floor(value / CODEWORDS);
  const codeword = value % CODEWORDS;
  if (table[cluster][codeword] !== -1) {
    throw new Error(`duplicate entry for cluster ${cluster} codeword ${codeword}`);
  }
  table[cluster][codeword] = symbols[i];
}

for (let cluster = 0; cluster < CLUSTERS; cluster++) {
  const missing = table[cluster].findIndex((value) => value === -1);
  if (missing !== -1) throw new Error(`cluster ${cluster} is missing codeword ${missing}`);
  for (const value of table[cluster]) {
    if (value < 0x10000 || value > 0x1ffff) {
      throw new Error(`cluster ${cluster} holds ${value}, which is not a 17-module pattern`);
    }
  }
}

const rows = table
  .map((cluster, index) => {
    const lines = [];
    for (let i = 0; i < cluster.length; i += 8) {
      lines.push(`    ${cluster.slice(i, i + 8).join(', ')},`);
    }
    return `  // Cluster ${index * 3}\n  [\n${lines.join('\n')}\n  ],`;
  })
  .join('\n');

const source = `/**
 * PDF417 codeword patterns (ISO/IEC 15438), one row per cluster.
 *
 * Each value is a seventeen-module pattern as a bit field, most significant bit
 * leftmost, always starting with a bar and ending with a space. Row 0 is
 * cluster 0, row 1 cluster 3, row 2 cluster 6; a symbol row uses the cluster
 * for its row number modulo three.
 *
 * GENERATED FILE — do not edit. Produced by tools/generate-pdf417-table.mjs,
 * which extracts the standard's table from the copy in @zxing/library. The
 * table is not derivable by rule, and every symbol built from it is verified by
 * round-trip decoding in the tests.
 */

export const CODEWORD_PATTERNS: readonly (readonly number[])[] = [
${rows}
];

/** Modules per codeword: four bars and four spaces. */
export const MODULES_PER_CODEWORD = 17;

/** Leading pattern of every row, 17 modules. */
export const START_PATTERN = 0b11111111010101000;

/** Trailing pattern of every row, 18 modules. */
export const STOP_PATTERN = 0b111111101000101001;
`;

const out = fileURLToPath(new URL('../src/barcode/pdf417/patterns.ts', import.meta.url));
writeFileSync(out, source);
console.log(`wrote ${out}: ${CLUSTERS} clusters of ${CODEWORDS} patterns`);
