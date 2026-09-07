import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library';
import type { Bitmap1 } from '../../src/bitmap/Bitmap1.js';

/**
 * Decodes one of our bitmaps with ZXing.
 *
 * This is the only check that actually matters for a barcode: not that the
 * modules match a table we typed in, but that an independent decoder reads back
 * the string we encoded. A wrong pattern, a wrong checksum or a wrong subset
 * switch all show up here as a failure to decode.
 */
export function decode(
  bitmap: Bitmap1,
  formats?: BarcodeFormat[],
  /**
   * ITF carries no length information, so ZXing refuses lengths outside a
   * default set rather than risk reporting a partial scan. Short symbols have
   * to say up front how long they are.
   */
  allowedLengths?: number[],
): string {
  // ZXing wants a luminance plane; a burnt dot is black.
  const luminances = new Uint8ClampedArray(bitmap.width * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      luminances[y * bitmap.width + x] = bitmap.get(x, y) ? 0 : 255;
    }
  }
  const source = new RGBLuminanceSource(luminances, bitmap.width, bitmap.height);
  const binary = new BinaryBitmap(new HybridBinarizer(source));

  const reader = new MultiFormatReader();
  const hints = new Map<DecodeHintType, unknown>();
  if (formats) hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  if (allowedLengths) hints.set(DecodeHintType.ALLOWED_LENGTHS, allowedLengths);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);

  return reader.decode(binary).getText();
}

/**
 * Decodes a symbol at a known place on a larger image.
 *
 * ZXing's Data Matrix detector starts its search at the centre of the image and
 * expands outward, so a small symbol in the corner of a big label is invisible
 * to it however crisp it is. That is a limit of the reader, not of the symbol:
 * the same modules decode as soon as the image is cropped around them. Tests
 * that place a symbol on a full label therefore say where it is.
 */
export function decodeRegion(
  bitmap: Bitmap1,
  region: { x: number; y: number; width: number; height: number },
  formats?: BarcodeFormat[],
  margin = 8,
): string {
  return decode(
    bitmap.crop(
      region.x - margin,
      region.y - margin,
      region.width + margin * 2,
      region.height + margin * 2,
    ),
    formats,
  );
}

export { BarcodeFormat };
