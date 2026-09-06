import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Font } from '../../src/text/Font.js';

const cache = new Map<string, Font>();

/** Loads one of the substitute faces bundled with the package. */
export function loadTestFont(fileName: string): Font {
  const cached = cache.get(fileName);
  if (cached) return cached;
  const path = fileURLToPath(new URL(`../../assets/fonts/${fileName}`, import.meta.url));
  const font = Font.fromBuffer(readFileSync(path));
  cache.set(fileName, font);
  return font;
}

export const monoFont = (): Font => loadTestFont('DejaVuSansMono.ttf');
export const condensedBoldFont = (): Font => loadTestFont('DejaVuSansCondensed-Bold.ttf');
