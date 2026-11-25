# T16 design review

This was the final visual and interaction pass over every screen. I checked each one in Dark, Solarized Light, Light, Sepia, OLED Black and a custom theme ("Dusk"), at 1280×800, 1920×1080 and 900×600. I also checked Windows high contrast (`forcedColors: 'active'`) and the real Tauri window at 150% DPI.

To regenerate the screenshots, run `SHOTS=1 npx playwright test shell-shots reader-shots library-shots annotations-shots speech-shots`. The new `shell-shots` spec covers the shell, settings, the reader with its panels, the palette, high contrast (`*-hc-*`) and calm states (`states-*`).

## Top 5 changes (before / after in `review/`)

1. **Panels make room instead of covering the page** (`1-panel-*`). The annotations panel and the Contents/Pages sidebar now take their width from the reading area. The book re-lays out and a two-page spread drops to one column when the space gets narrow. The panel slides in over 200 ms. The status bar and progress line follow the reading area too.
2. **A quiet PDF status bar** (`2-pdf-bar-*`). The bottom bar used to blur whatever lay underneath, so it showed a colourful smear over images. Reader chrome now uses a new token, `--chrome-bg-over`, which is 95% `--bg` with no blur. It is calm over any content.
3. **Reflowed text never sits under the chrome** (`3-page-margins-*`). EPUB text used to start right under the title bar and run into the status bar. The reflow stage now sits between the two bars, so nothing re-lays out when the chrome fades.
4. **Docked Contents/Pages sidebar** (`4-toc-*`). The floating card with a shadow over the text is now a flat surface panel with a hairline border, matching the right panel. That follows "flat content never has a shadow".
5. **High contrast stays usable** (`5-high-contrast-*`). Pressed toggles, the current settings section, selected rows and chips were invisible: Highlight-coloured text sat on a Highlight fill, behind a Canvas backplate. They now use HighlightText with no backplate. Theme previews keep their colours.

## Other changes

- **Theme cross-fade includes the book.** The EPUB iframe used to repaint before the View Transition snapshot, so the page jumped while the chrome faded. `applyTheme(t, { onApply })` now recolours readers inside the transition, and `activeTheme()` returns the theme actually on screen.
- **Title bar:**
  - The reader toolbar overlapped the palette field below about 1100 px. The trailing tools now keep their natural width, and the palette field gives way. It drops the Ctrl K chip, then shrinks to its icon.
  - The book title keeps its room, and the chapter gives way first. The "·" separator now disappears along with the chapter.
  - In fullscreen there are no caption buttons, so the tools get a right gutter.
- **Scrollbars.** WebView2 drew standard scrollbars with arrow buttons; I only saw this in the real window. They are now thin, rounded and have no arrows, like Windows 11.
- **Find:**
  - Matches are now a faint accent wash instead of an outline box around every hit. The current match is stronger. PDF, EPUB and comics now look the same.
  - The results list puts the chapter or page on a caption line and the snippet below it, so the match is always visible.
- **Thumbnails** use the page's tint (Smart/Invert), so a dark theme no longer shows a column of white sheets.
- **Lookup.** The selection menu steps aside while the lookup popover is open, so only one thing floats at a time.
- **Settings → Reading → "When Quire starts".** I added the "Restore windows on launch" switch, which uses the core setting `restoreSession`.
- **Library.** On narrow windows the collection chips scroll in one row instead of wrapping under the heading.
- **Motion.**
  - The chrome fade-out went from 240 to 200 ms (`--dur-chrome`, DESIGN.md updated).
  - Everything else was already 120–200 ms ease-out and collapses to 0 under reduced motion, from the OS setting or the in-app toggle.
- I fixed a Svelte `assignment_value_stale` warning in `library.svelte.ts`.

## Real window (Tauri dev, 150% DPI)

- **Caption buttons.**
  - They are 46 px wide and fill the 40 px bar. I kept the full height on purpose: a 32 px block in a 40 px bar would put the glyphs 4 px off the toolbar icons.
  - The close hover measured exactly `#C42B1C`, and the red fills into the rounded corner.
  - The maximize hover comes from the snap-layout event, and the restore glyph shows when the window is maximized.
- **Unfocused window.** The mark turns grey and the title and caption glyphs fade.
- **Fullscreen (F11).** The caption buttons are hidden; I fixed the right gutter (see above).
- **Text** renders crisp with greyscale antialiasing. Mica sits behind the 82% title bar and is subtle by design.

## Remaining nits

- **Failed opens.** In the fake core, a file that fails to open (corrupt, DRM, missing) is still added to the library as a ghost book. "Missing" also reports as "damaged". Both are logic issues for the core owner.
- **EPUB cover.** The cover page shows on the left of a spread with a blank right page. A centred single page would be nicer (paginator).
- **Thumbnails** tint photos too, because the engine doesn't expose image regions for thumbnails.
- **Keyboard.** Theme cards and collection chips are each their own tab stop. A roving tabindex would be tidier.
- **Missing shortcuts.** The Text settings and View options buttons have no shortcut to show.
