# Quire e-ink design language

Quire on e-ink should still read like a well-set book. The desktop's warm surfaces, single accent and calm motion become
**paper, ink and stillness**. The desktop's rules (`src/lib/design/DESIGN.md`) still apply wherever this file says nothing.
This file wins where the panel forces a different answer.

Reference device: **Fidibook F1**, 758 × 1024 px portrait, 212 dpi, Android density 1.325 (1 dp = 1.325 px), 16 grays,
Android 4.2.2. **All measurements below are device px on that panel** unless marked dp or sp. To support other devices,
keep a `Ui.java` table of these numbers in dp (`px / 1.325`) and multiply by `DisplayMetrics.density` at startup. Do not
use `sp` scaling: the reader has its own text size control, and UI text must not reflow when the system font scale changes.

Mockups (the visual spec, 16-gray PNG at 758 × 1024): `docs/mockups/`
`library-grid.png`, `reader-chrome.png`, `contents.png`, `typography.png`, `highlights.png`, `settings.png`.
Source: `docs/mockups/src/` (`mockups.html` + `eink.css` hold the exact tokens). To regenerate, run from the repo root:
`node android-eink/docs/mockups/src/render.mjs && python -I android-eink/docs/mockups/src/quantize.py`.

---

## 1. Principles (desktop → e-ink)

| Desktop | E-ink |
|---|---|
| **The text is the interface.** Chrome appears only when you reach for it. | Same. A tap in the centre shows chrome. Nothing else appears on the page except the status line, a bookmark dog-ear and your highlights. |
| **One accent per theme.** It marks the current thing. | **Solid black is the accent.** The current thing is *inverted*: a black fill with white content (the primary button, the selected segment, the on switch). In lists, the current row gets a 6 px black bar on its left edge, which is the desktop's accent pill. |
| **Quiet surfaces.** 3 surface levels, hairlines, no gradients or shadows. | **One surface: white paper.** Panels separate with space and a single rule. No gradients, shadows, translucency or scrims, ever. |
| **Space before lines.** | Same order: whitespace, then a 1 px `ink-2` rule, then a 1–2 px black rule. Boxes only for controls. |
| **Native, not web.** Windows 11 metrics. | **Reader-native.** Finger-sized targets (≥ 64 px), hardware page keys turn every paged view, and BACK always means "close the top thing". |
| **Calm motion**, 120–200 ms. | **No motion at all.** Every change is a single redraw. No fades, slides, ripples, blinking cursors or spinners. |
| **Keyboard first.** | **Page keys first.** Anything that is a list is paged, never scrolled, and PAGE_UP/PAGE_DOWN turn its pages. |

**Don't:** use any gray lighter than `#555555` for information, use animation of any kind, use scrolling lists
(`ListView`/`ScrollView` with fling), use Android's holo widgets unstyled (blue accents, pressed glows), use the system
status bar (run full-screen), use toasts for things the screen already shows, or make more than one inverted (primary)
button per view.

---

## 2. Tokens

### 2.1 Grays

The panel shows 16 levels (every multiple of 0x11). Fast refresh modes (DU/A2) show only black and white: anything
darker than about 50 % turns black and anything lighter turns white. So the gray tokens fall into two classes.

| Token | Hex | 16-level index | Survives a FAST update as | Use |
|---|---|---|---|---|
| `ink` | `#000000` | 0 | black ✓ | text, icons, primary fills, inverted states, strong rules, selection |
| `ink-2` | `#555555` | 5 | black ✓ (safe) | secondary text (≥ 16 px only), 1 px dividers, inactive tab labels, dashed "missing file" border |
| `gray` | `#AAAAAA` | 10 | white ✗ (decorative only) | progress tracks, disabled icons and text (≥ 18 px), the scrubber track. Losing it must lose no meaning. |
| `tint` | `#CCCCCC` | 12 | white ✗ (decorative only) | highlight fill, cover placeholder. Only on surfaces that always get a PARTIAL or FULL update. |
| `paper` | `#FFFFFF` | 15 | white ✓ | every background |

- Use exact hex values. Off-grid grays (for example `#666`) dither and ghost.
- Text contrast: `ink` on paper is 21:1, `ink-2` on paper is 7.5:1. Never put `ink-2` text on `tint`.
- **Inverted** = `ink` fill + `paper` content. It is the only "pressed", "selected" and "on" treatment.
- **Disabled** = `gray` content, no border change. Disabled controls do not respond (no pressed inversion).

### 2.2 Fonts (static TTF, bundled in `app/src/main/assets/fonts/`, 936 KB total)

| Family | Role | Files (weight) | Size |
|---|---|---|---|
| **Literata** (opsz 12 text cut) | reading default; display (screen titles, book titles, greeting, generated covers) | `Literata-Regular.ttf` (400), `-Italic.ttf` (400i), `-SemiBold.ttf` (600, titles), `-Bold.ttf` (700), `-BoldItalic.ttf` (700i) | 5 × 95 KB |
| **Inter** (opsz 14) | all UI text | `Inter-Regular.ttf` (400), `Inter-Medium.ttf` (500) | 2 × 154 KB |
| **Atkinson Hyperlegible Next** | reading option "Atkinson" (legibility; holds up best on faint e-ink) | `AtkinsonHyperlegibleNext-Regular.ttf`, `-Italic.ttf`, `-Bold.ttf` | 3 × ~50 KB |

- **Source and license:** all three are SIL Open Font License 1.1 (Literata: TypeTogether / Google Fonts; Inter: Rasmus
  Andersson; Atkinson Hyperlegible Next: Braille Institute). The files were built **offline** from the copies the desktop
  app already ships (`node_modules/@fontsource-variable/literata`, `@fontsource-variable/inter`,
  `@fontsource/atkinson-hyperlegible-next`) by `tools/make_fonts.py`. That script pins the variable fonts to static
  instances with fontTools, merges the `latin` and `latin-ext` subsets, and writes plain TrueType. Rerun it with
  `python -I android-eink/tools/make_fonts.py`. Ship the OFL text in the About → Licenses screen (copy it from
  `node_modules/@fontsource-variable/literata/LICENSE`).
