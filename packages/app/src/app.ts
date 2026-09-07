import {
  checkLabelWidth,
  createDocument,
  DATAMOBILE_GROUPS,
  DATAMOBILE_OPERATIONS,
  defaultContent,
  documentPlaceholders,
  documentVariables,
  exampleFor,
  findVariable,
  isAvailable,
  encodePng,
  parseDocument,
  PRINTER_PROFILES,
  GS1_SEPARATORS,
  PRESET_GROUPS,
  presetsOf,
  serializeDocument,
  substituteVariables,
  variablesFor,
  type BarcodeElement,
  type DataMobileOperation,
  type LabelDocument,
  type LabelElement,
  type MatrixElement,
  type Preset,
  type RectangleElement,
  type TextElement,
  type TsplFontSet,
} from '@btpd/core';
import { button, checkbox, clear, field, h, numberInput, select, textInput } from './dom.js';
import { LANGUAGES, strings, type Language, type Strings } from './i18n.js';
import { translate } from './messages.js';
import {
  FILE_EXTENSIONS,
  generateFor,
  importFor,
  languageOf,
  loadFonts,
  paint,
  renderFor,
} from './pipeline.js';
import { nextElementId, replaceElement, Store } from './state.js';

/** The bridge the preload script installs. */
interface BtpdApi {
  openProject(): Promise<{ path: string; content: string } | undefined>;
  saveProject(request: {
    path?: string;
    content: string;
    suggestedName: string;
  }): Promise<string | undefined>;
  exportFile(request: {
    suggestedName: string;
    content: string | Uint8Array;
    extensions: string[];
  }): Promise<string | undefined>;
  askSave(request: {
    message: string;
    detail: string;
    save: string;
    discard: string;
    cancel: string;
  }): Promise<'save' | 'discard' | 'cancel'>;
  setTitle(title: string): Promise<void>;
  onMenu(handler: (action: string) => void): void;
}

declare global {
  interface Window {
    btpd?: BtpdApi;
  }
}

/** Everything the current state implies, recomputed on every render. */
interface Derived {
  readonly code: string;
  readonly origins: Readonly<Record<string, number>>;
  readonly bitmap: ReturnType<typeof renderFor>['bitmap'];
  readonly bounds: ReturnType<typeof renderFor>['bounds'];
  readonly problems: readonly { severity: string; where: string; message: string }[];
}

export class App {
  private readonly store = new Store(starterDocument());
  private readonly root: HTMLElement;
  private fonts: TsplFontSet | undefined;

  private canvas = h('canvas', { class: 'label-canvas' });
  private overlay = h('div', { class: 'label-overlay' });
  private stage = h('div', { class: 'stage' });
  private codeArea = h('textarea', { class: 'code-area', spellcheck: 'false' });
  /** True while the code panel has focus, so a render does not fight the caret. */
  private editingCode = false;
  /**
   * Which sections the reader has opened or closed.
   *
   * The panels are rebuilt on every change, so without this the sections would
   * snap back to their defaults the moment anything moved.
   */
  private readonly sectionOpen = new Map<string, boolean>();

  constructor(root: HTMLElement) {
    this.root = root;
    // The code area outlives every render, so it is wired up once. Attaching
    // these inside the panel builder would add another pair of handlers on
    // every redraw.
    this.codeArea.addEventListener('focus', () => {
      this.editingCode = true;
    });
    this.codeArea.addEventListener('blur', () => {
      this.editingCode = false;
    });
    this.codeArea.addEventListener('input', () => this.codeChanged());
    this.store.subscribe(() => this.render());
    window.btpd?.onMenu((action) => void this.menu(action));
    window.addEventListener('keydown', (event) => this.keyboard(event));
  }

  async start(): Promise<void> {
    this.fonts = await loadFonts();
    this.render();
  }

  private text(): Strings {
    return strings(this.store.get().language);
  }

  // --- derivation ---------------------------------------------------------

  /**
   * Produces the code, the image and the element outlines from state.
   *
   * The picture always comes from the code, never straight from the document.
   * When the code is the generator's own output the generator says which line
   * each element went to; when it has been edited by hand the importer says it
   * instead. Either way the outlines belong to the text on screen.
   */
  private derive(): Derived {
    const state = this.store.get();
    const profile = this.store.profile();
    const fonts = this.fonts!;

    const size = { widthMm: state.document.width, heightMm: state.document.height };
    const generated = generateFor(profile, state.document);
    const usesGenerated = state.code === '' || state.code === generated.source;
    const code = usesGenerated ? generated.source : state.code;

    // The picture comes from a copy with the DataMobile variables filled in.
    // The file itself must keep saying `@Barcode@` — DataMobile is what
    // substitutes it — but nine characters of `@Barcode@` would be judged as
    // fitting where a thirteen digit barcode does not.
    const shown = usesGenerated
      ? generateFor(profile, state.document, true).source
      : substituteVariables(code, state.document.variableSamples);
    const rendered = renderFor(profile, shown, fonts, size);
    let origins: Record<string, number> = { ...generated.origins };
    if (!usesGenerated) {
      origins = {};
      for (const [id, span] of Object.entries(importFor(profile, code).origins)) {
        origins[id] = span.line;
      }
    }

    const strings_ = this.text();
    const language = state.language;
    const problems: { severity: string; where: string; message: string }[] = [];
    if (usesGenerated) {
      for (const issue of generated.issues) {
        problems.push({
          severity: issue.severity,
          where: issue.elementId ?? '',
          message: translate(language, issue.message, issue.code, issue.values),
        });
      }
    }
    for (const diagnostic of rendered.diagnostics) {
      problems.push({
        severity: diagnostic.severity,
        where: `${strings_.line} ${diagnostic.line}`,
        message: translate(language, diagnostic.message, diagnostic.code, diagnostic.values),
      });
    }
    const width = checkLabelWidth(profile, state.document.width);
    if (!width.fits) {
      problems.push({
        severity: 'warning',
        where: profile.model,
        message: `${strings_.tooWide} ${width.overflowMm} mm`,
      });
    }

    return {
      code,
      origins,
      bitmap: rendered.bitmap,
      bounds: rendered.bounds,
      problems,
    };
  }

