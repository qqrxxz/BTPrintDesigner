import { describe, expect, it } from 'vitest';
import type { LabelElement } from '@btpd/core';
import { resized } from '../src/app.js';

const line: LabelElement = { id: 'l1', type: 'line', x: 4, y: 4, x2: 34, y2: 4, thickness: 0.4 };
const size = { width: 30, height: 0.4 };
const tspl = { language: 'tspl' as const, free: false };
const zpl = { language: 'zpl' as const, free: false };

describe('dragging the end of a line', () => {
  it('lengthens it without tilting it, where the language has no diagonal', () => {
    // TSPL has no diagonal command at all, so a millimetre of drift while
    // lengthening used to delete the line from the label rather than tilt it.
    const longer = resized(line, 'end', 10, -6, size, tspl);
    expect(longer).toMatchObject({ x: 4, y: 4, x2: 44, y2: 4 });
  });

  it('keeps a horizontal line horizontal however far up the pointer goes', () => {
    // Turning a line the other way is two numbers in the panel; dragging is
    // for lengthening it, and must not be able to delete it by accident.
    expect(resized(line, 'end', -1, -20, size, tspl)).toMatchObject({ x2: 33, y2: 4 });
  });

  it('lengthens an upright line along its own axis', () => {
    const upright: LabelElement = { ...line, x2: 4, y2: 24 } as LabelElement;
    expect(resized(upright, 'end', 8, 5, size, tspl)).toMatchObject({ x2: 4, y2: 29 });
  });

  it('moves the near end the same way', () => {
    const moved = resized(line, 'start', -5, 3, size, tspl);
    expect(moved).toMatchObject({ x: -1, y: 4, x2: 34, y2: 4 });
  });

  it('lets shift ask for the diagonal anyway, and the language answer for it', () => {
    expect(resized(line, 'end', 10, -6, size, { ...tspl, free: true })).toMatchObject({
      x2: 44,
      y2: -2,
    });
  });

  it('draws the diagonal where the language can, snapping only a hair', () => {
    expect(resized(line, 'end', 10, -6, size, zpl)).toMatchObject({ x2: 44, y2: -2 });
    // Half a millimetre off horizontal is a straight line that slipped.
    expect(resized(line, 'end', 10, -0.4, size, zpl)).toMatchObject({ x2: 44, y2: 4 });
  });
});

describe('dragging the side of a box', () => {
  const box: LabelElement = {
    id: 'r1',
    type: 'rectangle',
    x: 10,
    y: 10,
    width: 20,
    height: 10,
    fill: 'outline',
    lineWidth: 0.3,
  };

  it('grows from the corner it is pulled by', () => {
    expect(resized(box, 'se', 5, 4, { width: 20, height: 10 }, tspl)).toMatchObject({
      x: 10,
      y: 10,
      width: 25,
      height: 14,
    });
  });

  it('moves the far side when pulled by the near one', () => {
    expect(resized(box, 'nw', 4, 2, { width: 20, height: 10 }, tspl)).toMatchObject({
      x: 14,
      y: 12,
      width: 16,
      height: 8,
    });
  });

  it('never pulls a side through the other one', () => {
    const squashed = resized(box, 'w', 100, 0, { width: 20, height: 10 }, tspl) as {
      width: number;
    };
    expect(squashed.width).toBeGreaterThanOrEqual(0.5);
  });
});
