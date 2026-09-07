import {
  createDocument,
  DEFAULT_PROFILE_ID,
  findProfile,
  type LabelDocument,
  type LabelElement,
  type PrinterProfile,
  type UnmappedCommand,
} from '@btpd/core';
import type { Language } from './i18n.js';

/**
 * Application state.
 *
 * The document is the source of truth while the canvas is driving. Once the
 * code has been edited into something the canvas cannot hold, `mode` flips to
 * detached and `code` becomes the truth instead — the document is kept only so
 * the element list can still show what was understood.
 */
export interface AppState {
  readonly document: LabelDocument;
  readonly profileId: string;
  readonly language: Language;
  readonly selectedId: string | undefined;
  readonly mode: 'linked' | 'detached';
  /** Hand-edited code; only consulted when detached. */
  readonly code: string;
  readonly unmapped: readonly UnmappedCommand[];
  readonly filePath: string | undefined;
  readonly dirty: boolean;
  readonly zoom: number | 'fit';
}

export type Listener = (state: AppState) => void;

const STORAGE_KEY = 'btpd.preferences';

interface Preferences {
  profileId?: string;
  language?: Language;
}

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Preferences) : {};
  } catch {
    // A private window or blocked storage: the defaults are fine.
    return {};
  }
}

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  /** Document snapshots, for undo. The current document is the last entry. */
  private past: LabelDocument[] = [];
  private future: LabelDocument[] = [];
  /** True while a drag is running, so its changes share one undo step. */
  private gesture = false;

  constructor(document: LabelDocument = createDocument()) {
    const preferences = loadPreferences();
    this.state = {
      document,
      profileId: preferences.profileId ?? DEFAULT_PROFILE_ID,
      language: preferences.language ?? 'ru',
      selectedId: undefined,
      mode: 'linked',
      code: '',
      unmapped: [],
      filePath: undefined,
      dirty: false,
      zoom: 'fit',
    };
  }

  get(): AppState {
    return this.state;
  }

  profile(): PrinterProfile {
    return findProfile(this.state.profileId) ?? findProfile(DEFAULT_PROFILE_ID)!;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }

  /** Replaces state without touching the undo history. */
  patch(changes: Partial<AppState>): void {
    this.state = { ...this.state, ...changes };
    if (changes.profileId !== undefined || changes.language !== undefined) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ profileId: this.state.profileId, language: this.state.language }),
        );
      } catch {
        // Not being able to remember the choice is not worth an error.
      }
    }
    this.emit();
  }

  /**
   * Changes the document and records the previous one for undo.
   *
   * A gesture — dragging an element across the label — arrives as a stream of
   * small changes, and undo should step over the whole drag rather than a
   * hundred pixels of it. Pass `gesture: true` for every change but the first,
   * and call `endGesture` when the pointer goes up.
   */
  edit(
    change: (document: LabelDocument) => LabelDocument,
    options: { gesture?: boolean } = {},
  ): void {
    const continuing = options.gesture === true && this.gesture;
    this.gesture = options.gesture === true;
    if (!continuing) {
      this.past.push(this.state.document);
      if (this.past.length > 100) this.past.shift();
    }
    this.future = [];
    this.state = {
      ...this.state,
      document: change(this.state.document),
      mode: 'linked',
      dirty: true,
    };
    this.emit();
  }

  /** Adopts a document wholesale, as opening a file or importing code does. */
  adopt(
    document: LabelDocument,
    options: {
      mode?: 'linked' | 'detached';
      code?: string;
      unmapped?: readonly UnmappedCommand[];
      filePath?: string;
      dirty?: boolean;
      resetHistory?: boolean;
    } = {},
  ): void {
    if (options.resetHistory) {
      this.past = [];
      this.future = [];
    } else {
      this.past.push(this.state.document);
    }
    this.state = {
      ...this.state,
      document,
      mode: options.mode ?? 'linked',
      code: options.code ?? '',
      unmapped: options.unmapped ?? [],
      selectedId: undefined,
      dirty: options.dirty ?? true,
      filePath: options.filePath ?? this.state.filePath,
    };
    this.emit();
  }

  /** Ends a gesture, so the next change starts a new undo step. */
  endGesture(): void {
    this.gesture = false;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.state.document);
    this.state = { ...this.state, document: previous, mode: 'linked', dirty: true };
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state.document);
    this.state = { ...this.state, document: next, mode: 'linked', dirty: true };
    this.emit();
  }

  select(id: string | undefined): void {
    this.state = { ...this.state, selectedId: id };
    this.emit();
  }

  selected(): LabelElement | undefined {
    return this.state.document.elements.find(
      (element) => element.id === this.state.selectedId,
    );
  }
}

/** A unique element id within a document, stable enough to read in the code. */
export function nextElementId(document: LabelDocument, prefix: string): string {
  let index = 1;
  const taken = new Set(document.elements.map((element) => element.id));
  while (taken.has(`${prefix}${index}`)) index++;
  return `${prefix}${index}`;
}

export function replaceElement(
  document: LabelDocument,
  id: string,
  change: (element: LabelElement) => LabelElement,
): LabelDocument {
  return {
    ...document,
    elements: document.elements.map((element) => (element.id === id ? change(element) : element)),
  };
}
