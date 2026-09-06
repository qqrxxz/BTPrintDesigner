/**
 * Arithmetic over GF(256) and Reed-Solomon encoding.
 *
 * QR and Data Matrix both correct errors with Reed-Solomon over a 256-element
 * field, but they build that field from different primitive polynomials, so the
 * field is a parameter rather than a constant. Everything else — the generator
 * polynomial, the remainder that becomes the error-correction codewords — is
 * shared.
 */

export class GaloisField {
  private readonly exp: Uint8Array;
  private readonly log: Uint8Array;

  /**
   * @param primitive The primitive polynomial, as an integer above 0xFF.
   *   QR uses 0x11D, Data Matrix 0x12D.
   */
  constructor(readonly primitive: number) {
    this.exp = new Uint8Array(512);
    this.log = new Uint8Array(256);
    let value = 1;
    for (let i = 0; i < 255; i++) {
      this.exp[i] = value;
      this.log[value] = i;
      value <<= 1;
      if (value & 0x100) value ^= primitive;
    }
    // Doubling the exponent table lets multiply skip a modulo.
    for (let i = 255; i < 512; i++) this.exp[i] = this.exp[i - 255]!;
  }

  multiply(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return this.exp[this.log[a]! + this.log[b]!]!;
  }

  /** Alpha raised to a power; the field's generator element is 2. */
  power(exponent: number): number {
    return this.exp[exponent % 255]!;
  }
}

export const QR_FIELD = new GaloisField(0x11d);
export const DATA_MATRIX_FIELD = new GaloisField(0x12d);

const generatorCache = new Map<string, Uint8Array>();

/**
 * The generator polynomial for `degree` error-correction codewords: the product
 * of (x - alpha^i) for i below the degree, with coefficients high-order first.
 */
export function reedSolomonGenerator(field: GaloisField, degree: number): Uint8Array {
  const key = `${field.primitive}:${degree}`;
  const cached = generatorCache.get(key);
  if (cached) return cached;

  let generator = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(generator.length + 1);
    for (let j = 0; j < generator.length; j++) {
      next[j] = (next[j] ?? 0) ^ generator[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ field.multiply(generator[j]!, field.power(i));
    }
    generator = next;
  }
  generatorCache.set(key, generator);
  return generator;
}

/**
 * The error-correction codewords for one block: the remainder of the data
 * polynomial divided by the generator.
 */
export function reedSolomonRemainder(
  field: GaloisField,
  data: Uint8Array,
  degree: number,
): Uint8Array {
  const generator = reedSolomonGenerator(field, degree);
  const remainder = new Uint8Array(degree);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let i = 0; i < degree; i++) {
      remainder[i] = remainder[i]! ^ field.multiply(generator[i + 1]!, factor);
    }
  }
  return remainder;
}
