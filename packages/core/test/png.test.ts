import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Bitmap1 } from '../src/bitmap/Bitmap1.js';
import { encodePng } from '../src/bitmap/png.js';

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

/** Walks the chunk list and checks every CRC on the way through. */
function readChunks(png: Uint8Array): Chunk[] {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    const declared = view.getUint32(at + 8 + length);
    expect(declared).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    chunks.push({ type, data });
    at += 12 + length;
  }
  return chunks;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe('png encoding', () => {
  const source = Bitmap1.fromAsciiArt(['#.#.', '.##.', '....'].join('\n'));

  it('writes a well-formed 1-bit greyscale file', () => {
    const chunks = readChunks(encodePng(source));
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const header = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset);
    expect(header.getUint32(0)).toBe(4);
    expect(header.getUint32(4)).toBe(3);
    expect(chunks[0]!.data[8]).toBe(1); // bit depth
    expect(chunks[0]!.data[9]).toBe(0); // greyscale
  });

  it('produces a stream a real inflater accepts', () => {
    const chunks = readChunks(encodePng(source));
    const raw = inflateSync(Buffer.from(chunks[1]!.data));
    // One filter byte plus one packed byte per row for a 4-pixel-wide image.
    expect(raw.length).toBe(3 * 2);
    expect(raw[0]).toBe(0); // filter: none
    // A burnt dot is black, which is a cleared bit in greyscale PNG. The four
    // low bits of each byte are past the image width and are ignored by
    // decoders; the encoder leaves them clear.
    expect(raw[1]).toBe(0b0101_0000);
    expect(raw[3]).toBe(0b1001_0000);
    expect(raw[5]).toBe(0b1111_0000);
  });

  it('scales each dot into a block of pixels', () => {
    const png = encodePng(source, { scale: 3 });
    const header = readChunks(png)[0]!.data;
    const view = new DataView(header.buffer, header.byteOffset);
    expect(view.getUint32(0)).toBe(12);
    expect(view.getUint32(4)).toBe(9);
  });

  it('is byte-for-byte stable across runs', () => {
    expect(Array.from(encodePng(source))).toEqual(Array.from(encodePng(source)));
  });

  it('handles a label-sized bitmap without truncating the stream', () => {
    const large = new Bitmap1(812, 1218);
    large.fillRect(10, 10, 700, 1100);
    const chunks = readChunks(encodePng(large));
    const raw = inflateSync(Buffer.from(chunks[1]!.data));
    expect(raw.length).toBe((Math.ceil(812 / 8) + 1) * 1218);
  });
});
