/**
 * Unit conversions.
 *
 * The document model stores geometry in millimetres so that a layout survives
 * being retargeted from a 203 dpi printer to a 300 or 600 dpi one. Dots only
 * appear at rasterisation time, where every measurement is snapped to the
 * device grid.
 */

/** Resolutions we target. Zebra and TSC hardware comes in these three. */
export type Dpi = 203 | 300 | 600;

export const SUPPORTED_DPI: readonly Dpi[] = [203, 300, 600];

export const MM_PER_INCH = 25.4;

export function isDpi(value: number): value is Dpi {
  return (SUPPORTED_DPI as readonly number[]).includes(value);
}

/** Dots per millimetre. 203 dpi is the familiar "8 dots/mm" (7.992, really). */
export function dotsPerMm(dpi: Dpi): number {
  return dpi / MM_PER_INCH;
}

/** Millimetres to dots, unrounded — round at the last possible moment. */
export function mmToDots(mm: number, dpi: Dpi): number {
  return mm * dotsPerMm(dpi);
}

export function dotsToMm(dots: number, dpi: Dpi): number {
  return dots / dotsPerMm(dpi);
}

export function inchToDots(inch: number, dpi: Dpi): number {
  return inch * dpi;
}

export function dotsToInch(dots: number, dpi: Dpi): number {
  return dots / dpi;
}

/**
 * Snaps a millimetre measurement to a whole dot.
 *
 * Element positions round to nearest, but a length rounds up to at least one
 * dot: a hairline that rounds to zero would silently disappear from the label,
 * which is exactly the class of surprise the preview exists to prevent.
 */
export function mmToDotsRounded(mm: number, dpi: Dpi): number {
  return Math.round(mmToDots(mm, dpi));
}

export function mmToDotsAtLeastOne(mm: number, dpi: Dpi): number {
  return Math.max(1, Math.round(mmToDots(mm, dpi)));
}
