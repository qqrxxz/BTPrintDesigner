/**
 * The templates DataMobile ships, bundled to start from.
 *
 * These are the vendor's own stock templates, one copy of each — the same file
 * appears under several operations in the product, and here it is listed under
 * all of them instead. They are read the way any other printer file is read,
 * through the importer, so what opens is an editable design rather than a
 * special case.
 *
 * Three of the vendor's files are left out: one Godex EZPL and two Honeywell
 * Fingerprint, languages this program does not speak. A template that opened
 * as forty complaints would not be a template.
 */
import type { DataMobileOperation, PrinterLanguage } from '@btpd/core';

export interface StockTemplate {
  /** The vendor's own file name, which is what a reader recognises. */
  readonly file: string;
  readonly language: PrinterLanguage;
  readonly operations: readonly DataMobileOperation[];
  /** Label size in millimetres, when the name says. */
  readonly size?: string;
  /** The printer the vendor made it for. */
  readonly printer: string;
}

const CATALOGUE: readonly StockTemplate[] = [
  {
    file: 'art_CPCL.prn',
    language: 'cpcl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    printer: 'Zebra',
  },
  {
    file: 'art_CPCL_58x40_Mertech.prn',
    language: 'cpcl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    size: '58×40',
    printer: 'Mertech',
  },
  {
    file: 'art_CPCL_58x40_offset_Mertech.prn',
    language: 'cpcl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    size: '58×40',
    printer: 'Mertech',
  },
  {
    file: 'art_CPCL_72x30_Mertech.prn',
    language: 'cpcl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    size: '72×30',
    printer: 'Mertech',
  },
  {
    file: 'art_TCPL_80х50_Alpha.prn',
    language: 'tspl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    size: '80×50',
    printer: 'Alpha',
  },
  {
    file: 'art_TSPL_43x25_TSC.prn',
    language: 'tspl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    size: '43×25',
    printer: 'TSC',
  },
  {
    file: 'art_TSPL_58x40_TSC.prn',
    language: 'tspl',
    operations: ['art', 'art_in_doc', 'copybarcode', 'promoart'],
    size: '58×40',
    printer: 'TSC',
  },
  {
    file: 'copybarcode_TSPL_80х50_TSC.prn',
    language: 'tspl',
    operations: ['copybarcode', 'upl'],
    size: '80×50',
    printer: 'TSC',
  },
  {
    file: 'doc_TSPL_80х50_TSC.prq',
    language: 'tspl',
    operations: ['doc'],
    size: '80×50',
    printer: 'TSC',
  },
  {
    file: 'doc_TSPL_80х80_QRMask_TSC.prq',
    language: 'tspl',
    operations: ['doc'],
    size: '80×80',
    printer: 'TSC',
  },
  {
    file: 'km_TSPL_42х40_KM_TSC.prn',
    language: 'tspl',
    operations: ['km'],
    size: '42×40',
    printer: 'TSC',
  },
  {
    file: 'art_ZPL_58x40_Bixolon.prn',
    language: 'zpl',
    operations: ['art'],
    size: '58×40',
    printer: 'Bixolon',
  },
  {
    file: 'art_ZPL_58x40_Godex.prn',
    language: 'zpl',
    operations: ['art'],
    size: '58×40',
    printer: 'Godex',
  },
  {
    file: 'art_ZPL_75x30_Mertech.prn',
    language: 'zpl',
    operations: ['art'],
    size: '75×30',
    printer: 'Mertech',
  },
  {
    file: 'art_ZPL_Zebra_QLN220.prq',
    language: 'zpl',
    operations: ['art', 'art_in_doc', 'copybarcode'],
    printer: 'Zebra QLN220',
  },
  {
    file: 'doc_ZPL_QRMask_Zebra_QLN220.prq',
    language: 'zpl',
    operations: ['doc'],
    printer: 'Zebra QLN220',
  },
];

/** The files themselves, bundled at build time rather than fetched. */
const SOURCES = import.meta.glob('../templates/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function sourceOf(file: string): string {
  const path = Object.keys(SOURCES).find((key) => key.endsWith(`/${file}`));
  return path === undefined ? '' : SOURCES[path]!;
}

export const STOCK_TEMPLATES: readonly (StockTemplate & { readonly source: string })[] =
  CATALOGUE.map((entry) => ({ ...entry, source: sourceOf(entry.file) }));

/** The templates offered for an operation, or all of them for "any". */
export function templatesFor(
  operation: DataMobileOperation | undefined,
): readonly (StockTemplate & { readonly source: string })[] {
  if (operation === undefined || operation === 'all') return STOCK_TEMPLATES;
  return STOCK_TEMPLATES.filter((entry) => entry.operations.includes(operation));
}
