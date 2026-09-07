/**
 * @btpd/core — the language-agnostic rendering core.
 *
 * Everything a printer language needs in order to turn commands into the
 * one-bit image a thermal head will burn, and nothing about any particular
 * language. ZPL, TSPL and CPCL front-ends all sit on top of this.
 */

export { Bitmap1 } from './bitmap/Bitmap1.js';
export type { DrawMode, Rotation } from './bitmap/Bitmap1.js';
export { encodePng } from './bitmap/png.js';
export type { PngOptions } from './bitmap/png.js';

export { encodeCode128, FNC1, FNC2, FNC3, FNC4 } from './barcode/code128.js';
export type { Code128Options } from './barcode/code128.js';
export { encodeCode39 } from './barcode/code39.js';
export type { Code39Options } from './barcode/code39.js';
export { encodeItf, encodeItf14, itfCheckDigit } from './barcode/itf.js';
export type { ItfOptions } from './barcode/itf.js';
export {
  eanCheckDigit,
  encodeEan13,
  encodeEan8,
  encodeUpcA,
  encodeUpcE,
  upcEToUpcA,
} from './barcode/ean.js';
export type { UpcEOptions } from './barcode/ean.js';
export { drawLinear, linearWidthDots, renderLinear } from './barcode/render.js';
export { drawMatrix, matrixModule, renderMatrix } from './barcode/matrix.js';
export type { MatrixRenderOptions, MatrixSymbol, MatrixSymbology } from './barcode/matrix.js';
export { encodePdf417 } from './barcode/pdf417/encode.js';
export type { Pdf417ErrorCorrection, Pdf417Options } from './barcode/pdf417/encode.js';
export { encodeDataMatrix } from './barcode/datamatrix/encode.js';
export type { DataMatrixOptions } from './barcode/datamatrix/encode.js';
export type { SymbolShape, SymbolSize } from './barcode/datamatrix/tables.js';
export { encodeQr } from './barcode/qr/encode.js';
export type { QrMode, QrOptions } from './barcode/qr/encode.js';
export type { ErrorCorrectionLevel } from './barcode/qr/tables.js';
export { GaloisField, QR_FIELD, DATA_MATRIX_FIELD, reedSolomonRemainder } from './barcode/galois.js';
export type { LinearRenderOptions } from './barcode/render.js';
export { BarcodeError, patternToModules } from './barcode/types.js';
export type { HriGroup, LinearSymbol, LinearSymbology, QuietZone } from './barcode/types.js';

export { CoverageAccumulator } from './raster/CoverageAccumulator.js';
export { Path } from './raster/Path.js';
export type { PathCommand } from './raster/Path.js';
export { fillPath, rasterizePath } from './raster/fill.js';
export type { FillOptions } from './raster/fill.js';
export {
  drawLine,
  ellipsePath,
  fillCircle,
  fillEllipse,
  fillRectangle,
  fillRoundedRectangle,
  roundedRectPath,
  roundedRectangle,
  strokeCircle,
  strokeEllipse,
  strokeRectangle,
} from './raster/primitives.js';
export type { StrokeOptions } from './raster/primitives.js';

export { Font } from './text/Font.js';
export type { Glyph } from './text/Font.js';
export { drawText, drawTextWithMode, measureText, textToPath } from './text/text.js';
export type { DrawTextOptions, TextAnchor, TextMetrics, TextStyle } from './text/text.js';

export * from './tspl/index.js';

export {
  DATAMOBILE_GROUPS,
  DATAMOBILE_OPERATIONS,
  DATAMOBILE_PATTERN,
  DATAMOBILE_VARIABLES,
  defaultContent,
  findVariable,
  findVariablesIn,
  isAvailable,
  operationName,
  sampleFor,
  variablesFor,
} from './datamobile/variables.js';
export type {
  DataMobileOperation,
  DataMobileVariable,
  OperationInfo,
  VariableGroup,
} from './datamobile/variables.js';

