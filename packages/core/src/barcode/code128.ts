import { BarcodeError, patternToModules, type LinearSymbol } from './types.js';

/**
 * Code 128 (ISO/IEC 15417).
 *
 * The interesting part is choosing subsets. Code C packs two digits into one
 * symbol character, so a long number is half the width — but only if the
 * encoder switches into C at the right moment and back out again in time.
 * Rather than the heuristic ladder the standard suggests, this encoder solves
 * for the shortest encoding exactly, with a small dynamic program over
 * (position, active subset). Shortest matters on a label: every module saved
 * is width back for the rest of the design.
 */

/** Bar/space run lengths for symbol values 0..106, from the standard. */
const PATTERNS: readonly (readonly number[])[] = [
  [2, 1, 2, 2, 2, 2], [2, 2, 2, 1, 2, 2], [2, 2, 2, 2, 2, 1], [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2], [1, 3, 1, 2, 2, 2], [1, 2, 2, 2, 1, 3], [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2], [2, 2, 1, 2, 1, 3], [2, 2, 1, 3, 1, 2], [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2], [1, 2, 2, 1, 3, 2], [1, 2, 2, 2, 3, 1], [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2], [1, 2, 3, 2, 2, 1], [2, 2, 3, 2, 1, 1], [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1], [2, 1, 3, 2, 1, 2], [2, 2, 3, 1, 1, 2], [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2], [3, 2, 1, 1, 2, 2], [3, 2, 1, 2, 2, 1], [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2], [3, 2, 2, 2, 1, 1], [2, 1, 2, 1, 2, 3], [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1], [1, 1, 1, 3, 2, 3], [1, 3, 1, 1, 2, 3], [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3], [1, 3, 2, 1, 1, 3], [1, 3, 2, 3, 1, 1], [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3], [2, 3, 1, 3, 1, 1], [1, 1, 2, 1, 3, 3], [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1], [1, 1, 3, 1, 2, 3], [1, 1, 3, 3, 2, 1], [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1], [2, 1, 1, 3, 3, 1], [2, 3, 1, 1, 3, 1], [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1], [2, 1, 3, 1, 3, 1], [3, 1, 1, 1, 2, 3], [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1], [3, 1, 2, 1, 1, 3], [3, 1, 2, 3, 1, 1], [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1], [2, 2, 1, 4, 1, 1], [4, 3, 1, 1, 1, 1], [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2], [1, 2, 1, 1, 2, 4], [1, 2, 1, 4, 2, 1], [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1], [1, 1, 2, 2, 1, 4], [1, 1, 2, 4, 1, 2], [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1], [1, 4, 2, 1, 1, 2], [1, 4, 2, 2, 1, 1], [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4], [4, 1, 3, 1, 1, 1], [2, 4, 1, 1, 1, 2], [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2], [1, 2, 1, 1, 4, 2], [1, 2, 1, 2, 4, 1], [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2], [1, 2, 4, 2, 1, 1], [4, 1, 1, 2, 1, 2], [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1], [2, 1, 2, 1, 4, 1], [2, 1, 4, 1, 2, 1], [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3], [1, 1, 1, 3, 4, 1], [1, 3, 1, 1, 4, 1], [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1], [4, 1, 1, 1, 1, 3], [4, 1, 1, 3, 1, 1], [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1], [3, 1, 1, 1, 4, 1], [4, 1, 1, 1, 3, 1], [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4], [2, 1, 1, 2, 3, 2], [2, 3, 3, 1, 1, 1, 2],
];

type Subset = 'A' | 'B' | 'C';

const START: Record<Subset, number> = { A: 103, B: 104, C: 105 };
const STOP = 106;
const SHIFT = 98;
const SWITCH: Record<Subset, Partial<Record<Subset, number>>> = {
  A: { B: 100, C: 99 },
  B: { A: 101, C: 99 },
  C: { A: 101, B: 100 },
};

