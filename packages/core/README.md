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
| `zpl/*` | ZPL II parser and interpreter, checked against Labelary |
| `cpcl/*` | CPCL parser and interpreter |
| `model/*` | The label document: language-neutral, millimetres, placeholders |
| `model/presets` | What an editor puts on a label, configured for the operation and safe to draw |
| `generate/*` | Document to printer code; the only place that knows about dots |
| `import/*` | Printer code back to a document, and an honest answer about whether it fits |
| `datamobile/variables` | The `@Name@` variables DataMobile substitutes at print time, and which operation offers which |

## DataMobile variables

These labels are templates for DataMobile, which fills in `@Barcode@`,
`@Price@` and the rest when it prints. Two consequences run through the code.

The exported file keeps the variable. A generator that resolved `@Barcode@`
would freeze one product's barcode into a template meant for every product, so
`resolveVariables` is off by default and the preview is the only thing that
turns it on. The preview needs it, because nine characters of `@Barcode@` would
be judged as fitting where thirteen digits do not — each variable therefore
carries a sample of realistic length.

A few commands state a symbol's size themselves: TSPL's `DMATRIX` and `PDF417`
carry width and height. Those are computed from the sample and the generator
warns, because a value longer than the sample will want more room than the
template gives it.

Which variables exist depends on the operation the template is assigned to in
DataMobile's settings — a price means nothing on a packing sheet. The document
records that operation, `variablesFor` lists what it offers, and a variable
used outside its operation is a warning rather than an error: DataMobile leaves
an unrecognised name on the label as written, which is exactly the failure
nobody notices until a printed label comes back.

## GS1, FNC1 and the separator

FNC1 is what tells a scanner that a payload is application identifiers rather
than free text, and it is spelt differently in every symbology. Code 128 has it
as a character in its own alphabet: `encodeCode128` with `gs1: true` puts one in
front, which is what makes a GS1-128. Data Matrix has it as codeword 232 in the
first position, which `encodeDataMatrix` writes when `gs1` is set — that is what
a scanner reads back as the `]d2` identifier. QR's FNC1 mode is not implemented;
nothing in this program asks for a GS1 QR yet.

Between two identifiers of variable length GS1 wants a separator: ASCII 29 in a
Data Matrix, FNC1 again in a Code 128. Nobody can type either, so every printer
and every piece of middleware spells it with a token of its own — `~1`, `_1`,
`~d029`, `~]` — and which one arrives at the printer is a property of the setup.
A GS1 element, Data Matrix or Code 128, therefore records which token its data
uses. The generated file keeps the token, because that is what the printer acts
on; the preview and every measurement read it as the separator it stands for, so
the symbol on screen is the symbol that will be printed. `encodeCode128` with
`gs1` turns a group separator in its payload into FNC1, because a control
character there would be read as data by every scanner.

An interpreter meeting a group separator in a Data Matrix payload encodes the
symbol as GS1: a separator there means nothing else. ZPL's `^BC` says so
outright — mode D is a GS1 payload — and CPCL calls the symbology `UCCEAN128`,
which is what a GS1-128 is generated and imported as.

## Reading somebody else's file

`detectLanguage` says which of the three languages a file is written in, from
the code rather than from the name. It answers nothing where it does not know:
Godex EZPL leads with carets like ZPL and Honeywell Fingerprint reads like
plain words, and calling either of them TSPL would produce a page of complaints
instead of one honest sentence.

The importers earn their keep on real files. DataMobile's own stock templates
turned up four things they had been refusing without cause: TSPL's `OUT`, which
answers the host and draws nothing; ZPL's `^CW`, which names a downloaded font;
CPCL's `L`, which is `LINE` written short; and `SETMAG 0 0`, which asks for the
printer's ordinary size. A second `^XA` before any `^XZ` is a format that opens
itself twice, which printers take in their stride, and a job that draws nothing
before the label — the one that registers a font — is setup rather than a
second label. Thirty-seven of the vendor's forty-two files now come back as
designs; the five that do not are in languages this program does not speak.

A new piece of text is made for the language it will be written in. TSPL gets
the printer's own font 1 and a multiplier of one — `TEXT 32,32,"1",0,1,1,1` —
which is what every template from DataMobile does and what a TSC prints without
being asked to scale an outline; the height in millimetres says what that cell
actually is. The other two languages have no default worth pinning and take a
height the generator turns into whatever the language asks for.

