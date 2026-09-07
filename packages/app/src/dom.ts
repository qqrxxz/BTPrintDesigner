/**
 * A very small DOM helper.
 *
 * The interface is rebuilt from state on every change rather than diffed. At
 * this size that is both fast enough and far easier to reason about than a
 * framework would be, and it keeps the app's only dependency the rendering
 * engine itself.
 */

type Attributes = Record<string, string | number | boolean | undefined>;
type Child = Node | string | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(element: HTMLElement): void {
  while (element.firstChild) element.firstChild.remove();
}

/** A labelled field, the shape every property in the panel takes. */
export function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
}

export function numberInput(
  value: number,
  onChange: (value: number) => void,
  options: { step?: number; min?: number } = {},
): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    value: String(Math.round(value * 100) / 100),
    step: options.step ?? 0.1,
    min: options.min,
  });
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(parsed);
  });
  return input;
}

export function textInput(value: string, onChange: (value: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', value });
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

export function select<T extends string>(
  value: T,
  options: readonly { value: T; label: string }[],
  onChange: (value: T) => void,
): HTMLSelectElement {
  const element = h('select');
  for (const option of options) {
    const node = h('option', { value: option.value, selected: option.value === value }, option.label);
    element.append(node);
  }
  element.addEventListener('change', () => onChange(element.value as T));
  return element;
}

export function checkbox(
  value: boolean,
  label: string,
  onChange: (value: boolean) => void,
): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: value });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'checkbox' }, input, h('span', {}, label));
}

export function button(label: string, onClick: () => void, extra: Attributes = {}): HTMLElement {
  const element = h('button', { type: 'button', ...extra }, label);
  element.addEventListener('click', onClick);
  return element;
}
