/**
 * Which of a job's labels is the design.
 *
 * A file can carry a job that draws nothing before the one that does: CPCL's
 * `! UTILITIES` session that sets the printer up, ZPL's `^XA^CW…^XZ` that
 * registers a font. The importers already treat such a job as setup. The
 * preview has to agree — showing the first label of the file showed a blank
 * sheet for three of the vendor's own templates.
 */
import type { Bitmap1 } from '../bitmap/Bitmap1.js';

export function hasInk(bitmap: Bitmap1): boolean {
  return bitmap.data.some((byte) => byte !== 0);
}

/** The first label with something on it, or the first label when none has. */
export function principalLabel<T extends { readonly bitmap: Bitmap1 }>(
  labels: readonly T[],
): T | undefined {
  return labels.find((label) => hasInk(label.bitmap)) ?? labels[0];
}