  // --- rendering ----------------------------------------------------------

  private render(): void {
    if (!this.fonts) return;
    const state = this.store.get();
    const text = this.text();
    const derived = this.derive();

    document.documentElement.lang = state.language;
    const name = state.document.name || text.label;
    void window.btpd?.setTitle(`${name}${state.dirty ? ` — ${text.unsaved}` : ''}`);

    // Every keystroke in the code panel regenerates the document, and the
    // panels are rebuilt wholesale — which takes the code area out of the page
    // and the focus with it. Without this the field would take one character
    // and then quietly stop being the focus.
    const editing = this.editingCode || document.activeElement === this.codeArea;
    const caret = { start: this.codeArea.selectionStart, end: this.codeArea.selectionEnd };
    const scroll = this.codeArea.scrollTop;
    // The side panels are scrolled containers that get thrown away and built
    // again, so without this every click would jump the reader back to the top.
    const panelScroll = new Map<string, number>();
    for (const panel of this.root.querySelectorAll('.panel')) {
      panelScroll.set(panel.className, panel.scrollTop);
    }

    clear(this.root);
    this.root.append(
      this.toolbar(text),
      h(
        'div',
        { class: 'workspace' },
        this.leftPanel(text, derived),
        this.centre(text, derived),
        this.rightPanel(text, derived),
      ),
    );

    for (const panel of this.root.querySelectorAll('.panel')) {
      const was = panelScroll.get(panel.className);
      if (was !== undefined) panel.scrollTop = was;
    }

    paint(this.canvas, derived.bitmap);
    this.placeOverlays(derived);
    if (editing) {
      this.editingCode = true;
      this.codeArea.focus({ preventScroll: true });
      this.codeArea.setSelectionRange(caret.start, caret.end);
      this.codeArea.scrollTop = scroll;
    } else {
      this.codeArea.value = derived.code;
    }
  }

  private toolbar(text: Strings): HTMLElement {
    const state = this.store.get();
    return h(
      'header',
      { class: 'toolbar' },
      h('strong', { class: 'brand' }, text.appName),
      h(
        'div',
        { class: 'group' },
        button(text.newLabel, () => void this.newLabel()),
        button(text.open, () => void this.open()),
        button(text.save, () => void this.save(false)),
        button(text.exportCode, () => void this.exportCode()),
        button(text.exportPng, () => void this.exportPng()),
      ),
      h(
        'div',
        { class: 'group grow' },
        h('span', { class: 'group-label' }, text.printer),
        select(
          state.profileId,
          PRINTER_PROFILES.map((profile) => ({
            value: profile.id,
            label: `${profile.vendor} ${profile.model} — ${profile.dpi} dpi`,
          })),
          (value) => this.store.patch({ profileId: value }),
        ),
        h('span', { class: 'group-label' }, text.language),
        select(
          state.language,
          LANGUAGES.map((code) => ({ value: code, label: code === 'ru' ? 'Русский' : 'English' })),
          (value: Language) => this.store.patch({ language: value }),
        ),
      ),
    );
  }

  /** A collapsible section, which remembers whether it was left open. */
  private section(
    id: string,
    title: string,
    body: HTMLElement,
    defaultOpen: boolean,
    badge?: string,
  ): HTMLElement {
    const box = h('details', { class: 'section', open: this.sectionOpen.get(id) ?? defaultOpen });
    box.append(
      h(
        'summary',
        {},
        h('span', { class: 'section-title' }, title),
        badge === undefined ? undefined : h('span', { class: 'badge' }, badge),
      ),
      body,
    );
    box.addEventListener('toggle', () => this.sectionOpen.set(id, box.open));
    return box;
  }

  /**
   * The things that can be put on a label, by kind.
   *
   * Each entry arrives configured — a Code 128 on a product template already
   * says `@Barcode@` — so adding one is a single click rather than a click and
   * then four fields.
   */
  private addPanel(text: Strings): HTMLElement {
    const russian = this.store.get().language === 'ru';
    const box = h('div', { class: 'add-groups' });
    for (const group of PRESET_GROUPS) {
      const row = h('div', { class: 'preset-row' });
      for (const preset of presetsOf(group.id)) {
        row.append(
          button(russian ? preset.ru : preset.en, () => this.addPreset(preset), {
            class: 'preset',
          }),
        );
      }
      box.append(
        this.section(`add:${group.id}`, russian ? group.ru : group.en, row, group.id === 'text'),
      );
    }
    return box;
  }

  private elementList(text: Strings): HTMLElement {
    const state = this.store.get();
    const list = h('div', { class: 'element-list' });
    if (state.document.elements.length === 0) {
      list.append(h('p', { class: 'empty' }, text.noElements));
      return list;
    }
    for (const element of state.document.elements) {
      const row = h(
        'button',
        {
          type: 'button',
          class: `element-row${element.id === state.selectedId ? ' selected' : ''}`,
        },
        h('span', { class: 'element-kind' }, elementLabel(element, text)),
        h('span', { class: 'element-name' }, describeElement(element)),
      );
      row.addEventListener('click', () => this.store.select(element.id));
      list.append(row);
    }
    return list;
  }

  private leftPanel(text: Strings, derived: Derived): HTMLElement {
    const problems = derived.problems.length;
    return h(
      'aside',
      { class: 'panel left' },
      h('h2', {}, text.add),
      this.addPanel(text),
      this.section('elements', text.elements, this.elementList(text), true),
      this.section('properties', text.properties, this.elementProperties(text), true),
      this.section('label', text.label, this.labelProperties(text), false),
      this.section('values', text.values, this.valuesSection(text), false),
      // Problems never fold away: a warning nobody can see is a warning nobody
      // acts on, and this is the panel that says the label will print wrong.
      h(
        'div',
        { class: 'section open' },
        h(
          'div',
          { class: 'section-head' },
          h('span', { class: 'section-title' }, text.problems),
          problems === 0 ? undefined : h('span', { class: 'badge' }, String(problems)),
        ),
        this.problems(text, derived),
      ),
    );
  }

