# @btpd/core

The rendering core of BTPrintDesigner: everything needed to turn a label
description into the one-bit image a thermal head will burn, and nothing about
any particular printer language. The ZPL, TSPL and CPCL front-ends are built on
top of this package and do not reach around it.

## The model this package commits to

**A dot is burnt or it is not.** There is no grey, no anti-aliasing and no
subpixel anything. Every shape is resolved to coverage and then thresholded at
half a dot, which is the honest cut-off for a thermal head. A preview that
smoothed its edges would look better than the printout and would flatter
exactly the details — thin rules, small text, tight barcodes — where the user
needs the truth.

**The output is deterministic.** No canvas, no platform text engine, no system
fonts. The same input produces the same bits on macOS and on Windows, which is
what makes golden-image tests worth writing.

**Geometry is exact, letterforms are not.** Positions, sizes and rules land on
the dot the printer will use. Text is drawn from a substitute outline face
because the resident fonts live in the printer's ROM and cannot be obtained as
files; the substitute answers "does this fit, does it collide", not "what does
this letter look like".

**Millimetres in the model, dots at render time.** The document model stores
millimetres so a layout retargeted from 203 to 600 dpi is recomputed rather
than broken. `tools/render-sample.mjs` renders one layout at all three
resolutions and is the standing check that this holds.

## What is here

| Module | Role |
| --- | --- |
| `bitmap/Bitmap1` | 1-bit raster packed MSB-first, byte-aligned rows — the layout ZPL `^GF` and TSPL `BITMAP` already expect |
| `bitmap/png` | Dependency-free PNG writer, for previews and golden images |
| `raster/CoverageAccumulator` | Signed-area rasteriser: exact coverage in one pass, no supersampling |
| `raster/Path` | Outlines with Bézier segments, flattened at a tolerance chosen per resolution |
| `raster/fill` | Path to dots, with clipping that keeps off-label geometry in the winding |
| `raster/primitives` | Rectangles, rules, rounded boxes, ellipses — integer-exact where the shape allows |
| `text/Font` | TrueType face wrapper; glyph outlines in font units, cached |
| `text/text` | Single-line layout: proportional or fixed pitch, rotation, anchoring |
| `util/units` | Millimetre, inch and dot conversions for 203 / 300 / 600 dpi |
| `barcode/*` | Code 128, Code 39, ITF, EAN, UPC, QR, Data Matrix, PDF417 — modules, not pictures |
| `tspl/*` | TSPL parser and interpreter: printer commands in, label image out |
| `model/*` | The label document: language-neutral, millimetres, placeholders |
| `generate/*` | Document to printer code; the only place that knows about dots |

## The document and the code

The document model is the source of truth a project file holds. It is
language-neutral and measured in millimetres, so one design exports to TSPL,
ZPL or CPCL and survives being retargeted from 203 dpi to 600.

`generateTspl` turns a document into printer code. It is the only place that
knows about dots, and it says so when snapping to the dot grid moves something
that matters — a barcode module rounded from 0.24 mm to two dots is a different
barcode, and the designer should hear it here rather than at the scanner. What
the language cannot express is reported rather than approximated: TSPL has no
diagonal line command, so a diagonal line is an error with a reason, not a
staircase of bars.

The preview path is document to code to image, never document to image. The
picture on screen is therefore rasterised from the same text that reaches the
printer.

## Reading TSPL

`renderTspl` runs a source against a one-bit label buffer in the order a printer
would, and returns the image, the parsed commands and a list of diagnostics with
line and column positions.

Nothing throws. A malformed line produces a diagnostic and the rest of the label
still renders, because a preview that blanks the moment you mistype tells you
less than one that shows you where you are. Unknown commands are reported and
skipped; a barcode whose payload the symbology cannot hold reports why, in the
symbology's own words, and leaves the rest of the label alone.

Two things are approximated, and both are visible in the diagnostics rather than
hidden. Resident fonts are substituted, so character advance is exact and
letterforms are not. Image commands — `BITMAP`, `PUTBMP`, `PUTPCX` — are
recognised but not drawn.

## Sub-dot geometry

Line and border thickness is clamped to one dot rather than being allowed to
fade out. That is not a rounding convenience: printer languages express
thickness in whole dots, so a 0.05 mm rule reaches the printer as one dot and
prints as one dot. Showing it any other way would misreport what comes out.

Glyph strokes are *not* clamped, because nothing rounds them on the way to the
printer either — they are rasterised at their true size, and strokes below half
a dot disappear. The size ladder in the sample label shows where that happens.

## Commands

```
npm test         # 493 tests: raster, barcodes, TSPL, model, generator
npm run build    # type declarations and JS into dist/
npm run sample   # renders out/sample-{203,300,600}dpi.png and the barcode sheet
npm run tspl     # renders the built-in TSPL sample, or a file you name
npm run model    # document -> TSPL -> image, all three written to out/
```

## Fonts

`assets/fonts` carries DejaVu Sans Condensed (a stand-in for Zebra's
CG Triumvirate Condensed) and DejaVu Sans Mono (a stand-in for the fixed-pitch
resident fonts), both under the Bitstream Vera licence in
`assets/fonts/LICENSE-DejaVu.txt`. Both cover Cyrillic.