export { numberAt, parseCpcl, tailFrom, wordAt } from './cpcl/parse.js';
export type { CpclCommand, CpclParseResult } from './cpcl/parse.js';
export { renderCpcl } from './cpcl/execute.js';
export type { CpclLabel, CpclRenderOptions, CpclRenderResult } from './cpcl/execute.js';
export { DEFAULT_SIZE_LADDER, resolveCpclFont, SIZE_IS_HEIGHT_FROM } from './cpcl/fonts.js';
export type { CpclFontOptions, CpclFontSet, ResolvedCpclFont } from './cpcl/fonts.js';
export { generateCpcl } from './generate/cpcl.js';
export type { CpclGenerateOptions, CpclGenerateResult } from './generate/cpcl.js';
export { importCpcl } from './import/cpcl.js';
export type { CpclImportOptions, CpclImportResult } from './import/cpcl.js';

export { parseZpl, letterParameter, numberParameter } from './zpl/parse.js';
export type { ZplCommand, ZplParseResult, ZplPrefix } from './zpl/parse.js';
export { renderZpl } from './zpl/execute.js';
export type { ZplLabel, ZplRenderOptions, ZplRenderResult } from './zpl/execute.js';
export { resolveZplFont, ZPL_FONTS } from './zpl/fonts.js';
export type { ResolvedZplFont, ZplFontCell, ZplFontSet } from './zpl/fonts.js';
export { generateZpl } from './generate/zpl.js';
export type { ZplGenerateOptions, ZplGenerateResult } from './generate/zpl.js';
export { importZpl } from './import/zpl.js';
export type { ZplImportOptions, ZplImportResult } from './import/zpl.js';
export type { SubstituteFonts } from './text/substitutes.js';

export {
  checkLabelWidth,
  customProfile,
  DEFAULT_PROFILE_ID,
  findProfile,
  PRINTER_PROFILES,
  profilesForLanguage,
} from './printer/profiles.js';
export type { PrinterLanguage, PrinterProfile, WidthCheck } from './printer/profiles.js';

export { createDocument, DOCUMENT_VERSION, elementBounds } from './model/document.js';
export type {
  BarcodeElement,
  ElementBase,
  LabelDocument,
  LabelElement,
  LineElement,
  MatrixElement,
  RectangleElement,
  TextAlignment,
  TextElement,
  RectangleFill,
  TextStyleSpec,
} from './model/document.js';
export type {
  LinearSymbology as ModelLinearSymbology,
  MatrixSymbology as ModelMatrixSymbology,
} from './model/document.js';
export {
  collectVariables,
  documentPlaceholders,
  documentVariables,
  elementText,
  findPlaceholders,
  substitute,
  substituteVariables,
  unavailableVariables,
} from './model/placeholders.js';
export type { SubstitutionResult, VariableUse } from './model/placeholders.js';
export type { ResolveOptions, TextResolution } from './generate/shared.js';
export { parseDocument, serializeDocument } from './model/validate.js';
export type { DocumentParseResult, ValidationIssue } from './model/validate.js';
export { generateTspl } from './generate/tspl.js';
export { importTspl } from './import/tspl.js';
export type {
  ImportMode,
  TsplImportOptions,
  TsplImportResult,
  UnmappedCommand,
} from './import/tspl.js';
export type {
  GenerationIssue,
  TsplGenerateOptions,
  TsplGenerateResult,
} from './generate/tspl.js';

export {
  applyMatrix,
  clamp,
  compose,
  IDENTITY,
  multiply,
  rotation,
  scaling,
  translation,
} from './util/geometry.js';
export type { Matrix, Point, Rect } from './util/geometry.js';

export {
  dotsPerMm,
  dotsToInch,
  dotsToMm,
  inchToDots,
  isDpi,
  MM_PER_INCH,
  mmToDots,
  mmToDotsAtLeastOne,
  mmToDotsRounded,
  SUPPORTED_DPI,
} from './util/units.js';
export type { Dpi } from './util/units.js';
