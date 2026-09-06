import type { Bitmap1 } from './Bitmap1.js';

/**
 * Minimal PNG writer for 1-bit images.
 *
 * A dependency-free encoder is worth the hundred lines here: it works
 * unchanged in Node, in Electron's renderer and in a browser, and it keeps the
 * preview byte-for-byte reproducible, which is what makes golden-image tests
 * meaningful. Compression uses stored deflate blocks — a label is small, and
 * trading a few kilobytes for zero dependencies is the right way round.
 */

export interface PngOptions {
  /** Each dot becomes a scale x scale block of pixels. */
  scale?: number;
}

export function encodePng(bitmap: Bitmap1, options: PngOptions = {}): Uint8Array {
  const scale = Math.max(1, Math.trunc(options.scale ?? 1));
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const rowBytes = (width + 7) >> 3;

  // PNG greyscale at one bit per pixel: 0 is black, 1 is white, so a burnt dot
  // is a cleared bit.
  const raw = new Uint8Array((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter type: none
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      if (bitmap.get(Math.floor(x / scale), sourceY) === 0) {
        raw[rowStart + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 1; // bit depth
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace

  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib stream made of uncompressed deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const maxBlock = 0xffff;
  const blockCount = Math.max(1, Math.ceil(data.length / maxBlock));
  const out = new Uint8Array(2 + data.length + blockCount * 5 + 4);
  let at = 0;
  out[at++] = 0x78; // deflate, 32K window
  out[at++] = 0x01; // no preset dictionary, fastest level

  for (let offset = 0; offset < data.length || offset === 0; offset += maxBlock) {
    const length = Math.min(maxBlock, data.length - offset);
    const final = offset + length >= data.length ? 1 : 0;
    out[at++] = final;
    out[at++] = length & 0xff;
    out[at++] = (length >> 8) & 0xff;
    out[at++] = ~length & 0xff;
    out[at++] = (~length >> 8) & 0xff;
    out.set(data.subarray(offset, offset + length), at);
    at += length;
    if (final) break;
  }

  const adler = adler32(data);
  out[at++] = (adler >>> 24) & 0xff;
  out[at++] = (adler >>> 16) & 0xff;
  out[at++] = (adler >>> 8) & 0xff;
  out[at++] = adler & 0xff;
  return out.subarray(0, at);
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