- **Coverage:** Latin and Latin Extended only (no Cyrillic, Greek, Arabic or Persian, and no arrow glyphs U+2190–21FF).
  If wider coverage is needed, take the full static TTFs from Google Fonts' download ZIP (`static/` folder) or from the
  GitHub releases (`googlefonts/literata`, `rsms/inter` → `extras/ttf/`, `googlefonts/atkinson-hyperlegible-next`) and
  keep the same file names. Draw arrows as icons, never as text.
- **Roboto is not used.** It is the generic Android 4.2 look, and Inter is the desktop's UI face. One exception: the
  soft keyboard and any system dialog stay Roboto.
- Load each `Typeface` once (`Typeface.createFromAsset`), keep it in a static field, and never create one per view.
  On API 17, `createFromAsset` leaks if it is called repeatedly.
- The reading engine (MuPDF) gets the same files through user CSS `@font-face` with `src: url(...)` pointing to the
  extracted files, or MuPDF's font loader (E3 decides). The "System serif" option is `/system/fonts/DroidSerif-*.ttf`.
- **Weights:** UI uses 400 and 500 only. 600 appears only as Literata SemiBold in titles. Bold 700 appears only inside books.

### 2.3 Type scale

| Token | px | dp/sp | Face | Use |
|---|---|---|---|---|
| `badge` | 15 | 11.3 | Inter 500, UPPERCASE, tracking +0.08 em, `ink-2` | section labels ("CONTINUE READING", "READING"), format badges on covers (13 px allowed there) |
| `micro` | 16 | 12.1 | Inter 400 | grid author line, the status line while reading, small captions |
| `meta` | 18 | 13.6 | Inter 400, usually `ink-2` | metadata, page numbers, subtitles, chips, pager label |
| `body` | 21 | 15.8 | Inter 400 / 500 | default UI text: list rows, settings labels, buttons (500), tabs (500) |
| `lead` | 24 | 18.1 | Inter 500 | dialog titles |
| `title` | 28 | 21.1 | Literata 600 | screen and sheet titles, the hero book title |
| `display` | 36 | 27.2 | Literata 600 | the library greeting and empty-state headlines |

- Line height: 1.3 for UI and 1.45 for multi-line UI paragraphs. Use tabular figures for page numbers, percentages and
  times. Inter has `tnum`. With `Paint` on API 17, `setFontFeatureSettings` is unavailable, so right-align numbers in
  fixed-width slots instead.
- Settings subtitles are 17 px `ink-2`, the only off-scale size, so that two-line rows fit in 80 px.

**Reading defaults** (reflowable books):

| Setting | Values | Default |
|---|---|---|
| Font | Book's own · Literata · Atkinson · System serif (Droid Serif) | Literata |
| Size (px) | 18, 20, 22, 24, 26, **28**, 30, 33, 36, 40, 44, 50 (12 steps) | 28 (≈ 3.4 mm em) |
| Line spacing | 1.3 · **1.5** · 1.7 · 1.9 | 1.5 |
| Side margins (% of width) | 4 · **7** · 11 · 15 | 7 % (53 px each side → 652 px measure, ~50 chars) |
| Top / bottom margin | 40 px / 56 px (the bottom margin holds the status line) | fixed |
| Alignment | **Left** · Justified | Left (matches the desktop; MuPDF does not hyphenate, so justified text can show rivers) |
| Publisher styles | **Keep** · Fonts (override fonts only) · All (override fonts, sizes, spacing, alignment) | Keep |
| Paragraphs | publisher's own; under "All": 0.6 em space, no indent | — |

### 2.4 Spacing, lines, radii

- **Grid:** 4 px base. Steps: 4, 8, 12, 16, 20, 24, 32, 48, 64. Page gutter: **32 px** on every screen. Chrome icon
  rows inset 14 px, because the icon box is centred in a 68 px target.
- **Rules:** 1 px `ink` (bar edges, segment dividers); 1 px `ink-2` (in-panel dividers, chip outlines); 2 px `ink`
  (sheet top edge, dialog and popover borders, outline buttons, segmented controls, switches). 1 px `gray` is never
  used: it can disappear.
- **Radii:** 0 for bars and sheets (they touch the screen edges); 3 px for badges; 4 px for covers; 6 px for buttons and
  inputs; 8 px for segmented controls, font tiles, dialogs, popovers and menus; full (pill) for chips and switches.
  Antialiased corners are fine. They produce a few gray pixels that fall to black or white under FAST updates.

### 2.5 Icons