  private centre(text: Strings, derived: Derived): HTMLElement {
    const state = this.store.get();
    clear(this.stage);
    this.overlay.title = text.dragHint;
    this.stage.append(h('div', { class: 'label-frame' }, this.canvas, this.overlay));
    this.stage.onpointerdown = (event) => {
      const target = event.target as HTMLElement;
      if (target === this.stage || target.classList.contains('label-frame')) {
        this.store.select(undefined);
      }
    };

    const zoom = select(
      String(state.zoom),
      [
        { value: 'fit', label: text.fit },
        { value: '1', label: '100%' },
        { value: '2', label: '200%' },
        { value: '3', label: '300%' },
        { value: '4', label: '400%' },
      ],
      (value) => this.store.patch({ zoom: value === 'fit' ? 'fit' : Number(value) }),
    );

    return h(
      'section',
      { class: 'panel centre' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, text.preview),
        h(
          'span',
          { class: 'dimensions' },
          `${state.document.width} × ${state.document.height} mm · ${derived.bitmap.width} × ${derived.bitmap.height} dots`,
        ),
        h('span', { class: 'group-label' }, text.zoom),
        zoom,
      ),
      state.mode === 'detached' ? this.detachedBanner(text) : h('div', { class: 'spacer' }),
      this.stage,
    );
  }

  private detachedBanner(text: Strings): HTMLElement {
    const state = this.store.get();
    const language = languageOf(this.store.profile());
    const list = h('ul', { class: 'unmapped' });
    for (const entry of state.unmapped) {
      // Saying what is wrong and stopping there leaves the reader where they
      // were. If the command is one this program writes, show the line it
      // writes: that is a template to copy rather than a rule to guess at.
      const example = exampleFor(language, entry.source);
      list.append(
        h(
          'li',
          {},
          h('code', {}, `${text.line} ${entry.line}: ${entry.source}`),
          h('span', {}, translate(state.language, entry.reason, entry.code, entry.values)),
          example === undefined ? undefined : h('span', { class: 'muted' }, text.howItIsWritten),
          example === undefined ? undefined : h('code', { class: 'example' }, example),
        ),
      );
    }
    return h(
      'div',
      { class: 'detached' },
      h('strong', {}, text.detachedTitle),
      h('p', {}, text.detachedBody),
      h('p', { class: 'muted' }, text.detachedList),
      list,
      button(text.backToCanvas, () => this.store.patch({ mode: 'linked', code: '', unmapped: [] }), {
        title: text.backToCanvasHint,
      }),
    );
  }

  private rightPanel(text: Strings, _derived: Derived): HTMLElement {
    return h(
      'aside',
      { class: 'panel right' },
      h('div', { class: 'panel-head' }, h('h2', {}, text.code)),
      this.codeArea,
    );
  }

  private problems(text: Strings, derived: Derived): HTMLElement {
    if (derived.problems.length === 0) {
      return h('p', { class: 'empty' }, text.noProblems);
    }
    const list = h('ul', { class: 'problems' });
    for (const problem of derived.problems) {
      list.append(
        h(
          'li',
          { class: problem.severity },
          h('span', { class: 'where' }, problem.where),
          h('span', {}, problem.message),
        ),
      );
    }
    return list;
  }

  /**
   * The DataMobile variables this label uses, with the value the preview shows.
   *
   * A misspelt name is the failure this catches: DataMobile leaves an unknown
   * `@Bracode@` on the label as those eight characters, which nobody notices
   * until a printed label comes back from the floor.
   */
  private variables(text: Strings): HTMLElement {
    const state = this.store.get();
    const operation = state.document.operation ?? 'all';
    const used = documentVariables(state.document);
    if (used.length === 0) {
      return h('p', { class: 'empty' }, `${text.noVariables} ${text.variablesHint}`);
    }

    const container = h('div', { class: 'fields' });
    for (const use of used) {
      const entry = findVariable(use.name);
      const known = entry !== undefined;
      const offered = known && isAvailable(use.name, operation);
      const chosen = state.document.variableSamples?.[use.name] ?? '';

      // The value shown in the preview can be set here: the catalogue's sample
      // is a realistic length, but only the person designing the label knows
      // what their own product names run to.
      const input = textInput(chosen, (value) =>
        this.store.edit((document) => {
          const samples = { ...document.variableSamples };
          if (value.trim() === '') delete samples[use.name];
          else samples[use.name] = value;
          const { variableSamples: _dropped, ...rest } = document;
          return Object.keys(samples).length > 0
            ? { ...rest, variableSamples: samples }
            : (rest as LabelDocument);
        }),
      );
      if (entry) input.placeholder = entry.sample;

      container.append(field(use.name, input));
      const note = !known
        ? text.unknownVariable
        : !offered
          ? text.notForOperation
          : (state.language === 'ru' ? entry.ru : entry.en);
      container.append(
        h('p', { class: `hint${known && offered ? '' : ' warning'}` }, note),
      );
    }
    return container;
  }


  /**
   * A menu of the variables the label's operation offers.
   *
   * The names are the vendor's and have to be spelt exactly, capitals and all,
   * so choosing one beats typing it.
   */
  private variablePicker(
    text: Strings,
    insert: (name: string) => void,
    prompt: string,
  ): HTMLElement {
    const state = this.store.get();
    const russian = state.language === 'ru';
    const offered = variablesFor(state.document.operation ?? 'all');

    const menu = h('select', { class: 'variable-picker', title: text.variablesHint });
    menu.append(h('option', { value: '', selected: true }, prompt));
    for (const group of DATAMOBILE_GROUPS) {
      const mine = offered.filter((entry) => entry.group === group.id);
      if (mine.length === 0) continue;
      const box = h('optgroup', { label: russian ? group.ru : group.en });
      for (const entry of mine) {
        box.append(
          h('option', { value: entry.name }, `${entry.name} — ${russian ? entry.ru : entry.en}`),
        );
      }
      menu.append(box);
    }
    menu.addEventListener('change', () => {
      if (menu.value !== '') insert(menu.value);
    });
    return menu;
  }

  /**
   * A labelled field with the variable menu under it.
   *
   * A field that holds one value — a barcode's data — is replaced outright:
   * half a barcode and half a variable is not a thing anyone wants, and the
   * old value would have to be deleted by hand every time. Running text is
   * different, so there the variable lands at the caret and the rest stays.
   *
   * The menu sits beside the label rather than inside it: one label names one
   * control, and this is a second control with a job of its own.
   */
  private pickerField(
    text: Strings,
    label: string,
    control: HTMLInputElement | HTMLTextAreaElement,
    commit: (value: string) => void,
    mode: 'insert' | 'replace' = 'insert',
  ): HTMLElement {
    const prompt = mode === 'replace' ? text.replaceWithVariable : text.insertVariable;
    const picker = this.variablePicker(
      text,
      (name) => {
        if (mode === 'replace') {
          commit(name);
          return;
        }
        const from = control.selectionStart ?? control.value.length;
        const to = control.selectionEnd ?? from;
        commit(control.value.slice(0, from) + name + control.value.slice(to));
      },
      prompt,
    );
    picker.setAttribute('aria-label', prompt);
    return h('div', { class: 'field-group' }, field(label, control), picker);
  }


  private sampleData(text: Strings): HTMLElement {
    const state = this.store.get();
    const names = documentPlaceholders(state.document);
    if (names.length === 0) return h('p', { class: 'empty' }, text.sampleDataHint);

    const container = h('div', { class: 'fields' });
    for (const name of names) {
      const value = state.document.sampleData?.[name] ?? '';
      container.append(
        field(
          `{{${name}}}`,
          textInput(value, (next) =>
            this.store.edit((document) => ({
              ...document,
              sampleData: { ...document.sampleData, [name]: next },
            })),
          ),
        ),
      );
      if (value === '') container.append(h('p', { class: 'hint warning' }, text.placeholderMissing));
    }
    return container;
  }

  // --- properties ---------------------------------------------------------

  /** The label itself: what it is called, how big it is, what it is for. */
  private labelProperties(text: Strings): HTMLElement {
    const state = this.store.get();
    return h(
      'div',
      { class: 'fields' },
      field(
        text.labelName,
        textInput(state.document.name, (value) =>
          this.store.edit((document) => ({ ...document, name: value })),
        ),
      ),
      field(
        `${text.width}, mm`,
        numberInput(state.document.width, (value) =>
          this.store.edit((document) => ({ ...document, width: Math.max(5, value) })),
        ),
      ),
      field(
        `${text.height}, mm`,
        numberInput(state.document.height, (value) =>
          this.store.edit((document) => ({ ...document, height: Math.max(5, value) })),
        ),
      ),
      field(
        text.operation,
        select(
          state.document.operation ?? 'all',
          DATAMOBILE_OPERATIONS.map((entry) => ({
            value: entry.id,
            label: state.language === 'ru' ? entry.ru : entry.en,
          })),
          (value) =>
            this.store.edit((document) => ({
              ...document,
              operation: value as DataMobileOperation,
            })),
          { title: text.operationHint },
        ),
      ),
    );
  }

  /** The sample values and the DataMobile variables, which belong together. */
  private valuesSection(text: Strings): HTMLElement {
    return h(
      'div',
      {},
      this.sampleData(text),
      h('h3', {}, text.variables),
      this.variables(text),
    );
  }

  private elementProperties(text: Strings): HTMLElement {
    const container = h('div', { class: 'fields' });
    const element = this.store.selected();
    if (!element) {
      container.append(h('p', { class: 'empty' }, text.nothingSelected));
      return container;
    }

    const update = (change: (element: LabelElement) => LabelElement): void => {
      this.store.edit((document) => replaceElement(document, element.id, change));
    };

    container.append(
      h(
        'div',
        { class: 'element-head' },
        h('span', { class: 'element-kind' }, elementLabel(element, text)),
        h('span', { class: 'element-id' }, element.id),
      ),
      field('X, mm', numberInput(element.x, (value) => update((e) => ({ ...e, x: value })))),
      field('Y, mm', numberInput(element.y, (value) => update((e) => ({ ...e, y: value })))),
      field(
        text.rotation,
        select(
          String(element.rotation ?? 0),
          ['0', '90', '180', '270'].map((value) => ({ value, label: `${value}°` })),
          (value) => update((e) => ({ ...e, rotation: Number(value) as 0 | 90 | 180 | 270 })),
        ),
      ),
    );

    if (element.type === 'text') this.textProperties(container, text, element, update);
    if (element.type === 'rectangle') this.rectangleProperties(container, text, element, update);
    if (element.type === 'line') {
      container.append(
        field('X2, mm', numberInput(element.x2, (value) => update((e) => ({ ...e, x2: value })))),
        field('Y2, mm', numberInput(element.y2, (value) => update((e) => ({ ...e, y2: value })))),
        field(
          `${text.thickness}, mm`,
          numberInput(element.thickness, (value) => update((e) => ({ ...e, thickness: value })), {
            step: 0.1,
            min: 0.05,
          }),
        ),
      );
    }
    if (element.type === 'barcode') this.barcodeProperties(container, text, element, update);
    if (element.type === 'matrix') this.matrixProperties(container, text, element, update);

    container.append(
      h(
        'div',
        { class: 'row' },
        button(text.duplicate, () => this.duplicate()),
        button(text.remove, () => this.remove()),
      ),
    );
    return container;
  }

  private textProperties(
    container: HTMLElement,
    text: Strings,
    element: TextElement,
    update: (change: (element: LabelElement) => LabelElement) => void,
  ): void {
    const content = h('textarea', { class: 'content-area', rows: 3 });
    content.value = element.content;
    content.addEventListener('change', () =>
      update((e) => ({ ...(e as TextElement), content: content.value })),
    );

    container.append(
      this.pickerField(text, text.content, content, (value) =>
        update((e) => ({ ...(e as TextElement), content: value })),
      ),
      field(
        `${text.textHeight}, mm`,
        numberInput(
          element.style.heightMm,
          (value) =>
            update((e) => {
              const current = e as TextElement;
              return { ...current, style: { ...current.style, heightMm: Math.max(0.5, value) } };
            }),
          { step: 0.1, min: 0.5 },
        ),
      ),
      field(
        text.widthScale,
        numberInput(
          element.style.widthScale ?? 1,
          (value) =>
            update((e) => {
              const current = e as TextElement;
              return { ...current, style: { ...current.style, widthScale: Math.max(0.1, value) } };
            }),
          { step: 0.05, min: 0.1 },
        ),
      ),
      field(
        text.alignment,
        select(
          element.align ?? 'left',
          [
            { value: 'left' as const, label: text.alignLeft },
            { value: 'center' as const, label: text.alignCenter },
            { value: 'right' as const, label: text.alignRight },
          ],
          (value) => update((e) => ({ ...(e as TextElement), align: value })),
        ),
      ),
      checkbox(element.box !== undefined, text.wrapInBox, (value) =>
        update((e) => {
          const current = e as TextElement;
          if (!value) {
            const { box: _dropped, ...rest } = current;
            return rest as LabelElement;
          }
          return { ...current, box: { width: 30, height: 10 } };
        }),
      ),
    );

    if (element.box) {
      container.append(
        field(
          `${text.width}, mm`,
          numberInput(element.box.width, (value) =>
            update((e) => {
              const current = e as TextElement;
              return { ...current, box: { ...current.box!, width: Math.max(1, value) } };
            }),
          ),
        ),
        field(
          `${text.height}, mm`,
          numberInput(element.box.height, (value) =>
            update((e) => {
              const current = e as TextElement;
              return { ...current, box: { ...current.box!, height: Math.max(1, value) } };
            }),
          ),
        ),
      );
    }
  }

  private rectangleProperties(
    container: HTMLElement,
    text: Strings,
    element: RectangleElement,
    update: (change: (element: LabelElement) => LabelElement) => void,
  ): void {
    container.append(
      field(
        `${text.width}, mm`,
        numberInput(element.width, (value) =>
          update((e) => ({ ...(e as RectangleElement), width: Math.max(0.2, value) })),
        ),
      ),
      field(
        `${text.height}, mm`,
        numberInput(element.height, (value) =>
          update((e) => ({ ...(e as RectangleElement), height: Math.max(0.2, value) })),
        ),
      ),
      field(
        text.fill,
        select(
          element.fill,
          [
            { value: 'solid' as const, label: text.fillSolid },
            { value: 'outline' as const, label: text.fillOutline },
            { value: 'invert' as const, label: text.fillInvert },
            { value: 'erase' as const, label: text.fillErase },
          ],
          (value) => update((e) => ({ ...(e as RectangleElement), fill: value })),
        ),
      ),
    );
    if (element.fill === 'outline') {
      container.append(
        field(
          `${text.lineWidth}, mm`,
          numberInput(element.lineWidth ?? 0.3, (value) =>
            update((e) => ({ ...(e as RectangleElement), lineWidth: Math.max(0.05, value) })),
          ),
        ),
        field(
          `${text.cornerRadius}, mm`,
          numberInput(element.cornerRadius ?? 0, (value) =>
            update((e) => ({ ...(e as RectangleElement), cornerRadius: Math.max(0, value) })),
          ),
        ),
      );
    }
  }

  /**
   * Which token in the data stands for the GS1 separator.
   *
   * Only the GS1 symbologies have application identifiers to separate, so this
   * appears for them and nowhere else. Data Matrix wants the group separator
   * character and Code 128 wants FNC1, but what is written in the data — and
   * what the printer is set up to act on — is the same token either way.
   */
  private gs1SeparatorField(
    container: HTMLElement,
    text: Strings,
    update: (change: (element: LabelElement) => LabelElement) => void,
  ): void {
    const element = this.store.selected() as BarcodeElement | MatrixElement;
    container.append(
      field(
        text.gs1Separator,
        select(
          element.gs1Separator ?? 'none',
          GS1_SEPARATORS.map((value) => ({
            value,
            label: value === 'none' ? text.gs1SeparatorNone : value,
          })),
          (value) =>
            update((e) => ({ ...(e as BarcodeElement | MatrixElement), gs1Separator: value })),
          { title: text.gs1SeparatorHint },
        ),
      ),
    );
  }

  private barcodeProperties(
    container: HTMLElement,
    text: Strings,
    element: BarcodeElement,
    update: (change: (element: LabelElement) => LabelElement) => void,
  ): void {
    container.append(
      field(
        text.symbology,
        select(
          element.symbology,
          [
            { value: 'code128' as const, label: 'Code 128' },
            { value: 'gs1-128' as const, label: 'GS1-128' },
            { value: 'code39' as const, label: 'Code 39' },
            { value: 'itf' as const, label: 'ITF' },
            { value: 'ean13' as const, label: 'EAN-13' },
            { value: 'ean8' as const, label: 'EAN-8' },
            { value: 'upca' as const, label: 'UPC-A' },
            { value: 'upce' as const, label: 'UPC-E' },
          ],
          (value) => update((e) => ({ ...(e as BarcodeElement), symbology: value })),
        ),
      ),
      this.pickerField(
        text,
        text.data,
        textInput(element.data, (value) =>
          update((e) => ({ ...(e as BarcodeElement), data: value })),
        ),
        (value) => update((e) => ({ ...(e as BarcodeElement), data: value })),
        'replace',
      ),
    );

    if (element.symbology === 'gs1-128') this.gs1SeparatorField(container, text, update);

    container.append(
      field(
        `${text.moduleWidth}, mm`,
        numberInput(
          element.moduleWidth,
          (value) => update((e) => ({ ...(e as BarcodeElement), moduleWidth: Math.max(0.05, value) })),
          { step: 0.05, min: 0.05 },
        ),
      ),
      field(
        `${text.barHeight}, mm`,
        numberInput(element.height, (value) =>
          update((e) => ({ ...(e as BarcodeElement), height: Math.max(1, value) })),
        ),
      ),
      checkbox(element.humanReadable === true, text.humanReadable, (value) =>
        update((e) => ({ ...(e as BarcodeElement), humanReadable: value })),
      ),
      checkbox(element.checkDigit === true, text.checkDigit, (value) =>
        update((e) => ({ ...(e as BarcodeElement), checkDigit: value })),
      ),
    );
  }

  private matrixProperties(
    container: HTMLElement,
    text: Strings,
    element: MatrixElement,
    update: (change: (element: LabelElement) => LabelElement) => void,
  ): void {
    container.append(
      field(
        text.symbology,
        select(
          element.symbology,
          [
            { value: 'qr' as const, label: 'QR' },
            { value: 'datamatrix' as const, label: 'DataMatrix' },
            { value: 'gs1-datamatrix' as const, label: 'GS1 DataMatrix' },
            { value: 'pdf417' as const, label: 'PDF417' },
          ],
          (value) => update((e) => ({ ...(e as MatrixElement), symbology: value })),
        ),
      ),
      this.pickerField(
        text,
        text.data,
        textInput(element.data, (value) =>
          update((e) => ({ ...(e as MatrixElement), data: value })),
        ),
        (value) => update((e) => ({ ...(e as MatrixElement), data: value })),
        'replace',
      ),
    );

    if (element.symbology === 'gs1-datamatrix') this.gs1SeparatorField(container, text, update);

    container.append(
      field(
        `${text.moduleWidth}, mm`,
        numberInput(
          element.moduleWidth,
          (value) => update((e) => ({ ...(e as MatrixElement), moduleWidth: Math.max(0.05, value) })),
          { step: 0.05, min: 0.05 },
        ),
      ),
    );
    if (element.symbology === 'qr') {
      container.append(
        field(
          text.errorCorrection,
          select(
            element.errorCorrection ?? 'M',
            (['L', 'M', 'Q', 'H'] as const).map((value) => ({ value, label: value })),
            (value) => update((e) => ({ ...(e as MatrixElement), errorCorrection: value })),
          ),
        ),
      );
    }
    if (element.symbology === 'pdf417') {
      container.append(
        field(
          text.columns,
          numberInput(element.columns ?? 3, (value) =>
            update((e) => ({ ...(e as MatrixElement), columns: Math.max(1, Math.round(value)) })),
          ),
        ),
      );
    }
  }

  // --- canvas -------------------------------------------------------------

  /**
   * Positions a draggable box over every element the renderer drew.
   *
   * The outlines come from the render, not from the model, because the model
   * cannot know how wide a line of text or a barcode turned out.
   */
  private placeOverlays(derived: Derived): void {
    const state = this.store.get();
    const scale = this.scale(derived);
    clear(this.overlay);

    this.canvas.style.width = `${derived.bitmap.width * scale}px`;
    this.canvas.style.height = `${derived.bitmap.height * scale}px`;
    this.overlay.style.width = this.canvas.style.width;
    this.overlay.style.height = this.canvas.style.height;

    if (state.mode === 'detached') return;

    for (const element of state.document.elements) {
      const line = derived.origins[element.id];
      if (line === undefined) continue;
      const outline = derived.bounds.find((entry) => entry.line === line);
      if (!outline) continue;

      const box = h('div', {
        class: `outline${element.id === state.selectedId ? ' selected' : ''}`,
        style:
          `left:${outline.x * scale}px;top:${outline.y * scale}px;` +
          `width:${Math.max(4, outline.width * scale)}px;height:${Math.max(4, outline.height * scale)}px`,
      });
      box.addEventListener('pointerdown', (event) => this.startDrag(event, element, scale));

      if (element.id === state.selectedId) {
        const size = {
          width: outline.width / this.dotsPerMm(),
          height: outline.height / this.dotsPerMm(),
        };
        for (const handle of handlesFor(element)) {
          const grip = h('div', { class: `handle ${handle}`, 'aria-hidden': true });
          grip.addEventListener('pointerdown', (event) =>
            this.startResize(event, element, handle, scale, size),
          );
          box.append(grip);
        }
      }
      this.overlay.append(box);
    }
  }

  private dotsPerMm(): number {
    return this.store.profile().dpi / 25.4;
  }

  /**
   * Resizes an element by dragging one of its grips.
   *
   * What "size" means depends on the element: a rectangle has a width and a
   * height of its own, a barcode's width is its module width (the data decides
   * the rest), and a two-dimensional symbol has only its module. Nothing is
   * offered where it would not map onto a real property — a line of text is as
   * tall as its characters, and that is a number, not a corner.
   *
   * The keyboard alternative is the properties panel, where the same numbers
   * are typed exactly rather than approached by hand.
   */
  private startResize(
    event: PointerEvent,
    element: LabelElement,
    handle: Handle,
    scale: number,
    size: { width: number; height: number },
  ): void {
    event.preventDefault();
    // Without this the outline underneath would start a move at the same time.
    event.stopPropagation();
    this.store.select(element.id);

    const perMm = this.dotsPerMm();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = element;
    document.body.classList.add('dragging');

    const move = (moveEvent: PointerEvent): void => {
      const dx = (moveEvent.clientX - startX) / scale / perMm;
      const dy = (moveEvent.clientY - startY) / scale / perMm;
      this.store.edit(
        (label) => replaceElement(label, element.id, () => resized(origin, handle, dx, dy, size)),
        { gesture: true },
      );
    };

    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('dragging');
      this.store.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /**
   * Dots to screen pixels.
   *
   * Fitting measures the stage rather than the window, and fits both axes: a
   * long label that only fitted across would run off the bottom, which is the
   * half of the label most likely to be crowded.
   */
  private scale(derived: Derived): number {
    const state = this.store.get();
    if (typeof state.zoom === 'number') return state.zoom;
    const padding = 48;
    const width = Math.max(200, this.stage.clientWidth - padding);
    const height = Math.max(200, this.stage.clientHeight - padding);
    const fit = Math.min(width / derived.bitmap.width, height / derived.bitmap.height);
    return Math.max(0.5, Math.min(8, fit));
  }

  /**
   * Moves an element by dragging its outline across the preview.
   *
   * The listeners go on the window rather than on the outline, because the
   * first move redraws the panels and the outline under the pointer is thrown
   * away and built again — a handler attached to it, capture and all, would
   * die with it after a single pixel.
   */
  private startDrag(event: PointerEvent, element: LabelElement, scale: number): void {
    event.preventDefault();
    this.store.select(element.id);

    const dotsPerMm = this.store.profile().dpi / 25.4;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = element.x;
    const originY = element.y;
    document.body.classList.add('dragging');

    const move = (moveEvent: PointerEvent): void => {
      const deltaX = (moveEvent.clientX - startX) / scale / dotsPerMm;
      const deltaY = (moveEvent.clientY - startY) / scale / dotsPerMm;
      const round = (value: number): number => Math.round(value * 10) / 10;
      this.store.edit(
        (label) =>
          replaceElement(label, element.id, (current) => {
            const next = { ...current, x: round(originX + deltaX), y: round(originY + deltaY) };
            if (current.type === 'line') {
              // A line moves as a whole, so its far end travels with it.
              return {
                ...next,
                x2: round(current.x2 + (next.x - current.x)),
                y2: round(current.y2 + (next.y - current.y)),
              } as LabelElement;
            }
            return next as LabelElement;
          }),
        // The whole drag is one undo step, not one per pixel: the store
        // records the position the drag started from and nothing after it.
        { gesture: true },
      );
    };

    const end = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      document.body.classList.remove('dragging');
      this.store.endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }


  private keyboard(event: KeyboardEvent): void {
    const inField =
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (inField) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }

    const selected = this.store.selected();
    if (!selected) return;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.remove();
      return;
    }

    const step = event.shiftKey ? 1 : 0.1;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[event.key];
    if (!delta) return;
    event.preventDefault();
    this.store.edit((document) =>
      replaceElement(document, selected.id, (element) => ({
        ...element,
        x: Math.round((element.x + delta[0]) * 10) / 10,
        y: Math.round((element.y + delta[1]) * 10) / 10,
      })),
    );
  }

  // --- code ---------------------------------------------------------------

  /**
   * Takes a hand edit of the code.
   *
   * If the model can hold everything the code says, the canvas keeps driving
   * and the document follows the text. If it cannot, the canvas steps aside
   * rather than silently dropping the lines it did not understand.
   */
  private codeChanged(): void {
    const code = this.codeArea.value;
    const profile = this.store.profile();
    const imported = importFor(profile, code);

    if (imported.mode === 'linked') {
      this.store.adopt(imported.document, { mode: 'linked', code, dirty: true });
    } else {
      this.store.patch({
        mode: 'detached',
        code,
        unmapped: imported.unmapped,
        dirty: true,
      });
    }
  }

  // --- elements -----------------------------------------------------------

  private addPreset(preset: Preset): void {
    this.store.edit((document) => {
      const id = nextElementId(document, preset.prefix);
      // New elements come down the label rather than on top of each other.
      const at = { x: 4, y: Math.min(document.height - 8, 4 + document.elements.length * 6) };
      return { ...document, elements: [...document.elements, preset.make(id, at, document)] };
    });
    this.store.select(this.store.get().document.elements.at(-1)?.id);
  }

  private duplicate(): void {
    const selected = this.store.selected();
    if (!selected) return;
    this.store.edit((document) => {
      const id = nextElementId(document, selected.type.slice(0, 1));
      const copy = { ...selected, id, x: selected.x + 2, y: selected.y + 2 };
      return { ...document, elements: [...document.elements, copy] };
    });
  }

  private remove(): void {
    const selected = this.store.selected();
    if (!selected) return;
    this.store.edit((document) => ({
      ...document,
      elements: document.elements.filter((element) => element.id !== selected.id),
    }));
    this.store.select(undefined);
  }

  // --- files --------------------------------------------------------------

  private async menu(action: string): Promise<void> {
    if (action === 'new') await this.newLabel();
    if (action === 'open') await this.open();
    if (action === 'save') await this.save(false);
    if (action === 'save-as') await this.save(true);
    if (action === 'export') await this.exportCode();
    if (action === 'export-png') await this.exportPng();
  }

  private async newLabel(): Promise<void> {
    if (!(await this.unsavedWorkKept())) return;
    this.store.adopt(starterDocument(), { resetHistory: true, dirty: false });
    // A new label has no file of its own yet; keeping the old path would let
    // the next save quietly write an empty sheet over the previous design.
    this.store.patch({ filePath: undefined });
  }

  private async open(): Promise<void> {
    if (!(await this.unsavedWorkKept())) return;
    const opened = await window.btpd?.openProject();
    if (!opened) return;
    try {
      const parsed = parseDocument(JSON.parse(opened.content));
      if (!parsed.document) {
        window.alert(parsed.issues.map((issue) => issue.message).join('\n'));
        return;
      }
      this.store.adopt(parsed.document, {
        filePath: opened.path,
        dirty: false,
        resetHistory: true,
      });
      if (parsed.issues.length > 0) {
        window.alert(parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
      }
    } catch (error) {
      window.alert(String(error));
    }
  }

  /** Returns false when the reader backed out of the save dialog. */
  private async save(forceDialog: boolean): Promise<boolean> {
    const state = this.store.get();
    const path = await window.btpd?.saveProject({
      ...(forceDialog || state.filePath === undefined ? {} : { path: state.filePath }),
      content: serializeDocument(state.document),
      suggestedName: `${state.document.name || 'label'}.btpd.json`,
    });
    if (!path) return false;
    this.store.patch({ filePath: path, dirty: false });
    return true;
  }

  /**
   * Offers to save work that is about to be thrown away.
   *
   * Returns false when the reader changed their mind, so the caller stops.
   * An empty label is not worth a question: there is nothing in it to lose.
   */
  private async unsavedWorkKept(): Promise<boolean> {
    const state = this.store.get();
    if (!state.dirty || state.document.elements.length === 0) return true;

    // Without the bridge — the browser preview — there is nothing to save to,
    // and a question nobody can answer would stop the command dead.
    if (window.btpd?.askSave === undefined) return true;

    const text = this.text();
    const answer = await window.btpd.askSave({
      message: text.unsavedTitle,
      detail: state.filePath ?? text.unsavedDetail,
      save: text.save,
      discard: text.discard,
      cancel: text.cancel,
    });
    if (answer === 'cancel') return false;
    if (answer === 'save') return this.save(false);
    return true;
  }

  private async exportCode(): Promise<void> {
    const derived = this.derive();
    const language = languageOf(this.store.profile());
    const extension = FILE_EXTENSIONS[language];
    await window.btpd?.exportFile({
      suggestedName: `${this.store.get().document.name || 'label'}.${extension}`,
      content: derived.code,
      extensions: [extension, 'txt'],
    });
  }

  private async exportPng(): Promise<void> {
    const derived = this.derive();
    await window.btpd?.exportFile({
      suggestedName: `${this.store.get().document.name || 'label'}.png`,
      content: encodePng(derived.bitmap, { scale: 2 }),
      extensions: ['png'],
    });
  }
}

