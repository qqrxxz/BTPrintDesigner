# @btpd/app

The Electron shell: a canvas, a code panel and a preview that is always
rasterised from the code.

## What the window does

The middle column is the label as the printer would burn it — one screen pixel
per dot, unsmoothed, because the dots are the point. Boxes over it come from the
render rather than the model: only the renderer knows how wide a line of text or
a barcode turned out. Drag them, nudge them with the arrow keys, or edit the
numbers on the left.

The right column is the printer code. Editing it is allowed and consequential:
if the model can hold everything the code says, the canvas keeps driving. If it
cannot, the canvas steps aside, says exactly which lines it could not hold, and
the code becomes the source of truth while the preview carries on rendering.

The printer chosen in the toolbar decides how many dots there are to the
millimetre, and the design is stored in millimetres, so switching from a 203 dpi
printer to a 600 dpi one recomputes the label rather than breaking it.

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