- 24-unit grid, 1.9-unit stroke, round caps and joins (Fluent-like, matching the desktop's line icons). Drawn at
  **32 × 32 px**, black, centred in a **68 × 68 px** target (64 px minimum).
- Ship them as PNGs. They are pre-rendered in `docs/icon/ui/ic_*.png`, 32 × 32, black on transparent. Put them in
  `res/drawable-nodpi/` so Android does not rescale them, and tint with `setColorFilter` for inverted (white) or
  disabled (`gray`) states. API 17 has no VectorDrawable, so do not use one. The SVG source is `docs/mockups/src/icons.js`.
- **Set (38):** back, close, more, search, settings, contents, bookmark, bookmarkOn, type (Aa), grid, list, sort,
  filter, chevLeft, chevRight, chevDown, check, plus, minus, folder, goto, highlight, note, copy, trash, export,
  collection, prevChapter, nextChapter, refresh, fit, contrast, crop, info, edit, book, rotate, battery.
- Draw the battery fill level in code over `ic_battery` (inner rect x 4.6–15.1 of 24, scaled), or draw the whole icon
  with `Canvas`.

### 2.6 Touch and input

- **Minimum target: 64 × 64 px (48 dp).** Rows are ≥ 72 px. Adjacent targets need ≥ 4 px of dead space between them.
- **Pressed state:** on `ACTION_DOWN`, invert the control's bounds with a FAST update. On `ACTION_UP` inside the bounds,
  run the action. If the finger moves more than 16 px or leaves the bounds, restore the control (FAST) and cancel.
  The page itself (tap zones) shows no pressed state.
- **Long press:** 500 ms. Do not use double-tap anywhere: the second tap lands while the panel is still redrawing.
- **Hardware keys** (all screens). Map PAGE_DOWN (93), VOLUME_DOWN (if enabled) and DPAD_RIGHT to *next*, and
  PAGE_UP (92), VOLUME_UP and DPAD_LEFT to *previous*. "Swap page-turn keys" reverses both. Each key turns the paged
  view that is in front: book, library, TOC, results or settings. In a sheet or dialog with no pages, the keys do
  nothing. A long press (≥ 800 ms) on a page key while reading jumps to the next or previous chapter.
  BACK closes the topmost layer in this order: popover → sheet or dialog → chrome → reader (back to library) →
  library search or filter → library page 1 → exit.
- **No busy spinners.** For waits over 300 ms, change the control's label to "Opening…", "Laying out…" or "Searching…"
  and leave everything else still. For long jobs (scan, index), update one status line at most every 2 s.

### 2.7 Components

| Component | Spec |
|---|---|
| **Top bar** | 96 px tall, paper, full width. Content inset 14 px. Optional 1 px `ink` bottom rule: on in the reader chrome, off on full screens (Library, Contents, Settings, where space separates). Leading `back` or `close` icon button, then the title at x = 92 (Literata 600 28). Trailing icon buttons at 68 px pitch. |
| **Pager footer** | 60 px tall at the bottom of every paged screen (y 964–1024). `chevLeft` and `chevRight` icon buttons at x 14 and x 676; the centre label is `meta` `ink-2` ("Page 1 of 6", or "1 of 14" in panels). A disabled chevron is `gray`. On panels (Contents), add a 1 px `ink-2` rule on top. Page keys do the same thing. |
| **Primary button** | 56 px high, radius 6, `ink` fill, `paper` Inter 500 21 px label, 24 px side padding. One per view. |
| **Secondary button** | Same size, paper fill, 2 px `ink` border, `ink` label. |
| **Text button** | No box. Inter 500 21 px `ink`, with a 64 px tall target. |
| **Chip** | 44 px high (64 px target), pill, 1 px `ink-2` border, Inter 18 px, 18 px padding. Selected: inverted. |
| **Segmented control** | 56 px high, 2 px `ink` border, radius 8, cells divided by 1 px `ink`. Selected cell inverted. Labels Inter 500 18, or a drawn 28–40 px glyph. |
| **Switch** | 64 × 36, pill, 2 px `ink` border. Off: paper track, 24 px paper knob with a 2 px ink ring on the left. On: `ink` track, paper knob on the right. The whole row is the target. |
| **Stepper** | A segmented control with `minus` · value · `plus` cells; the value cell (flex 1.4–1.6) is not inverted. |
| **List row** | ≥ 72 px, 32 px gutters. Primary text Inter 21, optional subtitle 17–18 `ink-2`. Trailing value, `chevRight` or a control. No dividers inside a group; groups get a `badge` label 24 px above them. |
| **Current row** | 6 px `ink` bar flush left (x 0–6), inset 12 px top and bottom; text in Inter 500. |
| **Progress bar** | 4 px high, `gray` track, `ink` fill. On covers: a 6 px paper strip at the cover's bottom edge with a 1 px `ink` top rule and an `ink` fill. |
| **Text input** | 56 px high (multi-line in the note editor), radius 6, 1 px `ink-2` border, 2 px `ink` when focused, Inter 21, padding 16. Placeholder `ink-2`. No blinking cursor (see §8). |
| **Bottom sheet** | Full width, anchored to the bottom, 2 px `ink` top rule, paper, no radius. A 72 px header row holds the title (Literata 600 28 at x 32) and trailing actions. Closed by BACK, by a tap above the sheet, or by the trailing control. |
| **Dialog** | 662 px wide (x 48), radius 8, 2 px `ink` border, padding 32, centred vertically (or top = 96 when the keyboard is up). Title Inter 500 24, body Inter 21/1.45. Buttons right-aligned, 16 px apart, secondary then primary. **No scrim:** paint a 12 px paper "halo" ring round the border instead, so it never touches busy page content. |
| **Popover menu** | 2 px `ink` border, radius 8, 12 px paper halo, rows 64 px (icon 32 + Inter 21 label), min width 360. Anchored under its icon, right-aligned to x 726. |
| **Toast** | Only for results the screen cannot show (export finished, "Copied"). An `ink` box with radius 8 and 56 px height, `paper` Inter 19 text, max width 662, centred at y 872–928. Shows for 4 s, then the region is repainted (PARTIAL). One at a time. |

---

## 3. Refresh policy

The panel modes are abstract here. E0's `Epd` wrapper maps them to the vendor API (or, without one, to `View.invalidate`
plus the vendor's default).

| Mode | Panel waveform (typical) | Cost | Use for |
|---|---|---|---|
| **FULL** | GC16 with flash | ~500–700 ms, visible black flash | Clearing ghosting. |
| **PARTIAL** | GC16 / GL16 without flash, region-limited | ~300–450 ms | Normal UI and page changes with grays. |
| **FAST** | DU / A2 (1-bit), region-limited | ~120–250 ms | Black-and-white feedback while a finger is down or typing. Always followed by a PARTIAL of the same region once the interaction ends. |

| Event | Mode |
|---|---|
| Open a book (first page) | **FULL** |
| Page turn (tap or key) | PARTIAL full-screen. Every *N*th turn (setting "Full refresh every", default **6**, values Off/1/2/3/4/5/6/8/10/15/20) → FULL. Images, comics and PDF scans count as 2 turns. |
| Chapter jump, go-to page, TOC, bookmark or search jump | FULL (the content changes completely) |
| Chrome shows | PARTIAL, regions of the two bars only |
| Chrome hides | PARTIAL of the bar regions. Use FULL if FAST was used while the chrome was open (scrubber drag) or on every 3rd hide. |
| Scrubber drag | FAST for the knob and its "Page n" label; on release, jump (FULL) |
| Pressed inversion / restore | FAST, control bounds only |
| Selection handles dragging | FAST, the union of the old and new selection rects; on release, PARTIAL of that region |
| Highlight created, changed or deleted | PARTIAL of the affected lines |
| Popover, menu or toast show | PARTIAL of its rect plus the 12 px halo. On hide, PARTIAL of the same rect. |
| Sheet open | PARTIAL of the sheet rect. Each value change → PARTIAL of the control, then PARTIAL of the page region above the sheet after re-layout. |
| Sheet or dialog close | FULL if the content under it changed (typography, view mode); otherwise PARTIAL |
| Typing (note, search, title edit) | FAST for the text field; PARTIAL of the field 600 ms after the last key |
| Library or list page turn | PARTIAL full-screen; every 5th → FULL |
| Library cover arrives (async) | Batch: one PARTIAL per cover row, at most once per 500 ms |
| Screen change (library ↔ reader ↔ settings) | FULL |
| More → "Clean screen" | FULL |

---

## 4. Screens

Coordinates are `x, y, w × h` from the top-left on the 758 × 1024 portrait panel. Landscape is not supported (the
F1 has no rotation sensor). PDF and comic "Rotate" rotates the content, not the UI.

### 4.1 Library — grid (mockup `library-grid.png`)

| Element | Geometry | Spec |
|---|---|---|
| Greeting | x 32, baseline ≈ 62 | Literata 600 36. "Good morning" (5–12), "Good afternoon" (12–18), "Good evening" (18–5). Updated only on screen entry. |
| Search, Settings | 2 icon buttons, x 594 and 662, y 14 | → Library search (§4.9), Settings (§4.12) |
| "CONTINUE READING" | x 32, y 104 | `badge` |
| Hero cover | 32, 140, 120 × 180 | The most recently read unfinished book. Tapping the cover or the text opens the book. |
| Hero title | x 176, y 138 | Literata 600 28, max 2 lines with ellipsis |
| Hero author | x 176, below the title + 4 | Inter 21 `ink-2`, 1 line |
| Hero progress | x 176, 22 px below the author, 220 × 4 | Followed by `meta` `ink-2` "42% · 3 h 43 min left" (time from the remaining pages × the measured pace; omit it until there are 10 pages of history) |
| Resume | 176, 264, auto × 56 | Primary button. While opening, its label reads "Opening…". |
| Shelf header | 32, 352, 694 × 60 | Left: collection picker "All books · 42 ⌄" (Inter 500 21 + `ink-2` count, tap → Collections sheet). Right: sort chip ("Recent" + sort icon, tap → Sort & filter sheet), then a grid/list segmented control 120 × 44 (selected inverted). |
| Grid | top 420, 4 columns at x 32 / 215 / 398 / 581, row pitch 272 | Tile 144 wide: cover 144 × 208; title Inter 500 18/24, 1 line with ellipsis, 8 px below the cover; author line Inter 16/20 `ink-2` with a right-aligned status: "64%", "New", a `check` icon (finished), or "23%" for missing files. |
| Pager | §2.7 | "Page 1 of 6" |

- **Items per page:** page 1 with the hero has 2 rows (8 books). Every other page, and every page whenever the hero is
  hidden (a filter, collection or search is active, or the setting is off), has **3 rows = 12 books**, with the shelf
  header at y 96 and the grid at top 164.
- **Cover tile:** radius 4, 1 px `ink` outline drawn inside the image. Format badge at (8, 8): paper box, 1 px `ink`
  border, radius 3, Inter 500 13 px caps, padding 4 × 6. Show it only when the library holds more than one format.
  The progress strip sits on the cover's bottom edge (§2.7) and only on started books.
- **Cover images:** extracted once, scaled to 144 × 208 (centre crop when the aspect is within 15 % of 0.69, else fit
  on paper), converted to gray with a slight levels stretch (black point 4 %, white point 96 %), Floyd–Steinberg
  dithered to 16 levels, and stored as an 8-bit gray PNG in app cache. The hero and the list thumbnail are scaled from
  the same file. Decode with `inSampleSize` and `RGB_565` or `ALPHA_8` to save heap.
- **Generated cover** (no cover image): paper background, 2 px `ink` frame inset 10 px, 1 px `ink-2` frame inset 15 px,
  title centred in Literata italic 22/1.2 (max 4 lines, hyphenated by hand at the frame width), author in Inter 500
  9–11 px caps with +0.16 em tracking, 128 px from the top. It is the same idea as the desktop's typographic covers.
- **Missing file:** replace the cover with a paper box, a 2 px dashed `ink-2` border (dash 6, gap 4), radius 4, an
  `info` icon and "File not / found" (Inter 16 `ink-2`, centred). The title is `ink-2`. Tap → Book sheet in its
  missing state (§4.3).
- **Pressed tile:** invert the cover rect only (draw it as a black box), FAST, then open the book.
- **Long press on a tile** → Book sheet (§4.3).
- **States:**
  - *Empty library* (no books after a scan): centred column at y 280. A 96 px code-drawn open-book line icon, then
    Literata 600 36 "No books yet", then Inter 21/1.45 `ink-2`, max width 560: "Quire looks in /sdcard/Books and
    /sdcard/Download. Copy books there, or choose other folders." Then a primary "Scan for books" and a secondary
    "Choose folders" (→ folder browser), 16 px apart.
  - *First scan running:* the same layout with "Looking for books…" as the headline and the count as the line below
    ("37 books found"), updated at most every 2 s. Covers appear when the scan finishes.
  - *Filter or search with no results:* "Nothing matches" (Literata 600 28) + "Clear filters" (secondary).

### 4.2 Library — list mode

- Row 108 px, 32 px gutters. Cover thumb 56 × 84 at (32, +12). Title Inter 500 21 at x 108, max 2 lines; author Inter
  18 `ink-2`. Right column (right-aligned at x 726): format `meta` `ink-2` on top, progress 120 × 4 + "42%" below,
  or "New" or `check`.
- Page 1 with the hero: 5 rows (from y 420). Other pages: 7 rows (from y 164). No dividers; rows separate by 0 px with
  12 px internal padding. Missing-file rows show "File not found" in place of the author.

### 4.3 Book sheet (long press on a book, or tap on a missing book)

A bottom sheet with auto height (max 760 px).

- Header (y +24): cover 96 × 144 at x 32. Text at x 152: title Literata 600 24/1.25 (2 lines), author Inter 19 `ink-2`,
  meta `micro` `ink-2` "EPUB · 1.2 MB · Added 3 Nov · Read today", then progress 200 × 4 + "42%".
- Actions, 72 px rows (32 px icon at x 32, Inter 21 label at x 88):
  `book` Open (or Resume) · `collection` Add to collection… · `check` Mark as finished (or Mark as unread) ·
  `edit` Edit title & author… · `refresh` Reset progress · `close` Remove from library (the file stays) ·
  `trash` Delete file… (confirm dialog: "Delete 'Dracula'? The file is removed from the device. This can't be undone."
  with Cancel and a primary "Delete").
- **Missing state:** under the header, an Inter 18 `ink-2` line "Not found at /sdcard/Books/dracula.epub". Actions:
  `folder` Locate file… (folder browser, picks a file) · `close` Remove from library.
- Edit dialog: two text inputs (Title, Author), keyboard up, dialog at top = 96, with Cancel and Save.

### 4.4 Sort & filter sheet, Collections sheet

- **Sort & filter** (from the sort chip): a "Sort" `badge`, then radio rows of 64 px: Recently read · Recently added ·
  Title · Author · Progress. The selected row is Inter 500 with a `check` at x 694. Then "Show" chips: All · Unread ·
  Reading · Finished; then "Format" chips: All · EPUB · PDF · Comics · Other (the chips wrap, with 12 px gaps). A
  secondary "Reset" and a primary "Done" sit at the bottom right. Changes apply when the sheet closes.
- **Collections** (from "All books ⌄"): rows of 72 px: "All books 42", each collection "Name 13", then `plus`
  "New collection…". The current one has the current-row bar and a `check`. Long-press a collection → menu: Rename… ·
  Delete (books are kept). "Add to collection…" from the Book sheet uses the same list with check toggles and a Done
  button.
- Shelf header text follows the state, for example "Fiction · 13 ⌄", and the hero hides.

### 4.5 Reader — page and tap zones

- The page is the whole screen. Full-screen activity, no system status bar.
- **Status line** (chrome hidden): a 40 px band at the bottom (y 984–1024), `micro` `ink-2`, at x 53 (left) and right-
  aligned at x 705 (the text margins). Setting values: Off · Page ("12 / 612") · **Chapter · page** (left: chapter
  title with ellipsis at 60 % width; right: "12 / 612") · Chapter · page · time (right: "12 / 612 · 14:32"). The status
  line redraws only with the page, never on a timer. The clock therefore updates on page turns, which is intended.
- **Bookmark dog-ear:** a 44 × 44 `ink` right triangle in the top-right corner when the page is bookmarked.
- **Tap zones** (setting "Tap zones"; a centre box is always the chrome toggle: x 253–505, y 341–683):

```
 Left third (default)       Halves                     Top / bottom
 ┌──────┬──────────────┐    ┌──────────┬──────────┐    ┌──────────────────────┐
 │      │           ◥BM│    │          │       ◥BM│    │       PREV        ◥BM│
 │ PREV │    NEXT      │    │   PREV   │   NEXT   │    │──────┌──────┐────────│
 │      │  ┌──────┐    │    │      ┌───┴──┐       │    │      │MENU  │        │
 │      │  │ MENU │    │    │      │ MENU │       │    │      └──────┘        │
 │      │  └──────┘    │    │      └───┬──┘       │    │       NEXT           │
 │      │              │    │          │          │    │                      │
 └──────┴──────────────┘    └──────────┴──────────┘    └──────────────────────┘
  x < 253 → prev               x < 379 → prev             y < 512 → prev
```

  A "Mirror for left hand" switch in the picker flips left and right. The top-right 88 × 88 corner (BM) toggles the
  bookmark in every layout. A long press anywhere selects the word (§4.10). A tap on a link follows it (the tap target
  is the link's quad, padded by 12 px). After a link or any jump, the chrome's bottom bar shows a "Back to p. 12" chip
  (see below) until the next jump or for 20 page turns.
- Turning past the last page shows an end card: "The end of *Title*" (Literata 600 28), "Mark as finished" (primary)
  and "Back to library" (secondary).

### 4.6 Reader — chrome (mockup `reader-chrome.png`)

The chrome overlays the page. The page does not move or re-layout. A centre tap toggles it; BACK or a tap on the page
area between the bars hides it. It stays until dismissed (no idle timer, which would cost a refresh).

**Top bar** (0, 0, 758 × 96, 1 px `ink` bottom rule):
- `back` at x 14 → library (FULL).
- Title block x 92–384: book title Literata 600 22/28 with ellipsis; under it the chapter, Inter 17/24 `ink-2`.
- Icon buttons at x 404, 472, 540, 608, 676: `contents` (→ §4.7), `search` (→ §4.9), `type` (Aa → §4.8; for
  PDF/comics this is `fit` → View sheet, §5), `bookmark` / `bookmarkOn` (toggles the bookmark for this page), `more`.
- **More** menu (popover): Go to page… · Book details (→ Book sheet, read-only actions) · Export highlights ·
  Clean screen (FULL) · Settings.

**Bottom bar** (0, 848, 758 × 176, 1 px `ink` top rule):
- Row 1, y 866: left the chapter title, right "4 pages left in chapter" (`meta` `ink-2`).
- Row 2, y 900–968: `prevChapter` icon button at x 14; scrubber track x 94–664 (4 px `gray`, `ink` fill to the
  current position); 2 × 16 px `ink-2` chapter ticks for top-level chapters (omit them when there are more than 40);
  24 px `ink` knob. `nextChapter` at x 676. Dragging the knob shows "p. 230" in a 2 px-bordered label (Inter 500 18)
  centred 40 px above the knob, FAST. On release, jump. A tap on the track jumps there.
- Row 3, y 964–1012: a "Page 12 of 612" chip (1 px `ink` border, Inter 18 `ink`) → Go to page dialog; next to it
  "2%" `meta` `ink-2`. After a jump, a second chip "↩ Back to p. 12" (the icon is `back`) follows the % label. Right
  side: "14:32", `battery` icon with a drawn fill, "82%" (`meta` `ink`, tabular).
- For PDFs, "page" means the PDF page label (use `/PageLabels` when present: "Page xii (12 of 612)"). For reflowable
  books it is the layout page at the current typography; page totals recompute after a re-layout, and progress is
  stored as a position (chapter + offset) so it survives re-layout.

### 4.7 Contents · Bookmarks · Highlights (mockup `contents.png`)

A full screen (not a sidebar: the screen is only 758 px wide).

- Top bar (no rule): `close` at x 14; book title Literata 600 28 at x 92 with ellipsis; trailing `goto` icon (→ Go to
  page dialog).
- Tabs (0, 96, 758 × 64): three equal cells, Inter 500 21. Selected: `ink` label + a 4 px `ink` underline inset 24 px.
  Unselected: `ink-2`. Counts after a middle dot ("Bookmarks · 3"). 1 px `ink-2` rule under the tabs.
- **Contents rows:** 72 px from y 176, 10 per page. Title Inter 21, ellipsis on 1 line (2 lines allowed with 96 px
  rows if the title has more than 40 chars). Page number `meta` `ink-2` right-aligned at x 726. Indent 32 px per level
  (max 3 levels); levels 2+ are `ink-2`. The **current chapter** gets the current-row bar and Inter 500. Collapsing is
  not supported: everything is expanded, which is simpler to page through. The screen opens **on the page containing
  the current chapter**.
- **Bookmarks rows:** 96 px. Line 1: "Page 43" Inter 500 21 and, right-aligned, the date `meta` `ink-2`. Line 2: the
  first words of the page in Literata 19 `ink-2`, 1 line. Tap → jump. Long press → "Delete bookmark" menu. Empty:
  "No bookmarks yet" (Literata 600 28) + "Tap the top-right corner of a page to bookmark it." (Inter 21 `ink-2`).
- **Highlights tab:** a filter row (y 176, 64 px) with chips "All · Highlights · Notes" and a trailing `export` icon
  button (→ Export, toast "Saved to /sdcard/Quire/Highlights/Moby-Dick.md"). Items are variable height, packed per page:
  - a 32 px style sample at x 32 (the style glyph from §4.10, drawn on "Ab"),
  - the quote in Literata 21/1.45 at x 80, max 4 lines with ellipsis,
  - the note, if any: Inter 19/1.45 `ink`, prefixed by a `note` icon (24 px), max 3 lines,
  - meta `micro` `ink-2`: "p. 15 · Chapter 2 · 3 Nov",
  - 24 px between items, no dividers.
  Tap → jump to it (FULL). Long press → menu: Edit note… · Change style ▸ (the 4 swatches) · Copy · Delete. Empty
  state: "No highlights yet" + "Long-press a word to start one."

### 4.8 Typography sheet (mockup `typography.png`)

A bottom sheet, 0, 392, 758 × 632 (2 px `ink` top rule). The top 392 px of the page stay visible as a live preview.

| Row | y (sheet-relative) | Content |
|---|---|---|
| Header | 0–72 | "Typography" Literata 600 28 at x 32. Right: "This book only" (`meta`) + switch, then a `refresh` icon button = Reset to defaults. |
| Font tiles | 72–184 | 4 tiles 158 × 112 at x 32 / 210 / 388 / 566, radius 8, 1 px `ink-2` border. "Aa" in the face at 40 px, name `micro` below. Selected: 3 px `ink` border + 12 px `ink` dot at the top right (not inverted, so the face stays readable). Book's own · Literata · Atkinson · System serif. |
| Size | 200–280 | Label at x 32, Inter 21. Stepper x 326–726: small "A" (Literata 18) · "28 px" · large "A" (Literata 30). |
| Line spacing | 280–360 | Segmented control, 4 drawn glyphs (3–4 lines at increasing gaps) = 1.3 / 1.5 / 1.7 / 1.9 |
| Margins | 360–440 | Segmented control, 4 drawn page glyphs with a narrowing text block = 4 / 7 / 11 / 15 % |
| Alignment | 440–520 | Segmented control: Left · Justified (glyph + label) |
| Publisher styles | 520–600 | Segmented control: Keep · Fonts · All |

- Changes apply immediately. The changed control's value shows "…" while MuPDF re-lays out on the worker thread. The
  page re-renders at the same position. Page keys are ignored while the sheet is open.
- "This book only" off = the change becomes the default for all books without per-book overrides (as on desktop).
- Closing (BACK, a tap above the sheet) → FULL.

### 4.9 Search — in book and library-wide

**In-book search** (from the chrome `search`):
- Top bar: `back` at x 14, then a text input x 92–658 (56 px, keyboard opens, IME action "Search"), and a `close` icon
  button that clears it. The search runs on submit only (no per-keystroke search on this CPU).
- Status line under the bar (y 104): `meta` `ink-2` "Searching… 41%" → "23 results".
- Results, from y 144: 120 px rows. Line 1: chapter (`micro` `ink-2`, with ellipsis) and page (right, `micro` `ink-2`).
  Lines 2–3: a ~120-char snippet in Literata 21/1.4, with the match in **Literata Bold + 2 px underline**. 6 rows per
  page, plus the pager.
- Tap a result → the page, FULL. The match is boxed with a 3 px `ink` rectangle (2 px outset). A **search bar** stays
  at the bottom (0, 952, 758 × 72, 1 px `ink` top rule): `chevLeft` · "3 of 23" · `chevRight` · the query in `ink-2`
  with ellipsis · `close`. The chevrons go to the previous or next match (crossing pages); page keys still turn pages
  normally. `close` or BACK removes the bar.

**Library search** (from the library `search`):
- The same top bar. Placeholder: "Titles, authors and text".
- Title and author matches update 400 ms after typing stops (DB `LIKE`, cheap). Full-text matches (FTS4) run on submit.
- Results: a "BOOKS · 3" `badge` with list-mode rows (§4.2), then "IN BOOK TEXT · 27" with 112 px rows: book title
  (Inter 500 18) + page right `micro` `ink-2`, then a 2-line Literata 19 snippet with the match in Bold + underline. Tap
  → open the book at that location with the match boxed and the search bar showing.
- Paged with the pager; the BOOKS group appears only on page 1.
- No results: "No matches for 'whale'" (Literata 600 28) + "Text search covers books that finished indexing (186 of
  214)." (Inter 21 `ink-2`).

### 4.10 Highlights and notes (mockup `highlights.png`)

**Four styles in grayscale.** They map to the desktop's four colours, which keeps the stored index 0–3 compatible:

| # | Desktop | E-ink style | Drawing |
|---|---|---|---|
| 0 | yellow | **Fill** | `tint` `#CCCCCC` rect per line quad (quad height × the line box), blended with `PorterDuff.Mode.DARKEN`, so text stays black and paper turns `tint` |
| 1 | green | **Underline** | 3 px `ink` line at baseline + 0.18 em, across the quad width |
| 2 | blue | **Dashed** | the same line as Underline, dashed: 8 px on, 6 px off |
| 3 | pink | **Margin bar** | 5 px `ink` bar in the left margin (x = text left − 22 px; for PDFs, quad left − 12, clamped ≥ 4), from the first line's top + 4 to the last line's bottom − 4. The text itself is untouched, which suits long passages. |

- **Note mark:** a highlight with a note gets a 10 px filled `ink` circle at the top right of its last quad (+4 px x),
  the same dot the desktop shows.
- **Selection:** a long press selects the word under the finger. The selection is **inverted** (black boxes, white
  text) by XOR-ing the line quads. Handles: a 3 px `ink` stem at each end, the height of the line, with a 21 px `ink`
  knob below the line. The touch target is 64 × 64 around each knob. Dragging uses FAST; on release, PARTIAL.
- **Selection popover** (x 32–726, 84 px high, 2 px `ink` border, radius 8, 12 px paper halo):
  - Placement: 36 px below the selection's last line (clear of the knobs). If that does not fit above y 940, place it
    24 px above the first line.
  - Cells: 4 style swatches, 68 px wide, each "Ab" in Literata 24 drawn in its style. Then a 1 px `ink` divider inset
    12 px. Then the actions Note · Copy · Search, flex, each a 32 px icon over a `badge`-size label (Inter 15, not caps).
  - Tapping a swatch creates the highlight with that style and closes the popover. The last-used style is remembered
    but never applied without a tap.
  - Tapping an **existing highlight** opens the same popover with its style marked by a 3 px `ink` frame round the
    swatch, and the actions Note · Copy · Delete.
  - Copy → toast "Copied". Search → in-book search for the selected text.
- **Note editor:** a top-anchored panel (0, 0, 758 × 520, 2 px `ink` bottom rule), with the keyboard below it
  (`adjustResize`).
  - Header row (72 px): "Note" Literata 600 28 at x 32. Right: a "Cancel" text button and a "Save" primary button.
  - The quote (y 88): Literata italic 19/1.4 `ink-2`, max 3 lines, with a 4 px `ink` bar 16 px to its left.
  - Text input (32, ~200, 694 × 280), multi-line, Inter 21/1.45.
  - Save with empty text removes the note but keeps the highlight. BACK = Cancel; if the text changed, first show a
    dialog "Discard this note?" with Keep editing and a primary Discard.
- **Export:** Markdown at `/sdcard/Quire/Highlights/<Title>.md`. Format: one `## Chapter` heading per chapter, each
  highlight as a `> quote` block, the note under it as plain text, and `p. 15 · style` in italics. It is the same
  format as desktop export, with the colour names kept (`yellow`…) for round-tripping.

### 4.11 Go to page

A dialog, x 48, top 140, 662 wide, with its own numeric keypad (faster than the soft keyboard and no layout jump).

- Title "Go to page" (Inter 500 24); subtitle `meta` `ink-2` "1–612 · now on 12".
- Field: 598 × 80, 2 px `ink` border, radius 6, the number in Inter 500 40 tabular, right-aligned with 24 px padding.
  When empty, it shows the current page in `gray`.
- Keypad: 3 × 4 keys, each 194 × 72 with 8 px gaps. Digits Inter 500 28 on a 1 px `ink-2` border, radius 6. The last
  row is `⌫` (a drawn back icon) · 0 · **Go** (primary, inverted). Keys invert while pressed (FAST).
- An out-of-range number makes the subtitle read "Enter 1–612" in `ink`, and Go stays disabled.
- PDFs with page labels accept a label ("xii") through an "abc" text-input toggle at the left of the field. That toggle
  is optional and can come later.

### 4.12 Settings (mockup `settings.png`)

A full screen with a top bar (`back`, "Settings") and 2 pages with the pager. Rows follow §2.7. Section labels sit at
x 32, 24 px above their first row.

**Page 1**
- READING
  - Full refresh every: stepper "6 pages" (values in §3). Subtitle: "Clears ghosting. Lower is cleaner, slower."
  - Tap zones: a 42 × 56 mini diagram of the current layout + `chevRight` → picker screen (the three layouts drawn
    large at 200 × 270 each, selected with a 3 px frame; a "Mirror for left hand" switch).
  - Swap page-turn keys: switch. Subtitle "Top key goes forward".
  - Volume keys turn pages: switch (default on).
  - Status line: `chevRight` → radio list (§4.5). Subtitle shows the current value.
- LIBRARY
  - Book folders: subtitle with the folder list joined by " · " → folder screen (a list of folders with a remove
    `close` icon each, plus "Add folder…" → folder browser).
  - Rescan library: subtitle "214 books · scanned 2 min ago" + a secondary "Scan now" (its label becomes "Scanning…").
  - Show "Continue reading": switch.
- DATA
  - Export highlights & notes: subtitle "Markdown, to /sdcard/Quire/Highlights" → exports all books and shows a
    toast with the count.

**Page 2**
- DATA (cont.)
  - Cover cache: subtitle "12 MB" + a secondary "Clear".
  - Rebuild search index: subtitle "186 of 214 books indexed" + a secondary "Rebuild".
- READING (advanced)
  - Long-press page key skips chapter: switch (on).
  - Comics: reading direction: segmented Left to right · Right to left.
- ABOUT
  - Quire for e-ink: subtitle "Version 1.0 (build 7)". Licenses `chevRight` → a plain text screen, paged, Inter 18
    (MuPDF AGPL notice + source link, OFL for the three fonts).

**Folder browser** (used by Book folders and Locate file): the top bar shows the folder name; under it, the full path
in `meta` `ink-2` (y 100). Rows of 72 px: `folder` icon + name, or the file name for Locate (only supported formats).
A first row ".. Up" when not at `/sdcard`. Paged. A bottom action bar (0, 948, 758 × 76, 1 px `ink` top rule) holds a
primary "Use this folder" (hidden in Locate mode).

### 4.13 Dialogs and messages (copy)

| Case | Dialog |
|---|---|
| Can't open a file | "Can't open this book" / "MuPDF couldn't read 'x.epub'. The file may be damaged or DRM-protected." / OK |
| Password PDF | Title "Password needed"; a password input (keyboard); Cancel / Open. Wrong password: the subtitle reads "That password didn't work." in `ink`. |
| Delete file | §4.3 |
| Discard note | §4.10 |
| Low memory while rendering | Re-render at a lower resolution and say nothing. Only a repeat failure shows "This page is too large to display." on the page itself. |

---

## 5. PDF and comics

The **View sheet** replaces Typography for fixed-layout formats. Same sheet geometry, height 552 (y 472–1024),
title "View".

| Row | Control | Values / behaviour |
|---|---|---|
| Fit | Segmented | **Page** · Width · Height-crop. *Width:* the page fits the screen width and pages step by one screenful with 48 px overlap (top → bottom, then the next page). Page keys and taps step screenfuls. A 3 px `ink` tick at the right edge shows the position within the page (FAST). |
| Crop margins | Segmented | Off · **Auto**. Auto computes the content bounding box once per page (threshold luma < 245, ignores specks < 0.3 % of the area, adds 2 % padding) and caches it in the DB. Comics: off by default. |
| Contrast | Segmented, with a `contrast` icon | **Off** · Medium (gamma 1.4, black point 8 %) · Strong (gamma 1.8, black point 15 %, white point 92 %). Applied to the pixmap before dithering. For faint scans. |
| Rotate | Segmented, with a `rotate` icon | **0°** · 90°. Rotates the content for landscape spreads; the UI stays portrait. |
| Direction (comics) | Segmented | **Left to right** · Right to left (also swaps the tap zones and keys) |
| This book only | Switch | View settings are per book by default for PDFs (on) |

- Render at device pixels (no oversampling beyond 1×), as an 8-bit gray pixmap (MuPDF `DeviceGray`). Floyd–Steinberg
  dither to 16 levels for images, comics and scans. For PDFs that are mostly text, skip the dither: MuPDF's antialiased
  text quantised straight to 16 levels is sharper.
- **Prefetch:** keep the next page rendered (and the previous one, if memory allows: ≤ 2 bitmaps of 758 × 1024 ALPHA_8
  = 1.5 MB).
- No continuous scroll, no zoom gestures, no thumbnails grid (§6). A "Zoom" is just Fit = Width.
- Text selection and highlights work the same on PDFs that have a text layer; on scans, a long press does nothing.

---

## 6. Intentionally not ported

- **Themes** (Dark, Sepia, Solarized, OLED, custom theme editor), Mica, blur, shadows, the accent colour: e-ink has one
  paper theme. A future "invert" (night) mode would be a single global flag, not a theme.
- **All motion:** transitions, chrome fade, hover, focus rings, tooltips, the switch overshoot.
- Keyboard shortcuts, the command palette, the cheat sheet, multi-window, drag and drop.
- Read-aloud, OCR, the dictionary and Wikipedia lookups, focus mode, reading ruler, footnote popovers (footnote links
  jump, and the "Back to p. n" chip returns), the PDF thumbnails grid, two-page spreads, continuous scroll, zoom gestures.
- Typography sliders for paragraph spacing, line width and hyphenation: "Margins" covers measure, and MuPDF does not
  hyphenate.
- More than one hero book in "Continue reading" (the desktop shows 3): there is room for one.
- Coloured highlights (styles instead, §4.10) and coloured covers (dithered grayscale).

---

## 7. Recognisability checklist (what makes it Quire)

Literata titles over Inter UI · the "Good evening" greeting · a single "Continue reading" hero with a thin progress line
and a Resume button · format badges and bottom progress strips on covers · the typographic generated covers · the
left-bar "current" marker in Contents · the typography panel's exact controls (font list, size, line spacing, margins,
alignment, Keep/Fonts/All publisher styles, "This book only", Reset) · the four-way highlight popover with Note and
Copy · the "n min left in chapter" footer · the Q-in-folded-sheets icon.

