/**
 * Fetches reference renderings from Labelary.
 *
 * Labelary is the only independent ZPL renderer available, and it is the reason
 * ZPL can be held to a stricter standard than TSPL: for a label with no text on
 * it, our output has to match theirs dot for dot. The images are fetched once
 * and committed, so the tests neither need the network nor drift when the
 * service changes.
 *
 *   node tools/fetch-labelary.mjs [id ...]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const config = JSON.parse(readFileSync(here('../test/golden/samples.json'), 'utf8'));
const only = process.argv.slice(2);

const { width, height } = config.size;
const endpoint = `http://api.labelary.com/v1/printers/8dpmm/labels/${width}x${height}/0/`;

mkdirSync(here('../test/golden'), { recursive: true });

for (const sample of config.samples) {
  if (only.length > 0 && !only.includes(sample.id)) continue;

  const response = await fetch(endpoint, {
    method: 'POST',
    // Labelary refuses the text/plain content type fetch would otherwise send.
    headers: { Accept: 'image/png', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: sample.zpl,
  });
  if (!response.ok) {
    console.error(`${sample.id}: ${response.status} ${await response.text()}`);
    continue;
  }
  const png = new Uint8Array(await response.arrayBuffer());
  writeFileSync(here(`../test/golden/${sample.id}.png`), png);
  console.log(`${sample.id}: ${png.length} bytes`);

  // Labelary asks for no more than five requests a second.
  await new Promise((resolve) => setTimeout(resolve, 250));
}
