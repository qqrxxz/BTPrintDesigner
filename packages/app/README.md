# @btpd/app

The Electron shell: a canvas, a code panel and a preview that is always
rasterised from the code.

## What the window does

The middle column is the label as the printer would burn it — one screen pixel
per dot, unsmoothed, because the dots are the point. Boxes over it come from the
render rather than the model: only the renderer knows how wide a line of text or
a barcode turned out. Drag them, nudge them with the arrow keys, or edit the
numbers on the left.

Opening a file — or typing in the code panel — puts that text on screen, and it
stays there until the design is changed. The first change hands the code back to
the generator, because a design that has moved on cannot be shown as somebody
else's text: elements would be added and deleted with nothing on screen moving.
The file on disk is untouched either way.

The right column is the printer code. Editing it is allowed and consequential:
if the model can hold everything the code says, the element panel keeps driving.
If it cannot, the panel switches off, names the lines it did not understand, and
the code becomes the source of truth while the preview carries on rendering.
While that is the case the panel's controls are switched off rather than left
to do nothing: the banner says the code is in charge, and a control that quietly
had no effect would contradict it. Naming the line is not enough to act on, so
where the command is one this program writes, the line it would have written is
shown underneath — generated
from the same code that writes labels, so it cannot drift out of date.

The printer chosen in the toolbar decides how many dots there are to the
millimetre, and the design is stored in millimetres, so switching from a 203 dpi
printer to a 600 dpi one recomputes the label rather than breaking it.

## Moving and resizing

An element is dragged by its outline and resized by the grips on it — but only
where a grip maps onto something the element has. A rectangle and a text block
have two dimensions; a barcode has a height and a module width, because the data
decides how many bars there are; a two-dimensional symbol has only its module; a
line has two ends. A single line of text has none of these: its size is the
character height, which is a number in the panel rather than a corner to pull.

A line is held to the axis it runs along while TSPL is the language, because
TSPL has no diagonal command at all and a millimetre of drift while lengthening
one would delete it from the label rather than tilt it. ZPL, which draws
diagonals, gets a small snap instead; shift turns both off and asks for the
diagonal outright. A frame is a target only on its edge — its middle belongs to
whatever is drawn inside it.

Arrow keys nudge by 0.1 mm, with Shift by 1 mm, and every size is also a field
in the properties panel — which is the exact way to set one, and the way that
works without a pointer.

## Work is not lost quietly

Closing the window or quitting asks about unsaved work first, the same question
New and Open ask; the main process holds the close until the renderer, which is
the only side that knows whether anything changed, answers. Reload and the
developer tools are not in the menu of the built app, because Cmd+R used to
throw the label away without a word. A file dropped on the window is opened the
way Open would open it — by default Chromium navigates to a dropped file, which
replaced the whole editor with the file's raw text — and nothing is allowed to
navigate the window at all.

Saving while the code is in charge writes the code into the project file along
with the design, and opening that file puts the code back in charge. Until this,
only the elements were saved, and every line typed by hand was lost while the
title bar said the work was saved.

## Opening what a customer sent

Open takes a project file or printer code, and decides which it is by looking:
a project is JSON with a version, anything else is code. The language is read
out of the code as well, never out of the file name — the same vendor ships
`.prn` files in three languages and calls a TSPL file `.prq` — and the printer
is switched to one that speaks it, because the preview is drawn by whichever
language the chosen printer uses.

Encoding is decided the same way. Templates come back from customers as often
in Windows-1251 as in UTF-8 — TSPL's own `CODEPAGE 1251` line says which — so
UTF-8 is tried strictly first and 1251 is the fallback. A file in a language
this program does not speak, Godex EZPL or Honeywell Fingerprint, is refused
with its name rather than read as forty broken TSPL commands.

## The bytes that leave

A new label is written in Windows-1251, which is what DataMobile's own
templates and the printers they are sent to expect. Choosing an encoding also
writes it into the code — TSPL's `CODEPAGE`, ZPL's `^CI28` for UTF-8 and `^CI33`
for 1251 — and replaces whatever the code said before; "as declared" leaves the line exactly
as it was.

A printer file is bytes, and which bytes matters: a TSC told `CODEPAGE 1251`
and handed UTF-8 prints nonsense where the Russian was. The label carries the
choice — "as declared", UTF-8, or 1251 — and "as declared" believes the code
itself, falling back to UTF-8 when the code says nothing. A character the
encoding has no byte for is named on the way out rather than dropped in
silence.

The label's quantity is part of the template. DataMobile puts the number typed
at the terminal into `@Quant@`, and the templates it ships say `PRINT 1,@Quant@`,
`^PQ@Quant@` or `! 0 200 200 312 @Quant@`; the variable is read back, shown in
the label's properties, and written out as it was. Editing a stock template used
to turn it into a plain 1, which printed one label whatever was typed.

## Templates

The toolbar's templates button opens DataMobile's own stock templates, grouped
by operation. Sixteen of them: one copy of each, listed under every operation
the vendor files it under. They open the way a customer's file opens — through
the importer — so what appears is a design to change rather than a picture. A
test opens every one of them on every build, writes it back out, and requires
the label to come out dot for dot the same, with every font and every DataMobile
variable it named.