/**
 * Function characters travel in the data string as these sentinels, the
 * convention every barcode toolchain settled on. FNC1 leading the data is what
 * makes a GS1-128.
 */
export const FNC1 = 'ñ';
export const FNC2 = 'ò';
export const FNC3 = 'ó';
export const FNC4 = 'ô';

/** Preference when two encodings tie: B reads as text, C as a number. */
const TIE_BREAK: readonly Subset[] = ['B', 'C', 'A'];

const FUNCTION_VALUES: Record<string, Partial<Record<Subset, number>>> = {
  [FNC1]: { A: 102, B: 102, C: 102 },
  [FNC2]: { A: 97, B: 97 },
  [FNC3]: { A: 96, B: 96 },
  [FNC4]: { A: 101, B: 100 },
};

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

/** The symbol value for one character in a subset, or undefined if it has none. */
function valueIn(character: string, subset: Subset): number | undefined {
  const functionValue = FUNCTION_VALUES[character]?.[subset];
  if (functionValue !== undefined) return functionValue;

  const code = character.codePointAt(0)!;
  if (subset === 'A') {
    if (code >= 32 && code <= 95) return code - 32;
    if (code <= 31) return code + 64;
    return undefined;
  }
  if (subset === 'B') {
    if (code >= 32 && code <= 127) return code - 32;
    return undefined;
  }
  return undefined; // Subset C holds digit pairs, handled separately.
}

interface Step {
  /** Symbol values emitted at this step, before moving on. */
  readonly values: readonly number[];
  readonly consume: number;
  readonly next: Subset;
}

/**
 * Encodes to the shortest sequence of symbol values.
 *
 * `cost` is the best from here with the subset already active; `costNoSwitch`
 * is the same but forbidding an immediate further switch, which is what stops
 * the solver from bouncing A→B→A forever without ever consuming a character.
 */
function encodeValues(data: string): { values: number[]; start: Subset } {
  const characters = Array.from(data);
  const n = characters.length;
  const subsets: readonly Subset[] = ['A', 'B', 'C'];

  const cost: Record<Subset, number[]> = { A: [], B: [], C: [] };
  const costNoSwitch: Record<Subset, number[]> = { A: [], B: [], C: [] };
  const stepNoSwitch: Record<Subset, (Step | undefined)[]> = { A: [], B: [], C: [] };
  const switchTo: Record<Subset, (Subset | undefined)[]> = { A: [], B: [], C: [] };

  for (const subset of subsets) {
    cost[subset][n] = 0;
    costNoSwitch[subset][n] = 0;
  }

  for (let i = n - 1; i >= 0; i--) {
    const character = characters[i]!;

    for (const subset of subsets) {
      let best = Number.POSITIVE_INFINITY;
      let bestStep: Step | undefined;

      const consider = (step: Step, stepCost: number): void => {
        const total = stepCost + cost[step.next][i + step.consume]!;
        if (total < best) {
          best = total;
          bestStep = step;
        }
      };

      if (subset === 'C') {
        if (isDigit(character) && isDigit(characters[i + 1])) {
          const pair = Number(character) * 10 + Number(characters[i + 1]!);
          consider({ values: [pair], consume: 2, next: 'C' }, 1);
        }
        const functionValue = FUNCTION_VALUES[character]?.C;
        if (functionValue !== undefined) {
          consider({ values: [functionValue], consume: 1, next: 'C' }, 1);
        }
      } else {
        const direct = valueIn(character, subset);
        if (direct !== undefined) {
          consider({ values: [direct], consume: 1, next: subset }, 1);
        } else {
          // One character from the other alphabet is cheaper to shift than to
          // switch into and back out of.
          const other: Subset = subset === 'A' ? 'B' : 'A';
          const shifted = valueIn(character, other);
          if (shifted !== undefined) {
            consider({ values: [SHIFT, shifted], consume: 1, next: subset }, 2);
          }
        }
      }

      costNoSwitch[subset][i] = best;
      stepNoSwitch[subset][i] = bestStep;
    }

    for (const subset of subsets) {
      let best = costNoSwitch[subset][i]!;
      let target: Subset | undefined;
      for (const other of subsets) {
        if (other === subset) continue;
        const total = 1 + costNoSwitch[other][i]!;
        if (total < best) {
          best = total;
          target = other;
        }
      }
      cost[subset][i] = best;
      switchTo[subset][i] = target;
    }
  }

  let start: Subset | undefined;
  let startCost = Number.POSITIVE_INFINITY;
  for (const subset of TIE_BREAK) {
    const total = costNoSwitch[subset][0]!;
    if (total < startCost) {
      startCost = total;
      start = subset;
    }
  }
  if (start === undefined || !Number.isFinite(startCost)) {
    throw new BarcodeError('Code 128 cannot represent this data');
  }

  const values: number[] = [];
  let subset = start;
  let i = 0;
  while (i < n) {
    const target = switchTo[subset][i];
    if (target !== undefined && i > 0) {
      values.push(SWITCH[subset][target]!);
      subset = target;
    }
    const step = stepNoSwitch[subset][i];
    if (step === undefined) {
      throw new BarcodeError(
        `Code 128 cannot encode "${characters[i]!}" (code point ${characters[i]!.codePointAt(0)!})`,
      );
    }
    values.push(...step.values);
    i += step.consume;
    subset = step.next;
  }
  return { values, start };
}