---

## 8. Watch-outs for implementers

1. **Blinking text cursors** trigger a refresh twice a second. On API 17 the blink can't be turned off per view.
   Measure it on the device. If the vendor refresh does not ignore it, use `setCursorVisible(false)` and draw a static
   2 px `ink` caret yourself in a small `EditText` subclass (`onDraw` from `getLayout().getPrimaryHorizontal`).
2. **Holo leaks:** set `android:windowAnimationStyle` and `windowEnterAnimation`/`windowExitAnimation` to `@null`
   (Activity, Dialog and PopupWindow animations), `overridePendingTransition(0, 0)` on every start/finish, and
   `setBackgroundDrawable(null)` on window decor where possible. Replace every selector drawable (list selectors,
   button backgrounds) with flat ones, or the holo pressed glow appears. Use `android:Theme.Holo.Light.NoActionBar.Fullscreen`
   as the base and override.
3. **Never use** `ListView` fling or `ScrollView`. Use plain `ViewGroup`s laid out per page. They are also cheaper on
   the heap than adapters with recycling, at these page sizes.
4. **Gray values must be exact** (§2.1). Antialiasing is fine. Bitmaps (covers, pages) must be dithered to 16 levels
   before display, or banding and ghosting get worse.
5. **One redraw per interaction.** Batch state changes, then invalidate once. Async results (covers, page counts,
   search progress) must be coalesced (§3) so a list page doesn't redraw 12 times as covers arrive.
