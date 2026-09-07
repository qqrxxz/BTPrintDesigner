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