function elementLabel(element: LabelElement, text: Strings): string {
  switch (element.type) {
    case 'text':
      return text.kindText;
    case 'rectangle':
      return text.kindRectangle;
    case 'line':
      return text.kindLine;
    case 'barcode':
      return text.kindBarcode;
    case 'matrix':
      return text.kindMatrix;
  }
}

function describeElement(element: LabelElement): string {
  if (element.type === 'text') return element.content.slice(0, 28);
  if (element.type === 'barcode' || element.type === 'matrix') {
    return `${element.symbology} · ${element.data.slice(0, 20)}`;
  }
  if (element.type === 'rectangle') return `${element.width} × ${element.height} mm`;
  return `${element.x},${element.y} → ${element.x2},${element.y2}`;
}

/**
 * Which grips an element gets.
 *
 * Only where dragging maps onto something the element actually has: a
 * rectangle and a text block have two dimensions, a barcode has a height and a
 * module width, a two-dimensional symbol has a module, and a line has two ends.
 * A single line of text has neither — its size is the character height.
 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';

const BOX_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function handlesFor(element: LabelElement): Handle[] {
  switch (element.type) {
    case 'rectangle':
      return BOX_HANDLES;
    case 'text':
      return element.box ? BOX_HANDLES : [];
    case 'barcode':
      return ['e', 's', 'se'];
    case 'matrix':
      return ['se'];
    case 'line':
      return ['start', 'end'];
  }
}

/** Millimetres, rounded the way the rest of the canvas rounds them. */
const mm = (value: number): number => Math.round(value * 10) / 10;

