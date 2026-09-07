import { inflateSync } from 'node:zlib';
import { Bitmap1 } from '../../src/bitmap/Bitmap1.js';

/**
 * A PNG reader for golden images.
 *
 * Only what Labelary produces is supported: eight-bit greyscale or RGB, not
 * interlaced. It exists so a reference rendering can be compared with ours
 * without pulling an image library into the project for the sake of the tests.
 */

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

function chunks(png: Uint8Array): Chunk[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: Chunk[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    found.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return found;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** One byte per pixel: the luminance. */
  readonly grey: Uint8Array;
}

export function decodePng(png: Uint8Array): DecodedPng {
  const parts = chunks(png);
  const header = parts.find((chunk) => chunk.type === 'IHDR');
  if (!header) throw new Error('not a PNG');

  const view = new DataView(header.data.buffer, header.data.byteOffset);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const depth = header.data[8]!;
  const colour = header.data[9]!;
  const interlace = header.data[12]!;

  if (depth !== 8 || interlace !== 0 || (colour !== 0 && colour !== 2 && colour !== 6)) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${colour}`);
  }
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : 4;

  const compressed = parts
    .filter((chunk) => chunk.type === 'IDAT')
    .map((chunk) => Buffer.from(chunk.data));
  const raw = inflateSync(Buffer.concat(compressed));

  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]!;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const value = raw[at++]!;
      const left = i >= channels ? pixels[row + i - channels]! : 0;
      const up = y > 0 ? pixels[row - stride + i]! : 0;
      const upLeft = y > 0 && i >= channels ? pixels[row - stride + i - channels]! : 0;
      let restored = value;
      if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) restored = value + paeth(left, up, upLeft);
      pixels[row + i] = restored & 0xff;
    }
  }

  const grey = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1) grey[i] = pixels[i]!;
    else {
      const at_ = i * channels;
      // Labelary renders black on white, so any channel would do; the average
      // keeps this honest if a source ever hands back colour.
      grey[i] = Math.round((pixels[at_]! + pixels[at_ + 1]! + pixels[at_ + 2]!) / 3);
    }
  }
  return { width, height, grey };
}

/** Turns a decoded image into dots, treating anything not near white as ink. */
export function toBitmap(image: DecodedPng, threshold = 128): Bitmap1 {
  const bitmap = new Bitmap1(image.width, image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.grey[y * image.width + x]! < threshold) bitmap.set(x, y, 1);
    }
  }
  return bitmap;
}

export interface Comparison {
  readonly differing: number;
  readonly total: number;
  /** Share of dots that agree, from zero to one. */
  readonly agreement: number;
  /** First disagreement, for a message that says where to look. */
  readonly firstDifference?: { x: number; y: number };
}

export function compare(a: Bitmap1, b: Bitmap1): Comparison {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  let differing = 0;
  let first: { x: number; y: number } | undefined;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (a.get(x, y) !== b.get(x, y)) {
        differing++;
        first ??= { x, y };
      }
    }
  }
  const total = width * height;
  return {
    differing,
    total,
    agreement: total === 0 ? 1 : 1 - differing / total,
    ...(first === undefined ? {} : { firstDifference: first }),
  };
}
