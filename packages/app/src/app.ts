import {
  checkLabelWidth,
  createDocument,
  DATAMOBILE_GROUPS,
  DATAMOBILE_OPERATIONS,
  defaultContent,
  documentPlaceholders,
  documentVariables,
  findVariable,
  isAvailable,
  encodePng,
  parseDocument,
  PRINTER_PROFILES,
  serializeDocument,
  substituteVariables,
  variablesFor,
  type BarcodeElement,
  type DataMobileOperation,
  type LabelDocument,
  type LabelElement,
  type MatrixElement,
  type RectangleElement,
  type TextElement,
  type TsplFontSet,
} from '@btpd/core';
import { button, checkbox, clear, field, h, numberInput, select, textInput } from './dom.js';
import { LANGUAGES, strings, type Language, type Strings } from './i18n.js';
import { translate } from './messages.js';
import { generateFor, importFor, languageOf, loadFonts, paint, renderFor } from './pipeline.js';
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
      : substituteVariables(code);
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
        button(text.newLabel, () => this.newLabel()),
        button(text.open, () => void this.open()),
        button(text.save, () => void this.save(false)),
        button(text.exportCode, () => void this.exportCode()),
        button(text.exportPng, () => void this.exportPng()),
      ),
      h(
        'div',
        { class: 'group' },
        h('span', { class: 'group-label' }, text.add),
        button(text.addText, () => this.addElement('text')),
        button(text.addRectangle, () => this.addElement('rectangle')),
        button(text.addLine, () => this.addElement('line')),
        button(text.addBarcode, () => this.addElement('barcode')),
        button(text.addMatrix, () => this.addElement('matrix')),
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

  private leftPanel(text: Strings, derived: Derived): HTMLElement {
    const state = this.store.get();
    const list = h('div', { class: 'element-list' });

    if (state.document.elements.length === 0) {
      list.append(h('p', { class: 'empty' }, text.noElements));
    }
    for (const element of state.document.elements) {
      const row = h(
        'div',
        { class: `element-row${element.id === state.selectedId ? ' selected' : ''}` },
        h('span', { class: 'element-kind' }, elementLabel(element, text)),
        h('span', { class: 'element-name' }, describeElement(element)),
      );
      row.addEventListener('click', () => this.store.select(element.id));
      list.append(row);
    }

    return h(
      'aside',
      { class: 'panel left' },
      h('h2', {}, text.elements),
      list,
      h(
        'div',
        { class: 'row' },
        button(text.duplicate, () => this.duplicate()),
        button(text.remove, () => this.remove()),
      ),
      h('h2', {}, text.properties),
      this.properties(text),
      h('h2', {}, text.sampleData),
      this.sampleData(text),
      h('h2', {}, text.variables),
      this.variables(text),
      h('h2', {}, text.problems),
      this.problems(text, derived),
    );
  }

  private centre(text: Strings, derived: Derived): HTMLElement {
    const state = this.store.get();
    clear(this.stage);
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
    const list = h('ul', { class: 'unmapped' });
    for (const entry of state.unmapped) {
      list.append(
        h(
          'li',
          {},
          h('code', {}, `${text.line} ${entry.line}: ${entry.source}`),
          h('span', {}, translate(state.language, entry.reason, entry.code, entry.values)),
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

    const list = h('ul', { class: 'problems variables' });
    for (const use of used) {
      const entry = findVariable(use.name);
      const known = entry !== undefined;
      const offered = known && isAvailable(use.name, operation);
      const description = !known
        ? text.unknownVariable
        : !offered
          ? text.notForOperation
          : `${state.language === 'ru' ? entry.ru : entry.en} · ${entry.sample}`;
      list.append(
        h(
          'li',
          { class: known && offered ? 'info' : 'warning' },
          h('span', { class: 'where' }, use.name),
          h('span', {}, description),
        ),
      );
    }
    return list;
  }

  /**
   * A menu of the variables the label's operation offers.
   *
   * The names are the vendor's and have to be spelt exactly, capitals and all,
   * so choosing one beats typing it.
   */
  private variablePicker(text: Strings, insert: (name: string) => void): HTMLElement {
    const state = this.store.get();
    const russian = state.language === 'ru';
    const offered = variablesFor(state.document.operation ?? 'all');

    const menu = h('select', { class: 'variable-picker', title: text.variablesHint });
    menu.append(h('option', { value: '', selected: true }, text.insertVariable));
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

  /** A text field with the variable menu beside it, inserting at the caret. */
  private withPicker(
    text: Strings,
    control: HTMLInputElement | HTMLTextAreaElement,
    commit: (value: string) => void,
  ): HTMLElement {
    const picker = this.variablePicker(text, (name) => {
      const from = control.selectionStart ?? control.value.length;
      const to = control.selectionEnd ?? from;
      commit(control.value.slice(0, from) + name + control.value.slice(to));
    });
    return h('div', { class: 'with-picker' }, control, picker);
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

  private properties(text: Strings): HTMLElement {
    const state = this.store.get();
    const container = h('div', { class: 'fields' });

    container.append(
      h('h3', {}, text.label),
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
        ),
      ),
      h('p', { class: 'hint' }, text.operationHint),
    );

    const element = this.store.selected();
    if (!element) {
      container.append(h('p', { class: 'empty' }, text.nothingSelected));
      return container;
    }

    const update = (change: (element: LabelElement) => LabelElement): void => {
      this.store.edit((document) => replaceElement(document, element.id, change));
    };

    container.append(
      h('h3', {}, elementLabel(element, text)),
      field(`X, mm`, numberInput(element.x, (value) => update((e) => ({ ...e, x: value })))),
      field(`Y, mm`, numberInput(element.y, (value) => update((e) => ({ ...e, y: value })))),
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
      field(
        text.content,
        this.withPicker(text, content, (value) =>
          update((e) => ({ ...(e as TextElement), content: value })),
        ),
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
          (
            ['code128', 'gs1-128', 'code39', 'itf', 'ean13', 'ean8', 'upca', 'upce'] as const
          ).map((value) => ({ value, label: value })),
          (value) => update((e) => ({ ...(e as BarcodeElement), symbology: value })),
        ),
      ),
      field(
        text.data,
        this.withPicker(
          text,
          textInput(element.data, (value) =>
            update((e) => ({ ...(e as BarcodeElement), data: value })),
          ),
          (value) => update((e) => ({ ...(e as BarcodeElement), data: value })),
        ),
      ),
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
          (['qr', 'datamatrix', 'pdf417'] as const).map((value) => ({ value, label: value })),
          (value) => update((e) => ({ ...(e as MatrixElement), symbology: value })),
        ),
      ),
      field(
        text.data,
        this.withPicker(
          text,
          textInput(element.data, (value) =>
            update((e) => ({ ...(e as MatrixElement), data: value })),
          ),
          (value) => update((e) => ({ ...(e as MatrixElement), data: value })),
        ),
      ),
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
      this.overlay.append(box);
    }
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

  private startDrag(event: PointerEvent, element: LabelElement, scale: number): void {
    event.preventDefault();
    this.store.select(element.id);

    const dotsPerMm = this.store.profile().dpi / 25.4;
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = element.x;
    const originY = element.y;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      const deltaX = (moveEvent.clientX - startX) / scale / dotsPerMm;
      const deltaY = (moveEvent.clientY - startY) / scale / dotsPerMm;
      const round = (value: number): number => Math.round(value * 10) / 10;
      this.store.edit((document) =>
        replaceElement(document, element.id, (current) => {
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
      );
    };

    const end = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
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

  private addElement(type: LabelElement['type']): void {
    this.store.edit((document) => {
      const id = nextElementId(document, type.slice(0, 1));
      const element = newElement(type, id, document);
      return { ...document, elements: [...document.elements, element] };
    });
    const document_ = this.store.get().document;
    this.store.select(document_.elements.at(-1)?.id);
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
    if (action === 'new') this.newLabel();
    if (action === 'open') await this.open();
    if (action === 'save') await this.save(false);
    if (action === 'save-as') await this.save(true);
    if (action === 'export') await this.exportCode();
    if (action === 'export-png') await this.exportPng();
  }

  private newLabel(): void {
    this.store.adopt(starterDocument(), { resetHistory: true, dirty: false });
  }

  private async open(): Promise<void> {
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

  private async save(forceDialog: boolean): Promise<void> {
    const state = this.store.get();
    const path = await window.btpd?.saveProject({
      ...(forceDialog || state.filePath === undefined ? {} : { path: state.filePath }),
      content: serializeDocument(state.document),
      suggestedName: `${state.document.name || 'label'}.btpd.json`,
    });
    if (path) this.store.patch({ filePath: path, dirty: false });
  }

  private async exportCode(): Promise<void> {
    const derived = this.derive();
    await window.btpd?.exportFile({
      suggestedName: `${this.store.get().document.name || 'label'}.${languageOf(this.store.profile())}`,
      content: derived.code,
      extensions: [languageOf(this.store.profile()), 'txt'],
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
      return text.addText;
    case 'rectangle':
      return text.addRectangle;
    case 'line':
      return text.addLine;
    case 'barcode':
      return text.addBarcode;
    case 'matrix':
      return text.addMatrix;
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

function newElement(type: LabelElement['type'], id: string, document: LabelDocument): LabelElement {
  const x = 4;
  const y = Math.min(document.height - 8, 4 + document.elements.length * 6);
  // On a template tied to an operation, the obvious variable beats a stub: a
  // barcode on a product label is the product's barcode virtually every time.
  const preset = (kind: 'text' | 'barcode' | 'matrix', fallback: string): string =>
    defaultContent(kind, document.operation) ?? fallback;
  switch (type) {
    case 'text':
      return { id, type: 'text', x, y, content: preset('text', 'Text'), style: { heightMm: 3 } };
    case 'rectangle':
      return { id, type: 'rectangle', x, y, width: 20, height: 10, fill: 'outline', lineWidth: 0.3 };
    case 'line':
      return { id, type: 'line', x, y, x2: Math.min(document.width - 4, x + 30), y2: y, thickness: 0.4 };
    case 'barcode':
      return {
        id,
        type: 'barcode',
        x,
        y,
        symbology: 'code128',
        data: preset('barcode', '4820-117-A'),
        moduleWidth: 0.25,
        height: 10,
        humanReadable: true,
      };
    case 'matrix':
      return {
        id,
        type: 'matrix',
        x,
        y,
        symbology: 'qr',
        data: preset('matrix', 'https://example.com'),
        moduleWidth: 0.5,
      };
  }
}

/** A label with something on it, so the first window is not an empty sheet. */
function starterDocument(): LabelDocument {
  return createDocument({
    name: 'Label',
    width: 60,
    height: 40,
    gap: { height: 2, offset: 0 },
    sampleData: { sku: '4820-117-A' },
    elements: [
      { id: 'r1', type: 'rectangle', x: 1, y: 1, width: 58, height: 38, fill: 'outline', lineWidth: 0.4, cornerRadius: 1.5 },
      { id: 't1', type: 'text', x: 30, y: 4, content: 'SKU {{sku}}', align: 'center', style: { heightMm: 4 } },
      {
        id: 'b1',
        type: 'barcode',
        x: 4,
        y: 14,
        symbology: 'code128',
        data: '{{sku}}',
        moduleWidth: 0.25,
        height: 12,
        humanReadable: true,
      },
      { id: 'm1', type: 'matrix', x: 40, y: 14, symbology: 'qr', data: 'https://example.com/p/{{sku}}', moduleWidth: 0.45 },
    ],
  });
}