/**
 * The element as it should be after a grip has moved by this much.
 *
 * `origin` is the element as it was when the grip was taken hold of, so the
 * arithmetic is against a fixed starting point rather than against the last
 * frame — which would drift.
 */
function resized(
  origin: LabelElement,
  handle: Handle,
  dx: number,
  dy: number,
  size: { width: number; height: number },
): LabelElement {
  const west = handle === 'nw' || handle === 'w' || handle === 'sw';
  const east = handle === 'ne' || handle === 'e' || handle === 'se';
  const north = handle === 'nw' || handle === 'n' || handle === 'ne';
  const south = handle === 'sw' || handle === 's' || handle === 'se';

  if (origin.type === 'line') {
    if (handle === 'start') return { ...origin, x: mm(origin.x + dx), y: mm(origin.y + dy) };
    return { ...origin, x2: mm(origin.x2 + dx), y2: mm(origin.y2 + dy) };
  }

  if (origin.type === 'rectangle') {
    const box = grow(origin.x, origin.y, origin.width, origin.height, dx, dy, {
      west,
      east,
      north,
      south,
    });
    return { ...origin, ...box };
  }

  if (origin.type === 'text' && origin.box) {
    const box = grow(origin.x, origin.y, origin.box.width, origin.box.height, dx, dy, {
      west,
      east,
      north,
      south,
    });
    return { ...origin, x: box.x, y: box.y, box: { width: box.width, height: box.height } };
  }

  if (origin.type === 'barcode') {
    // The bars are as wide as the data makes them, so the width a reader drags
    // is the module width: the whole symbol scales with it.
    const module = east ? scaleModule(origin.moduleWidth, size.width, dx) : origin.moduleWidth;
    const height = south ? Math.max(1, mm(origin.height + dy)) : origin.height;
    return { ...origin, moduleWidth: module, height };
  }

  if (origin.type === 'matrix') {
    // A symbol is square in modules; one number decides both sides, so the
    // corner follows whichever way the pointer moved furthest.
    const along = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const reference = Math.abs(dx) > Math.abs(dy) ? size.width : size.height;
    return { ...origin, moduleWidth: scaleModule(origin.moduleWidth, reference, along) };
  }

  return origin;
}