export interface Code128Options {
  /**
   * Prefixes FNC1, making the symbol a GS1-128. The data is not otherwise
   * validated against GS1 application identifiers.
   */
  readonly gs1?: boolean;
  /**
   * Confines the encoding to one subset.
   *
   * Printers do not all choose subsets the same way: ZPL's ^BC in its default
   * mode stays in subset B whatever the data, and only its automatic mode looks
   * for the shortest encoding. Since a long run of digits is half as wide in
   * subset C, guessing wrong would show a barcode narrower than the one the
   * printer produces — and the whole point of the preview is answering whether
   * it fits.
   */
  readonly subset?: 'auto' | 'A' | 'B';
}

/** Encodes without ever leaving one subset, as ZPL's default mode does. */
function encodeInSubset(data: string, subset: 'A' | 'B'): { values: number[]; start: Subset } {
  const values: number[] = [];
  for (const character of data) {
    const value = valueIn(character, subset);
    if (value === undefined) {
      throw new BarcodeError(
        `Code 128 subset ${subset} cannot encode "${character}". ` +
          'Automatic subset selection would, if the printer allows it.',
      );
    }
    values.push(value);
  }
  return { values, start: subset };
}

export function encodeCode128(data: string, options: Code128Options = {}): LinearSymbol {
  if (data.length === 0) throw new BarcodeError('Code 128 needs at least one character');

  const payload = options.gs1 ? FNC1 + data : data;
  for (const character of payload) {
    const code = character.codePointAt(0)!;
    if (code > 127 && FUNCTION_VALUES[character] === undefined) {
      throw new BarcodeError(
        `Code 128 covers ASCII only; "${character}" is outside it. ` +
          'Use a 2D symbology for text like this.',
      );
    }
  }

  const { values, start } =
    options.subset === undefined || options.subset === 'auto'
      ? encodeValues(payload)
      : encodeInSubset(payload, options.subset);

  // Modulo 103 checksum, weighted by position with the start code as weight 1.
  let checksum = START[start];
  values.forEach((value, index) => {
    checksum += value * (index + 1);
  });
  checksum %= 103;

  const sequence = [START[start], ...values, checksum, STOP];
  const modules: boolean[] = [];
  for (const value of sequence) {
    modules.push(...patternToModules(PATTERNS[value]!));
  }

  return {
    symbology: 'code128',
    modules,
    quietZone: { left: 10, right: 10 },
    text: data,
  };
}
