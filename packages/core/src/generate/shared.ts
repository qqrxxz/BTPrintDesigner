import { findVariable, operationName, type DataMobileOperation } from '../datamobile/variables.js';
import type { LabelDocument, LabelElement } from '../model/document.js';
import { collectVariables, substitute, substituteVariables } from '../model/placeholders.js';

/**
 * What every generator does to a piece of text before it emits it.
 *
 * Two different things can stand in for a value, and they are resolved at
 * different times. `{{name}}` is this program's own placeholder and is filled
 * in here from the document's sample data. `@Barcode@` belongs to DataMobile
 * and must reach the exported file untouched, because DataMobile is what fills
 * it in — except when generating for the preview, where it is replaced by a
 * sample so the label can be judged at a realistic width.
 */

export interface GenerationIssue {
  readonly severity: 'error' | 'warning';
  /** English wording; a caller translates by `code` and falls back to this. */
  readonly message: string;
  readonly code?: string;
  readonly values?: Readonly<Record<string, string | number>>;
  readonly elementId?: string;
}

export interface TextResolution {
  /** What the generator emits: the template, or the preview's filled-in form. */
  readonly text: string;
  /**
   * The same text with every variable filled in, whatever the mode.
   *
   * Some commands bake a symbol's size into themselves, and the size depends on
   * the value rather than on the variable's name. Measuring `@Barcode@` would
   * declare a box for nine characters where thirteen digits are coming.
   */
  readonly sized: string;
  /** True when a variable stands where a value will be. */
  readonly hasVariables: boolean;
  readonly issues: readonly GenerationIssue[];
}

export interface ResolveOptions {
  readonly data?: Readonly<Record<string, string>>;
  /**
   * Replaces DataMobile variables with sample values. On for the preview, off
   * for the file that goes to DataMobile.
   */
  readonly resolveVariables?: boolean;
}

export function resolveText(
  text: string,
  element: LabelElement,
  document: LabelDocument,
  options: ResolveOptions,
): TextResolution {
  const issues: GenerationIssue[] = [];

  const substituted = substitute(text, options.data ?? document.sampleData);
  for (const name of substituted.missing) {
    issues.push({
      severity: 'warning',
      elementId: element.id,
      code: 'generate.placeholder-missing',
      values: { name },
      message: `No value for placeholder {{${name}}}; it is printed as written.`,
    });
  }

  const operation: DataMobileOperation | undefined = document.operation;
  for (const use of collectVariables(substituted.text)) {
    const entry = findVariable(use.name);
    if (!entry) {
      issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.variable-unknown',
        values: { name: use.name },
        message:
          `DataMobile has no variable called ${use.name}; it will print as written. ` +
          'Check the spelling, including its capitals.',
      });
      continue;
    }
    if (operation !== undefined && operation !== 'all' && !entry.operations.includes(operation)) {
      issues.push({
        severity: 'warning',
        elementId: element.id,
        code: 'generate.variable-unavailable',
        values: { name: use.name, operation },
        message:
          `${use.name} is not offered on a "${operationName(operation)}" template, so ` +
          'DataMobile will leave it as written.',
      });
    }
  }

  const filled = substituteVariables(substituted.text, document.variableSamples);
  return {
    text: options.resolveVariables ? filled : substituted.text,
    sized: filled,
    hasVariables: filled !== substituted.text,
    issues,
  };
}

/**
 * The quantity a print command writes, and whether it could be written.
 *
 * A variable goes out as written, because DataMobile is what fills it. The
 * preview is the exception: the interpreter wants a count, so it gets the
 * variable's sample, or one when the sample is not a count. Anything that is
 * neither a whole number nor a single variable cannot be sent to a printer
 * and comes back as one, with `valid` false so the caller can say so.
 */
export function quantityOf(
  document: LabelDocument,
  options: { readonly copies?: number; readonly resolveVariables?: boolean },
): { readonly value: string; readonly valid: boolean } {
  if (options.copies !== undefined) {
    return { value: String(Math.max(1, Math.round(options.copies))), valid: true };
  }
  const written = document.quantity?.trim();
  if (written === undefined || written === '') return { value: '1', valid: true };

  const count = /^[1-9]\d*$/.test(written);
  const variable = /^@[A-Za-z][A-Za-z0-9_%.-]*@$/.test(written);
  if (!count && !variable) return { value: '1', valid: false };
  if (!options.resolveVariables || count) return { value: written, valid: true };

  const filled = substituteVariables(written, document.variableSamples).trim();
  return { value: /^[1-9]\d*$/.test(filled) ? filled : '1', valid: true };
}

/**
 * Where a justified line is anchored, in millimetres.
 *
 * Usually that is `x` itself. A line justified to the page edge — CPCL's bare
 * CENTER — keeps the left end of its span in `x`, and its anchor is worked
 * out against the label's width for the languages that anchor instead.
 */
export function anchorX(
  element: { readonly x: number; readonly align?: string; readonly alignSpan?: 'to-edge' },
  labelWidth: number,
): number {
  if (element.alignSpan !== 'to-edge') return element.x;
  if (element.align === 'center') return element.x + (labelWidth - element.x) / 2;
  if (element.align === 'right') return labelWidth;
  return element.x;
}