function grow(
  x: number,
  y: number,
  width: number,
  height: number,
  dx: number,
  dy: number,
  edges: { west: boolean; east: boolean; north: boolean; south: boolean },
): { x: number; y: number; width: number; height: number } {
  const minimum = 0.5;
  let left = x;
  let top = y;
  let across = width;
  let down = height;

  if (edges.west) {
    const shift = Math.min(dx, width - minimum);
    left = mm(x + shift);
    across = mm(width - shift);
  }
  if (edges.east) across = Math.max(minimum, mm(width + dx));
  if (edges.north) {
    const shift = Math.min(dy, height - minimum);
    top = mm(y + shift);
    down = mm(height - shift);
  }
  if (edges.south) down = Math.max(minimum, mm(height + dy));

  return { x: left, y: top, width: across, height: down };
}

/** A module width that makes the symbol as wide as the pointer asks. */
function scaleModule(moduleWidth: number, drawn: number, delta: number): number {
  if (drawn <= 0) return moduleWidth;
  const factor = Math.max(0.1, (drawn + delta) / drawn);
  return Math.max(0.05, Math.round(moduleWidth * factor * 100) / 100);
}

/**
 * The label a new window, and the "new" command, start from.
 *
 * Empty on purpose: a template is built for one operation and one printer, and
 * a starter design is something to delete before the real work begins.
 */
function starterDocument(): LabelDocument {
  return createDocument({
    name: 'Label',
    width: 60,
    height: 40,
    gap: { height: 2, offset: 0 },
  });
}
