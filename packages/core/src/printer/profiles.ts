import type { Dpi } from '../util/units.js';

/**
 * Printer profiles.
 *
 * A profile answers the two questions a design needs settled before code can be
 * generated: how many dots to the millimetre, and how wide the head is. Model
 * names are here so the choice reads like the printer on the desk rather than a
 * number, but the numbers are what the program uses.
 *
 * The widths are the nominal print widths from each vendor's data sheets, and
 * they are a guide rather than a guarantee — media, firmware and margins all
 * move the real figure. Anything the shipped list gets wrong is meant to be
 * corrected by the user: profiles are ordinary data, and `customProfile` builds
 * one from scratch.
 */

export type PrinterLanguage = 'tspl' | 'zpl' | 'cpcl';

export interface PrinterProfile {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  readonly dpi: Dpi;
  /** Nominal maximum print width in millimetres. */
  readonly maxWidthMm: number;
  /** Languages the printer accepts; the first is its native one. */
  readonly languages: readonly PrinterLanguage[];
  /** True for battery-powered printers, which is why this project exists. */
  readonly mobile?: boolean;
}

function profile(
  id: string,
  vendor: string,
  model: string,
  dpi: Dpi,
  maxWidthMm: number,
  languages: readonly PrinterLanguage[],
  mobile = false,
): PrinterProfile {
  return { id, vendor, model, dpi, maxWidthMm, languages, ...(mobile ? { mobile } : {}) };
}

export const PRINTER_PROFILES: readonly PrinterProfile[] = [
  // TSC — TSPL is the native language across the range.
  profile('tsc-te200', 'TSC', 'TE200', 203, 108, ['tspl']),
  profile('tsc-te300', 'TSC', 'TE300', 300, 105.7, ['tspl']),
  profile('tsc-ttp-244-pro', 'TSC', 'TTP-244 Pro', 203, 108, ['tspl']),
  profile('tsc-ttp-247', 'TSC', 'TTP-247', 203, 104, ['tspl']),
  profile('tsc-ttp-345', 'TSC', 'TTP-345', 300, 105.7, ['tspl']),
  profile('tsc-da210', 'TSC', 'DA210', 203, 108, ['tspl']),
  profile('tsc-mh241', 'TSC', 'MH241', 203, 104, ['tspl']),
  profile('tsc-tdp-225', 'TSC', 'TDP-225', 203, 54, ['tspl']),
  profile('tsc-alpha-3r', 'TSC', 'Alpha-3R', 203, 72, ['tspl'], true),
  profile('tsc-alpha-4l', 'TSC', 'Alpha-4L', 203, 104, ['tspl'], true),

  // Zebra — ZPL native, with CPCL on the mobile range.
  profile('zebra-zd220', 'Zebra', 'ZD220', 203, 104, ['zpl']),
  profile('zebra-zd421-203', 'Zebra', 'ZD421 203 dpi', 203, 104, ['zpl']),
  profile('zebra-zd421-300', 'Zebra', 'ZD421 300 dpi', 300, 104, ['zpl']),
  profile('zebra-zd621-203', 'Zebra', 'ZD621 203 dpi', 203, 104, ['zpl']),
  profile('zebra-zd621-300', 'Zebra', 'ZD621 300 dpi', 300, 104, ['zpl']),
  profile('zebra-zt411-203', 'Zebra', 'ZT411 203 dpi', 203, 104, ['zpl']),
  profile('zebra-zt411-300', 'Zebra', 'ZT411 300 dpi', 300, 104, ['zpl']),
  profile('zebra-zt411-600', 'Zebra', 'ZT411 600 dpi', 600, 104, ['zpl']),
  profile('zebra-zq320', 'Zebra', 'ZQ320', 203, 72, ['cpcl', 'zpl'], true),
  profile('zebra-zq520', 'Zebra', 'ZQ520', 203, 104, ['cpcl', 'zpl'], true),

  // Resolution-only fallbacks, for a printer that is not on the list.
  profile('generic-203', 'Generic', '203 dpi, 104 mm', 203, 104, ['tspl', 'zpl', 'cpcl']),
  profile('generic-300', 'Generic', '300 dpi, 104 mm', 300, 104, ['tspl', 'zpl', 'cpcl']),
  profile('generic-600', 'Generic', '600 dpi, 104 mm', 600, 104, ['tspl', 'zpl', 'cpcl']),
];

export const DEFAULT_PROFILE_ID = 'tsc-te200';

export function findProfile(id: string): PrinterProfile | undefined {
  return PRINTER_PROFILES.find((candidate) => candidate.id === id);
}

export function profilesForLanguage(language: PrinterLanguage): PrinterProfile[] {
  return PRINTER_PROFILES.filter((candidate) => candidate.languages.includes(language));
}

/** Builds a profile for a printer the list does not name. */
export function customProfile(
  dpi: Dpi,
  maxWidthMm: number,
  languages: readonly PrinterLanguage[] = ['tspl'],
): PrinterProfile {
  return {
    id: `custom-${dpi}-${Math.round(maxWidthMm)}`,
    vendor: 'Custom',
    model: `${dpi} dpi, ${maxWidthMm} mm`,
    dpi,
    maxWidthMm,
    languages,
  };
}

export interface WidthCheck {
  readonly fits: boolean;
  readonly overflowMm: number;
}

/** Whether a label of this width fits the head, and by how much it does not. */
export function checkLabelWidth(profile: PrinterProfile, widthMm: number): WidthCheck {
  const overflow = widthMm - profile.maxWidthMm;
  return { fits: overflow <= 0, overflowMm: overflow > 0 ? Math.round(overflow * 100) / 100 : 0 };
}