6. **Typeface caching** (§2.2) and **bitmap budget:** page bitmaps ALPHA_8 or RGB_565, never ARGB_8888 at full screen
   unless needed; library covers ≤ 12 decoded at once.
7. **Fonts in MuPDF:** the bundled TTFs must be readable by the native engine (copy them from assets to
   `getFilesDir()/fonts` on first run if MuPDF can't read from the APK).
8. **RTL and Persian:** the F1 is sold by Fidibo, so expect Persian EPUBs. The bundled faces have no Arabic script.
   Android 4.2's TextView falls back to Droid Naskh / Droid Sans Arabic for UI text (titles in the library), so set
   `android:supportsRtl="true"`. For book pages, E0/E3 must verify that the MuPDF build includes its Noto Arabic and
   Naskh fallback fonts and HarfBuzz shaping. If it doesn't, Persian books render as boxes. If needed, bundle
   **Vazirmatn** (OFL, static TTF, ~100 KB per weight) as a reading-font fallback.
9. **Page numbering** of reflowable books changes with typography. Store positions, not page numbers (bookmarks,
   highlights, progress), and display numbers computed from the current layout.
10. **Long-press timing** uses `ViewConfiguration.getLongPressTimeout()` (500 ms on 4.2). Don't shorten it: e-ink
    taps are slow and deliberate.
11. **Launcher icon:** `docs/icon/ic_launcher-{mdpi-48,hdpi-72,xhdpi-96,xxhdpi-144}.png` → `res/mipmap-*` (or
    `drawable-*` on API 17) as `ic_launcher.png`. The F1 is tvdpi, so Android scales the hdpi file. It is a flat
    `#AAAAAA` tile with a black rim and the black folded-sheet Q, snapped to 16 grays. The source SVG is
    `docs/icon/ic_launcher.svg`.
