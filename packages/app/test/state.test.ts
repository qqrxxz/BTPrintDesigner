import { describe, expect, it } from 'vitest';
import { createDocument, type LabelDocument } from '@btpd/core';
import { Store } from '../src/state.js';

const withText = (content: string): LabelDocument =>
  createDocument({
    width: 60,
    height: 40,
    elements: [{ id: 't1', type: 'text', x: 4, y: 4, content, style: { heightMm: 3 } }],
  });

describe('opening code and then editing the design', () => {
  it('lets the canvas take over, so a change is a change', () => {
    // Opening a template puts the file's own text in `code`, and while it is
    // there the panel shows the file rather than the design. Adding or
    // deleting an element then moved nothing on screen, which is the bug this
    // guards: the first canvas edit gives the code back to the generator.
    const store = new Store(createDocument({ width: 60, height: 40 }));
    store.adopt(withText('@Name1@'), { mode: 'linked', code: 'SIZE 58 mm,40 mm\nCLS\nPRINT 1' });
    expect(store.get().code).not.toBe('');

    store.edit((document) => ({ ...document, elements: [] }));
    expect(store.get().code).toBe('');
    expect(store.get().document.elements).toEqual([]);
    expect(store.get().mode).toBe('linked');
  });

  it('keeps the text of the file until something is changed', () => {
    const store = new Store(createDocument({ width: 60, height: 40 }));
    store.adopt(withText('@Name1@'), { mode: 'linked', code: 'CLS' });
    store.select('t1');
    expect(store.get().code).toBe('CLS');
  });

  it('undo still steps back through the design', () => {
    const store = new Store(withText('one'));
    store.edit((document) => ({ ...document, name: 'two' }));
    store.undo();
    expect(store.get().document.name).not.toBe('two');
  });
});
