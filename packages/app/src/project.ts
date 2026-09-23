/**
 * What goes into a project file, and what comes back out of one.
 *
 * Kept apart from the window so that it can be tested without one: this is
 * the code that decides whether a person's work survives being saved.
 */
import type { LabelDocument } from '@btpd/core';
import type { AppState } from './state.js';

/**
 * The document a save writes.
 *
 * While the code is in charge the elements are only what could be read out of
 * it, and writing them alone threw away every line typed by hand — while the
 * title bar said the work was saved. The code goes into the file with them, so
 * it comes back in charge when the file is opened.
 */
export function documentToSave(state: Pick<AppState, 'document' | 'mode' | 'code'>): LabelDocument {
  const { code: _stale, ...design } = state.document;
  return state.mode === 'detached' && state.code.trim() !== ''
    ? { ...design, code: state.code }
    : design;
}

/**
 * The design a reopened project's code should be shown with.
 *
 * The code says where things are; the saved project remembers what the code
 * cannot say for itself — the operation, the encoding, the sample values —
 * and the name it was given.
 */
export function reopenedDesign(
  fromCode: LabelDocument,
  saved: LabelDocument | undefined,
  fallbackName: string,
): LabelDocument {
  return {
    ...fromCode,
    name: saved?.name ?? fallbackName,
    ...(saved?.operation === undefined ? {} : { operation: saved.operation }),
    ...(saved?.encoding === undefined ? {} : { encoding: saved.encoding }),
    ...(saved?.sampleData === undefined ? {} : { sampleData: saved.sampleData }),
    ...(saved?.variableSamples === undefined ? {} : { variableSamples: saved.variableSamples }),
  };
}
