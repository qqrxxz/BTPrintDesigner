import type { LabelDocument, LabelElement } from './document.js';

/**
 * Placeholders in element content, written as {{name}}.
 *
 * A placeholder is a design-time question, not a data feature: it lets the
 * preview show a real value so the designer can see whether a long serial
 * still fits between the barcode and the edge. Substitution happens when code
 * is generated, so what reaches the printer is either the resolved value or,
 * deliberately, the placeholder itself.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g;

export function findPlaceholders(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export interface SubstitutionResult {
  readonly text: string;
  /** Placeholders with no value, left in place rather than blanked. */
  readonly missing: readonly string[];
}

/**
 * Replaces placeholders with their values.
 *
 * An unresolved placeholder stays as written. Blanking it would silently shrink
 * the text and hide the very collision the preview exists to reveal.
 */
export function substitute(
  text: string,
  data: Readonly<Record<string, string>> | undefined,
): SubstitutionResult {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = data?.[name];
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return value;
  });
  return { text: out, missing };
}

/** Text an element carries that a placeholder could appear in. */
export function elementText(element: LabelElement): string | undefined {
  if (element.type === 'text') return element.content;
  if (element.type === 'barcode' || element.type === 'matrix') return element.data;
  return undefined;
}

/** Every placeholder used anywhere in the document, in order of appearance. */
export function documentPlaceholders(document: LabelDocument): string[] {
  const names: string[] = [];
  for (const element of document.elements) {
    const text = elementText(element);
    if (text === undefined) continue;
    for (const name of findPlaceholders(text)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}