Encoding is the other half of reading somebody else's file. `declaredEncoding`
reads what the code says about itself — TSPL's `CODEPAGE`, ZPL's `^CI28`,
CPCL's `ENCODING` — and `encodeText` writes the bytes, naming any character the
page has no room for rather than dropping it. The Windows-1251 table is built
by asking the platform's own decoder what each byte means, so it is nobody's
hand-typed magic numbers.

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

## ZPL, and the only external reference there is

Labelary renders ZPL, which makes ZPL the one language this project can be held
to an outside standard. The reference images live in `test/golden` and are
fetched once by `tools/fetch-labelary.mjs`, so the tests need no network.

Thirteen samples have to match dot for dot: boxes, circles, Code 128 at two
module widths, Code 39, ITF, EAN-13 at three module widths, Data Matrix and a QR
code. Every sample that cannot match says why in its own note, and its tolerance
sits just above what is observed so a regression still fails.

Three things differ and none is a defect. Labelary anti-aliases curves and
slopes where a thermal head cannot. QR mask selection and PDF417 compaction are
encoder choices rather than fixed by the standard, so where ours differs the
test decodes the symbol instead. And resident fonts are substituted by design.

Holding the two side by side found real errors that no round trip would have:
`^GD` measures its thickness across the row rather than perpendicular to the
stroke, which made every diagonal twice as thick; a rounded `^GB` follows the
curve with its border rather than being a square box with the corners rubbed
out; EAN guard bars run past the others by a fixed thirteen dots at 203 dpi
rather than by five modules; and `^BC` in its default mode stays in Code 128's
subset B however many digits it is given, so a preview that packed them into
subset C would show a barcode narrower than the printer's.

## CPCL, and the one table this project cannot verify

CPCL is the third language and the narrowest: no white shape to erase with, no
rounded corners on a box, no text block that wraps. Each of those is reported by
the generator with what to do instead rather than quietly approximated.

Its font table is the one piece of this project with no way to check it. CPCL
names a font and a size index rather than a height, the heights those indices
stand for vary between printer families, and there is no public renderer to hold
it against the way Labelary holds ZPL. The default ladder in `cpcl/fonts.ts` is
therefore a reasonable guess and is documented as one — it can be replaced
through `fontOptions.sizeLadders` without touching any code, which is how a
CPCL preview is made exact by someone with the printer on the desk. One rule
sidesteps the table for most real files: a size of nine or more is read as a
height in dots, which is how the scalable font is used.

## Linked and detached

`importTspl` reads code back into a document, and its real job is to say
honestly whether anything was lost. The result is `linked` only when every
command in the source is held by the model, so regenerating from the canvas
would produce the same label. Anything the model cannot hold — an image, an
unknown command, a symbology the canvas does not offer, a job that prints two
different labels — makes the result `detached`: the code stays the source of
truth, the canvas steps aside, and the preview carries on rendering from the
text.

That line is the whole contract. Importing four commands out of five would give
a canvas that quietly deletes the fifth the first time anything is moved.

Two things keep `linked` useful on real files rather than a theoretical state.
Printer setup lines — speed, density, code page — are kept verbatim in the
document's `preamble` and reproduced on the way out, so a file from a real
printer survives without the model having to model them. And `REVERSE` and
`ERASE` are element fills rather than unrepresentable commands, because
inverting a strip is how every printer language draws white text on black.

Round-tripping is checked the way that matters: the label has to come out the
same, not the text. The tests render both and compare the bits, and check that
a second trip changes nothing.

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
npm test         # 656 tests: raster, barcodes, TSPL, ZPL, CPCL, model, generators, importers
npm run build    # type declarations and JS into dist/
npm run sample   # renders out/sample-{203,300,600}dpi.png and the barcode sheet
npm run tspl     # renders the built-in TSPL sample, or a file you name
npm run model    # document -> TSPL -> image, all three written to out/
npm run import   # TSPL -> document; reports linked or detached and why
node tools/fetch-labelary.mjs   # refresh the ZPL reference images
```

## Fonts

`assets/fonts` carries DejaVu Sans Condensed (a stand-in for Zebra's
CG Triumvirate Condensed) and DejaVu Sans Mono (a stand-in for the fixed-pitch
resident fonts), both under the Bitstream Vera licence in
`assets/fonts/LICENSE-DejaVu.txt`. Both cover Cyrillic.
