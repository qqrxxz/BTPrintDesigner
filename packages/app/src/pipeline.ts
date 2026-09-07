import {
  Font,
  generateCpcl,
  generateTspl,
  generateZpl,
  importCpcl,
  importTspl,
  importZpl,
  renderCpcl,
  renderTspl,
  renderZpl,
  type Bitmap1,
  type CommandBounds,
  type Diagnostic,
  type GenerationIssue,
  type LabelDocument,
  type PrinterLanguage,
  type PrinterProfile,
  type TsplFontSet,
  type TsplImportResult,
} from '@btpd/core';
import boldFontUrl from '../../core/assets/fonts/DejaVuSansCondensed-Bold.ttf?url';
import monoFontUrl from '../../core/assets/fonts/DejaVuSansMono.ttf?url';

/**
 * The preview pipeline.
 *
 * Always document to code to image, never document to image. What appears on
 * screen is therefore rasterised from exactly the text that would reach the
 * printer, which is the only way a preview can be trusted.
 */

export interface Preview {
  readonly code: string;
  readonly bitmap: Bitmap1;
  readonly bounds: readonly CommandBounds[];
  /** Element id to the line of code it produced. */
  readonly origins: Readonly<Record<string, number>>;
  readonly diagnostics: readonly Diagnostic[];
  readonly issues: readonly GenerationIssue[];
}

let fonts: TsplFontSet | undefined;

/** Loads the substitute faces once; both are bundled with the app. */
export async function loadFonts(): Promise<TsplFontSet> {
  if (fonts) return fonts;
  const [bold, mono] = await Promise.all([
    fetch(boldFontUrl).then((response) => response.arrayBuffer()),
    fetch(monoFontUrl).then((response) => response.arrayBuffer()),
  ]);
  fonts = { scalable: Font.fromBuffer(bold), fixed: Font.fromBuffer(mono) };
  return fonts;
}

function blank(): Bitmap1 {
  // The renderer always produces a label, so this is only reached before the
  // fonts have loaded.
  throw new Error('fonts are not loaded yet');
}

/**
 * The language a profile speaks.
 *
 * A printer's own language is the first one it lists, and choosing the printer
 * is how the designer chooses the dialect: picking a Zebra and being handed
 * TSPL would be a bug, not a preference.
 */
export function languageOf(profile: PrinterProfile): PrinterLanguage {
  return profile.languages[0] ?? 'tspl';
}

/**
 * The extension a printer file of this language is usually given.
 *
 * All three are plain text, but a file that reaches a printer or a piece of
 * middleware is expected to be named this way, and a `.tspl` nobody recognises
 * is one more thing to explain.
 */
export const FILE_EXTENSIONS: Readonly<Record<PrinterLanguage, string>> = {
  tspl: 'prn',
  zpl: 'prq',
  cpcl: 'lbl',
};

export function generateFor(
  profile: PrinterProfile,
  document: LabelDocument,
  /**
   * Fills DataMobile variables in with sample values.
   *
   * The template that is exported keeps them; only the copy that becomes the
   * picture has them filled in, because a label showing `@Barcode@` would be
   * judged at the wrong width.
   */
  resolveVariables = false,
): { source: string; issues: Preview['issues']; origins: Preview['origins'] } {
  const options = { dpi: profile.dpi, resolveVariables };
  switch (languageOf(profile)) {
    case 'zpl':
      return generateZpl(document, options);
    case 'cpcl':
      return generateCpcl(document, options);
    default:
      return generateTspl(document, options);
  }
}

export function renderFor(
  profile: PrinterProfile,
  code: string,
  fontSet: TsplFontSet,
  size: { widthMm: number; heightMm: number },
): { bitmap: Bitmap1; bounds: Preview['bounds']; diagnostics: Preview['diagnostics'] } {
  const language = languageOf(profile);
  const perMm = profile.dpi / 25.4;

  if (language === 'cpcl') {
    // CPCL counts in dots and takes its height from the job header, so the
    // designed width is the fallback the interpreter needs.
    const rendered = renderCpcl(code, {
      fonts: fontSet,
      dpi: profile.dpi,
      defaultWidthDots: Math.round(size.widthMm * perMm),
    });
    return {
      bitmap: rendered.labels[0]?.bitmap ?? blank(),
      bounds: rendered.bounds,
      diagnostics: rendered.diagnostics,
    };
  }

  if (language === 'zpl') {
    const rendered = renderZpl(code, {
      fonts: fontSet,
      dpi: profile.dpi,
      // ZPL counts in dots and a job need not declare its size, so the label
      // the designer set is the fallback.
      defaultWidthDots: Math.round(size.widthMm * perMm),
      defaultHeightDots: Math.round(size.heightMm * perMm),
    });
    return {
      bitmap: rendered.labels[0]?.bitmap ?? blank(),
      bounds: rendered.bounds,
      diagnostics: rendered.diagnostics,
    };
  }
  const rendered = renderTspl(code, { fonts: fontSet, dpi: profile.dpi });
  return {
    bitmap: rendered.labels[0]?.bitmap ?? blank(),
    bounds: rendered.bounds,
    diagnostics: rendered.diagnostics,
  };
}

export function importFor(profile: PrinterProfile, code: string): TsplImportResult {
  const options = { dpi: profile.dpi };
  switch (languageOf(profile)) {
    case 'zpl':
      return importZpl(code, options);
    case 'cpcl':
      return importCpcl(code, options);
    default:
      return importTspl(code, options);
  }
}

export function previewFromDocument(
  document: LabelDocument,
  profile: PrinterProfile,
  fontSet: TsplFontSet,
): Preview {
  const generated = generateFor(profile, document);
  const rendered = renderFor(profile, generateFor(profile, document, true).source, fontSet, {
    widthMm: document.width,
    heightMm: document.height,
  });
  return {
    code: generated.source,
    bitmap: rendered.bitmap,
    bounds: rendered.bounds,
    origins: generated.origins,
    diagnostics: rendered.diagnostics,
    issues: generated.issues,
  };
}

export interface CodePreview {
  readonly preview: Preview;
  readonly imported: TsplImportResult;
}

export function previewFromCode(
  code: string,
  profile: PrinterProfile,
  fontSet: TsplFontSet,
  size: { widthMm: number; heightMm: number },
): CodePreview {
  const rendered = renderFor(profile, code, fontSet, size);
  const imported = importFor(profile, code);
  // Line numbers in the source are what tie an element to its outline, and the
  // importer records exactly that.
  const origins: Record<string, number> = {};
  for (const [id, span] of Object.entries(imported.origins)) origins[id] = span.line;

  return {
    preview: {
      code,
      bitmap: rendered.bitmap,
      bounds: rendered.bounds,
      origins,
      diagnostics: rendered.diagnostics,
      issues: [],
    },
    imported,
  };
}

/** Paints a one-bit label onto a canvas at one device pixel per dot. */
export function paint(canvas: HTMLCanvasElement, bitmap: Bitmap1): void {
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) return;

  const image = context.createImageData(bitmap.width, bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const at = (y * bitmap.width + x) * 4;
      const value = bitmap.get(x, y) ? 0 : 255;
      image.data[at] = value;
      image.data[at + 1] = value;
      image.data[at + 2] = value;
      image.data[at + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}