## The left column

Everything on the left is a section that folds away, and what is open stays open
while the panels are rebuilt. The one at the top adds things: a kind at a time —
text, barcodes, two-dimensional codes, shapes — where each entry arrives already
configured, so a Code 128 added to a product template says `@Barcode@` and a
wrapped block is a BLOCK rather than a TEXT with a box to tick.

A new label is an empty sheet, 60 by 40 mm. A template is built for one
operation on one printer, and a starter design is something to delete before the
real work begins.

## DataMobile

The label's properties carry the DataMobile operation the template is for, and
every content field has a menu of the variables that operation offers — the
names are the vendor's, spelt exactly, and picking one beats typing it. In a
barcode's data the choice replaces what was there, because half a value and half
a variable is not a thing anyone wants; in running text it lands at the caret
and the rest stays.

Each variable in use is listed under "values" with the value the preview draws
for it. That value can be set: the catalogue's sample is a realistic length, but
only the person designing the label knows whether their product names run to
forty characters. What is typed there never reaches the exported file.

A GS1 symbol — Data Matrix or GS1-128 — has one more setting: which token in its
data stands for the separator between two application identifiers — `~1`, `_1`,
`~d029`, `~]`, or none at all. The token goes to the printer as written, because that is what the
printer acts on, and the preview reads it as the character it stands for.

The code panel and both exports show the template, with the variables still in
it, because DataMobile is what fills them in. The preview shows a copy with
sample values, so what is on screen is the width the real label will have. The
variables in use are listed under the sample values, each with the value the
preview drew, and a name DataMobile does not know — or one this operation does
not offer — is flagged there and in the problem list.

## Both languages

The interface is Russian and English, switchable at any time. Diagnostics from
the rendering engine are translated too: the engine emits English wording plus a
stable code, and the shell translates by code, falling back to the English when
a code has no translation yet.

Two things stay English on purpose. Argument names quoted inside a message are
the printer manual's own terms, and translating "narrow bar width" would make it
harder to find in the documentation, not easier. And an encoder's own refusal —
why a payload will not fit a symbology — keeps its exact wording, because a
translated generic would drop the detail that says what to change.

## The icon

`tools/make-icon.mjs` draws the mark and builds `build/icon.icns`. It is drawn
in code rather than traced from a file so every size is rendered at its own
resolution, and so that the small sizes can be different artwork: a
seventeen-bar barcode is a grey smear at sixteen pixels, where each bar lands on
a third of a pixel. Below sixty-four pixels the label therefore carries three
thick bars and one block, and stops leaning — a tilted edge at that size is mush
rather than character.

```
npm run icon              # writes build/icon.icns and build/icon.png
node tools/make-icon.mjs --preview   # the small sizes, magnified, to judge them
```

## Building the installer

```
npm run dist:mac          # release/BTPrintDesigner-<version>-arm64.dmg
```

The result is a drag-to-install disk image for Apple Silicon. It is **ad-hoc
signed and not notarised**: there is no developer certificate behind it, because
one costs money and a yearly renewal for a tool with one user. The ad-hoc
signature is applied by `tools/after-pack.cjs` and is not optional — Apple
Silicon refuses to run an unsigned binary at all.

What that means when opening it the first time: macOS will say it cannot verify
the developer. Right-click the app and choose Open, and confirm once; after that
it opens normally. If it was copied from another machine and macOS refuses
outright, clear the quarantine flag:

```
xattr -dr com.apple.quarantine /Applications/BTPrintDesigner.app
```

For Windows there is a portable build — one executable, nothing to install:

```
npm run dist:win          # release/BTPrintDesigner-<version>-portable.exe
```

It is built on the Mac: electron-builder cross-packages for Windows and uses
Wine to write the icon and version details into the executable, so Wine has to
be installed (`brew install --cask wine-stable`). The exe unpacks itself to a
temporary folder each time it starts, which costs a second or two and writes
nothing to the registry. It is not signed, so the first run goes through
SmartScreen — More info, then Run anyway.

The Windows icon is a proper `.ico` with every size from 16 to 256 in it, each
drawn at its own resolution by `tools/make-icon.mjs` — the taskbar shows sixteen
and twenty-four pixels, where a downscaled large icon is at its muddiest.

The runtime is Electron 44, pinned to an exact version because electron-builder
refuses a range. Electron supports its three newest major lines and nothing
older, and an unsupported one keeps collecting advisories — 33, which this
started on, had some thirty by the time it was replaced — so the pin is worth
moving when a new line comes out. Electron 44 needs macOS 12 or Windows 10.

Only the renderer, the compiled main process and the manifest go into the
bundle. The core package is deliberately a development dependency: Vite bundles
it from source, the main process never imports it, and leaving it in the
manifest put eight megabytes of unused code inside the app.

## Running it

```
npm run dev      # Vite plus Electron, with reload
npm start        # build and run
npm run dev:web  # the renderer alone in a browser, without the file menu
npm test         # the translation layer
```

The main process owns the window, the menu and the file system, and nothing
else. Every decision about labels lives in the renderer, which is where the
rendering engine runs — that is what lets the whole engine stay testable in Node
without an app around it.
