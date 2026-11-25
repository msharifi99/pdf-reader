# Quire — a premium reading app for Windows

> Working name: **Quire** (a quire is a gathering of bound pages). Rename any time.
> Status: `ready-for-agent`. There is no issue tracker set up yet, so this spec lives in the repo.

## Glossary

- **Document**: one file on disk that Quire can open (PDF, EPUB, MOBI, AZW3, FB2, CBZ, CBR or an image).
- **Book**: the library entry for a document. It holds metadata, cover, progress and annotations. A Book is identified by a **content fingerprint**, not by its file path, so moving or renaming the file keeps everything.
- **Engine**: the module that renders one family of formats: the PDF Engine, the Reflow Engine (ebooks), and the Comic & Image Engine.
- **Locator**: an engine-neutral position in a Book. Progress, bookmarks, highlights, search hits and TOC entries are all expressed as Locators.
- **Annotation**: a Bookmark, a Highlight, or a Note (a Highlight with text attached).
- **Command**: a named user action, such as `reader.nextPage`, `annotate.highlightYellow` or `app.openPalette`. Shortcuts, menus, the command palette and buttons all trigger Commands.
- **Keymap**: the mapping from key sequences to Commands.
- **Theme**: a named colour scheme (Dark, Solarized Light and others).
- **Typography Profile**: the text settings applied to reflowable Books, either global or overridden per Book.
- **Page Tint**: how a fixed-layout page (a PDF or comic page) is recoloured to match the Theme.

## Problem Statement

I read a lot on Windows: PDFs, ebooks and comics. The readers I have fall into two camps. Some are ugly and cluttered, with toolbars, ribbons and dialogs, and tiring to stay in for an hour. Others look fine but handle only one format, render badly, or can't be driven from the keyboard. Reading at night in a white PDF viewer hurts my eyes. EPUB readers either ignore my font preferences or hide them away. Opening a file means hunting for where I left off. Highlights are locked inside one app. Shortcuts are fixed, so I can't make the app work the way my hands want.

I want one reader for everything I read. It should get out of the way, look beautiful, open instantly, remember everything, and make me want to keep reading.

## Solution

Quire is a native-feeling Windows 11 desktop app, built with Tauri 2, a Rust core and a Svelte UI rendered in WebView2. It opens PDF, EPUB, MOBI/AZW3, FB2, CBZ/CBR and common image formats and renders them correctly.

- **Minimal and premium**: a frameless window with Mica translucency. All controls fade away while you read and come back when you move the mouse or press a key. Generous whitespace, one accent colour, and gentle 150–200 ms motion.
- **Themes**: Dark (soft, not pure black) and Solarized Light are the headline themes. Also included: Light, Sepia, OLED Black, and a custom theme editor. Ebooks follow the theme fully. PDF and comic pages are recoloured with Page Tint (Smart, Invert or Original, chosen per document).
- **Your typography**: for ebooks, choose the font (bundled reading fonts or any installed font), size, line spacing, paragraph spacing, margins, line width, alignment and hyphenation. You can also override the publisher's styles.
- **Keyboard first**: every action is a Command. Every Command can be reached through the Ctrl+K command palette and rebound in a visual shortcuts editor that warns about conflicts.
- **Keeps you reading**: it reopens exactly where you left off and shows chapter and book progress with "minutes left" estimates based on your own reading speed. Also: focus mode, a line-focus reading ruler, auto-scroll, read-aloud with the spoken words highlighted, and instant word lookup.
- **Highlights, notes and bookmarks** in every format. They are stored by Quire and never written into your files, and can be exported to Markdown.
- **A library home screen** with covers, progress, collections, watched folders, and full-text search across every book you own. Scanned PDFs are made searchable with the offline OCR built into Windows.
- **Fast and light**: about a 10 MB installer, sub-second cold start, the first page on screen almost instantly, and low idle memory.

## User Stories

### Opening and formats

1. As a reader, I want to open PDFs, so that I can read papers, manuals and books in one app.
2. As a reader, I want to open EPUB (2 and 3) files with correct styling, images, footnotes and embedded fonts, so that ebooks look the way they should.
3. As a reader, I want to open MOBI and AZW3 files without DRM, so that my older Kindle-format books work too.
4. As a reader, I want to open FB2 files, so that books in that format are readable.
5. As a comic reader, I want to open CBZ and CBR archives, so that I can read comics and manga.
6. As a reader, I want to open single images (PNG, JPEG, WebP, AVIF, GIF, BMP, TIFF, SVG) and folders of images, so that scanned pages and photo sets read like a book.
7. As a reader, I want to double-click a supported file in Explorer and have it open in Quire, so that I never have to launch the app first.
8. As a reader, I want Quire to appear in "Open with" for every supported type, so that I can make it the default if I like.
9. As a reader, I want to drag a file onto the window to open it, so that opening is effortless.
10. As a reader, I want Ctrl+O to open a file picker filtered to supported formats, so that I can open files from the keyboard.
11. As a reader, I want double-clicking a second file while Quire is running to reuse the running app instead of starting a new copy, so that it stays fast and tidy.
12. As a reader, I want to be asked for the password when I open a password-protected PDF, so that I can read encrypted documents.
13. As a reader, I want a clear, calm message when a file is corrupt, unsupported or DRM-protected, so that I know why it won't open and the app never crashes.
14. As a reader, I want PDF hyperlinks, internal links and the document outline to work, so that I can navigate technical documents.
15. As a reader, I want PDF form fields and annotations made in other apps to display correctly, so that documents look complete.
16. As a reader, I want very large PDFs (2,000+ pages, 500 MB+) to open quickly and scroll smoothly, so that big books are not painful.

### Library

17. As a reader, I want a home screen that shows my books as covers, so that I can pick up any book at a glance.
18. As a reader, I want each cover to show my reading progress, so that I can see what I'm in the middle of.
19. As a reader, I want a "Continue reading" row at the top showing my most recent books, so that resuming takes one click or one key.
20. As a reader, I want every file I open added to the library automatically, so that I never have to import anything.
21. As a reader, I want to add folders that Quire watches, so that new files dropped there appear automatically.
22. As a reader, I want moved or renamed files to keep their progress and annotations, so that tidying my folders never loses anything.
23. As a reader, I want missing files shown as unavailable rather than silently removed, so that annotations aren't lost when a drive is unplugged.
24. As a reader, I want to switch between a grid of covers and a compact list, so that I can browse however suits the moment.
25. As a reader, I want to sort by recently read, recently added, title, author or progress, so that I can find books in the order I think of them.
26. As a reader, I want to filter by format, by status (unread, reading, finished) and by collection, so that I can narrow a large library.
27. As a reader, I want to create collections and put a book in several of them, so that I can organise books my way.
28. As a reader, I want to mark a book as finished or unread, so that the library reflects reality.
29. As a reader, I want to edit a book's title, author and cover, so that badly tagged files look right.
30. As a reader, I want title, author and cover extracted from each file's metadata automatically, so that the library looks good with no effort.
31. As a reader, I want to search the library by title and author as I type, so that I can find a book instantly.
32. As a reader, I want full-text search across the contents of every book in my library, so that I can find that passage I half-remember.
33. As a reader, I want to remove a book from the library without deleting the file, so that I control what's on disk.
34. As a reader, I want to reveal a book's file in Explorer, so that I can manage it outside Quire.
35. As a reader, I want the whole library to be navigable by keyboard (arrow keys, Enter, type-to-search), so that I never need the mouse.

### Reading and navigation

36. As a reader, I want every book to reopen at exactly the position where I stopped, so that I never hunt for my place.
37. As a reader, I want ebooks shown as pages by default and PDFs as a continuous scroll, so that each format feels natural.
38. As a reader, I want to switch any book between paginated and scrolled, and have that remembered for the book, so that I can read each one my way.
39. As a reader, I want a two-page spread on wide windows, so that reading feels like an open book.
40. As a reader, I want to turn pages with the arrow keys, Space, Shift+Space, PageUp/PageDown, j/k and the mouse wheel, so that paging feels natural whatever my habit.
41. As a reader, I want smooth, subtle page-turn and scroll animations that I can turn off, so that the app feels premium without slowing me down.
42. As a reader, I want a table of contents sidebar that highlights the current chapter, so that I always know where I am.
43. As a reader, I want a page thumbnail sidebar for PDFs and comics, so that I can jump visually.
44. As a reader, I want to go to a page number, a percentage or a chapter from the keyboard, so that I can jump precisely.
45. As a reader, I want back and forward history after following links or jumping, so that I can return to where I was.
46. As a reader, I want to search within the current book with Ctrl+F, all matches highlighted and Enter/Shift+Enter to step through them, so that finding things is fast.
47. As a reader, I want search results listed with surrounding context, so that I can choose the right hit.
48. As a reader, I want ebook footnotes to open in a small popup instead of jumping away, so that my reading isn't broken up.
49. As a reader, I want to zoom PDFs and comics with Ctrl+wheel, Ctrl+plus/minus and pinch, and to choose fit width, fit page or actual size, so that any page is comfortable to read.
50. As a reader, I want zoom and fit mode remembered per book, so that each document opens the way I like it.
51. As a reader, I want to rotate PDF pages in the view, so that sideways scans are readable.
52. As a reader, I want to copy selected text, so that I can quote from any book.

### Comics and images

53. As a comic reader, I want single-page, double-page and webtoon (continuous vertical) modes, so that every kind of comic reads correctly.
54. As a manga reader, I want right-to-left reading per book, so that manga pages and keys go in the right direction.
55. As a comic reader, I want double-page spreads detected and shown whole, so that two-page artwork isn't split.
56. As a comic reader, I want fit-height, fit-width and fit-screen modes, so that I can read on any monitor.
57. As a comic reader, I want the next pages preloaded, so that turning pages is instant.

### Themes and look

58. As a reader, I want a soft Dark theme, so that I can read comfortably at night.
59. As a reader, I want a Solarized Light theme, so that daytime reading is warm and easy on the eyes.
60. As a reader, I want Light, Sepia and OLED Black themes too, so that I have a choice for every light.
61. As a reader, I want a custom theme editor (background, text, accent, link, selection), so that I can make my own palette.
62. As a reader, I want Quire to follow the Windows light or dark setting automatically, with a light theme and a dark theme of my choosing, so that it matches the time of day.
63. As a reader, I want PDF and comic pages recoloured to match the theme (Smart Page Tint keeps photos natural), so that a white page doesn't blind me in Dark mode.
64. As a reader, I want to switch Page Tint per document between Smart, Invert and Original, so that awkward files still look right.
65. As a reader, I want every control to fade away while I read and come back when I move the mouse or press a key, so that only the text remains.
66. As a reader, I want a frameless window with Mica translucency and a title bar that disappears while I read, so that the app feels modern and calm.
67. As a reader, I want a fullscreen mode (F11), so that I can read with zero distraction.
68. As a reader, I want theme changes to cross-fade smoothly, so that switching never jolts.

### Typography (reflowable books)

69. As a reader, I want to choose from a set of carefully chosen bundled reading fonts (serif, sans and a high-legibility face), so that text looks great out of the box.
70. As a reader, I want to use any font installed on my system, so that my favourite font works.
71. As a reader, I want to change font size, line spacing, paragraph spacing, page margins and maximum line width with live preview, so that I can tune text to my eyes.
72. As a reader, I want justified or left-aligned text, with optional hyphenation, so that paragraphs look how I like.
73. As a reader, I want a switch that overrides the publisher's fonts and colours, so that badly styled books become readable.
74. As a reader, I want my typography settings to apply to all books, with an optional override for one book, so that I set things once but can still make exceptions.
75. As a reader, I want to save and switch between named Typography Profiles (for example "Night novel" and "Dense nonfiction"), so that I can change setup in one step.
76. As a reader, I want quick keyboard shortcuts to make text bigger or smaller, so that I can adjust without opening settings.

### Engagement and focus

77. As a reader, I want a slim progress line showing how far through the book I am, so that I always feel my progress.
78. As a reader, I want "X min left in chapter" and "Y h left in book", estimated from my own reading speed, so that I can decide whether to read one more chapter.
79. As a reader, I want a focus mode that hides everything except the text, so that I can get absorbed.
80. As a reader, I want an optional reading ruler that dims everything except the current lines, so that I keep my place in dense text.
81. As a reader, I want auto-scroll with an adjustable speed, so that I can read hands-free.
82. As a reader, I want Quire to read the book aloud with Windows voices, highlighting each word as it's spoken and turning pages automatically, so that I can listen and follow along.
83. As a reader, I want to control read-aloud speed, voice, pause and resume, and skip by sentence, so that listening is comfortable.
84. As a reader, I want to select a word and see its definition instantly, offline, so that unknown words don't stop me.
85. As a reader, I want a quick Wikipedia summary of a selected term (when I'm online), so that I can look up names and concepts without leaving the book.
86. As a reader, I want Quire to restore the windows and books I had open when I relaunch it, so that I pick up exactly where I was.

### Annotations

87. As a reader, I want to highlight selected text in four colours (yellow, green, blue, pink), so that I can mark what matters.
88. As a reader, I want to highlight from the keyboard (1–4 for colours once text is selected) as well as from a small floating menu, so that marking text is quick.
89. As a reader, I want to attach a note to any highlight, so that I can write down my thoughts.
90. As a reader, I want to bookmark the current position with one key, so that I can mark places to return to.
91. As a reader, I want to give bookmarks optional names, so that I can tell them apart.
92. As a reader, I want an annotations panel listing every highlight, note and bookmark in the book, ordered by position and filterable by colour or type, so that I can review them.
93. As a reader, I want clicking an annotation in the panel to jump to it, so that I can go back to the context.
94. As a reader, I want to edit, recolour and delete annotations, and undo with Ctrl+Z, so that mistakes are easy to fix.
95. As a reader, I want highlights to work in PDFs, ebooks and OCR'd scans alike, so that every format is equal.
96. As a reader, I want annotations kept by Quire and never written into my files, so that my originals stay untouched.
97. As a reader, I want to export a book's highlights and notes to Markdown (Obsidian-friendly, with chapter headings and page references), so that my notes can live in my knowledge base.
98. As a reader, I want to copy a highlight as a formatted quote with its citation, so that quoting is fast.
99. As a reader, I want a library-wide view of all my highlights, searchable, so that I can find any note I've ever made.

### OCR

100. As a reader, I want scanned PDFs and image books detected as having no text, with an offer to make them searchable, so that I can search and highlight them.
101. As a reader, I want OCR to run in the background, offline, using the OCR built into Windows, with progress shown, so that it never blocks reading.
102. As a reader, I want OCR results cached, so that it only ever runs once per book.

### Keyboard and commands

103. As a power user, I want every action to be a Command available in a Ctrl+K command palette with fuzzy search, so that I can do anything without remembering a key.
104. As a power user, I want the palette to show each Command's current shortcut, so that I learn the keys as I use it.
105. As a power user, I want a visual shortcuts editor where I click a Command and press a new key combination, so that rebinding is effortless.
106. As a power user, I want conflicts flagged as I rebind, with the choice to swap or cancel, so that I never break a shortcut by accident.
107. As a power user, I want multi-key sequences (for example `g g` for the start and `G` for the end), so that I can set up Vim-style navigation.
108. As a power user, I want several shortcuts for the same Command, so that both arrows and j/k work.
109. As a power user, I want separate key contexts (library, reader, comic, dialog), so that the same key can mean the right thing in each place.
110. As a power user, I want to reset one shortcut or all shortcuts to the defaults, so that I can experiment safely.
111. As a power user, I want a "?" cheat-sheet overlay showing the active shortcuts, so that I can see them at a glance.
112. As a keyboard user, I want every screen, menu and dialog to be fully navigable with a visible focus ring, so that I never need the mouse.

### Settings, data and reliability

113. As a reader, I want a settings screen that is calm, searchable and previews changes live, so that customising is enjoyable.
114. As a reader, I want everything (progress, annotations, settings) saved automatically and instantly, so that a crash or power cut never loses anything.
115. As a reader, I want to back up and restore all my Quire data as one file, so that I can move to a new PC.
116. As a reader, I want Quire to work fully offline (only Wikipedia lookup uses the network), so that my reading is private and dependable.
117. As a reader, I want the app to start in under a second and use little memory, so that it feels light.
118. As a reader, I want a simple installer that registers the file types and creates a Start menu entry, so that setup takes a moment.
119. As a reader with accessibility needs, I want screen-reader labels, respect for the Windows "reduce motion" setting, and high-contrast-friendly themes, so that Quire works for me too.
120. As a reader, I want window size and position remembered, and support for multiple monitors and high DPI, so that it always looks sharp and sits where I put it.
121. As a reader, I want to Ctrl+click a book to open it in a new window, so that I can read two documents side by side.

## Implementation Decisions

### Platform and stack

- **Tauri 2** desktop app for Windows 10/11 x64, using the system **WebView2** runtime (already installed). Installer: Tauri's **NSIS** bundler, installed per user, with file-type associations registered as "Open with" (never forced as the default). No auto-update and no code signing, since this is personal use.
- **Rust core** for file system access, the database, indexing, OCR and window integration. **Svelte 5 + TypeScript + Vite** for the UI. The Rust toolchain is installed with `rustup`; the MSVC build tools are already installed.
- Tauri plugins: single-instance (routes file opens to the running app), window-state, dialog, fs, opener/shell (reveal in Explorer), deep-link/file-association handling. Window effects: frameless window, **Mica** backdrop, a custom title bar with Windows snap-layout support.

### Engines

All Engines share one **Engine interface**, so the reader shell, annotations, search, progress and read-aloud never branch on format:

- `open(source) → BookHandle`: metadata, TOC, layout kind (fixed or reflowable), and whether text is present.
- `render(target, locator)` and `goTo(locator)`, emitting `relocated(locator, progress)` events.
- `search(query) → stream of {locator, excerpt}`
- `getText(range)`, `selectionToAnchor(selection) → Anchor`, `anchorToRanges(anchor)` for drawing highlights.
- `setPresentation({theme, pageTint, typography, flow, spread, zoom, direction})`
- `textStream(fromLocator)` for read-aloud and indexing, and `dispose()`.

The three Engines:

- **PDF Engine**: **pdf.js** (canvas plus text layer plus annotation layer). It renders pages in a virtualised list (only pages near the viewport exist in the DOM), keeps an LRU bitmap cache, renders in a worker, and redraws at higher resolution on zoom. Page Tint is done in the canvas compositing stage. *Smart* keeps image regions as they are and remaps text and background luminance onto the Theme's background and foreground. *Invert* inverts the whole page with hue rotated back. *Original* leaves the page untouched.
- **Reflow Engine**: **foliate-js** for EPUB, MOBI/AZW3, FB2 and FBZ, with its paginator (CSS multi-column) and scrolled modes. Typography is applied as a user style sheet injected into each section, with an "override publisher styles" level that adds `!important` resets. Footnote popups use foliate's footnote detection.
- **Comic & Image Engine**: built in-house. CBZ is read with a zip reader in JS. CBR is read with **libarchive.js** (WASM, covering RAR4 and RAR5). Images and folders are listed by the Rust core. Pages are decoded with `createImageBitmap`, the next 3 pages are preloaded, and wide pages are detected as spreads. Modes are single, double and webtoon, with LTR/RTL. Page Tint applies here too, defaulting to Original.

Formats are sniffed by magic bytes, not by extension.

### Locators and anchors

```ts
type Locator =
  | { kind: 'fixed';  page: number; y?: number }            // PDF, comic, image
  | { kind: 'reflow'; cfi: string; fraction: number };      // EPUB-family; fraction = 0..1 of book
type Anchor = {
  locator: Locator;
  quote: { exact: string; prefix: string; suffix: string }; // re-anchoring fallback
  pdfQuads?: number[][];                                     // PDF text quads, page space
  cfiRange?: string;                                         // reflowable
};
```

If a stored anchor no longer resolves, for example because the publisher changed the file, it is re-anchored by fuzzy-matching the quote near the old locator.

### Library and data (Rust core)

- **SQLite** (rusqlite, bundled) in the app data folder, using WAL mode and FTS5. Tables: `books` (fingerprint, path(s), format, title, author, cover thumbnail path, page count or word count, status, added_at, last_opened_at, per-book settings JSON), `collections`, `book_collections`, `progress` (locator, fraction, updated_at), `annotations` (id, book, type, colour, anchor JSON, note, created_at, updated_at, deleted_at for undo), `reading_sessions` (book, start, end, words or pages read, used only to estimate reading speed for "time left"), `watched_folders`, `settings` (key/value JSON), `keymap` (stored as JSON in settings), `ocr_pages`, and `text_index` (FTS5 over book text chunks with locators).
- **Fingerprint**: a BLAKE3 hash of the file size plus the first and last 1 MB. When a file appears at a new path with a known fingerprint, it re-links to the existing Book.
- **Watched folders** use the `notify` crate with debounced events. New files are fingerprinted, metadata and covers are extracted, and indexing is queued in the background.
- **Indexing**: book text is extracted in the background (through the Engine's `textStream`, driven by a hidden indexing webview, or by Rust-side extractors where practical) and stored as chunks in FTS5 with Locators, for library-wide full-text search. The work is throttled and pauses while a book is being read.
- **Covers**: EPUB-family covers come from metadata. PDFs use the first page and comics the first image, rendered to WebP thumbnails in a cache folder.
- **Writes** are immediate and transactional. Progress is debounced to one write every 2 seconds and flushed on close, suspend and blur. Backup and restore exports the database plus covers as one `.quire-backup` zip.

### OCR

- The **Windows.Media.Ocr** API is called from Rust through `windows-rs`. It runs offline, uses the language packs installed in Windows, and needs no extra download. Page bitmaps are rendered by the PDF Engine, sent to the core, and the core returns words with bounding boxes. These are stored in `ocr_pages` and fed back as a synthetic text layer, so search, selection, highlights and read-aloud work on scans.

### Read-aloud and lookup

- **Read-aloud** uses the Web Speech API (`speechSynthesis`) in WebView2, which exposes the installed Windows voices. Sentence-level utterances come from the Engine's `textStream`, and the boundary events drive word highlighting and automatic page turns.
- **Dictionary**: a bundled offline English dictionary (WordNet-derived, compressed SQLite, about 15–30 MB) queried by the core. **Wikipedia**: the REST summary endpoint is called only on explicit user action, and only the selected term is sent.

### Commands and Keymap

- A single **Command registry** in the UI: `{ id, title, category, contexts, run(args), enabled(state) }`. Every button, menu item, palette entry and shortcut goes through `commands.execute(id, args)`.
- **Keymap**: a map of `keySequence → commandId` per context (`global`, `library`, `reader`, `reader.fixed`, `reader.reflow`, `comic`, `dialog`). It supports chords and sequences with a 1 second sequence timeout, and several bindings per Command. Defaults ship as data. User overrides are stored as a diff from the defaults, so new defaults appear after updates. Conflict detection is checked per context, including the inherited global context.
- **Palette**: fuzzy search (fzf-style scoring) over Commands, recently used first. Typing `>` lists Commands, `@` lists TOC entries, `#` jumps to a page or percentage, and `/` searches the book. Palette-style pickers also cover library books (Ctrl+P) and annotations.
- **Default shortcuts** (all rebindable): arrows, Space, Shift+Space, PageUp/PageDown and j/k to move. Home/End and `g g`/`G` for the start and end. Ctrl+F to find. Ctrl+K for the palette. Ctrl+O to open. Ctrl+P to switch book. Ctrl+B to bookmark. 1–4 to highlight a selection. N to add a note. T for TOC. A for annotations. Ctrl+plus/minus for zoom or text size. F11 for fullscreen. F for focus mode. R for the ruler. S to start or stop auto-scroll. Ctrl+Shift+S to read aloud. Alt+Left/Right for history. Ctrl+, for settings. `?` for the cheat-sheet. Esc closes overlays and goes back to the library.

### Themes and design system

- Themes are design-token sets (background, surface, text, muted text, accent, link, selection, highlight colours ×4, shadow), applied as CSS custom properties. They are passed to the Engines as `theme` in presentation settings.
- Built-in themes: **Dark** (a soft charcoal around #1B1C1F with warm off-white text), **Solarized Light** (the canonical Solarized base3/base00 palette), **Light**, **Sepia** and **OLED Black**. There is also a custom theme editor that saves user themes, and automatic switching between a chosen light and dark theme that follows the Windows setting.
- Motion: 150–200 ms ease-out, with cross-fades on theme change. All motion respects `prefers-reduced-motion` plus an in-app toggle. The chrome auto-hides 2 seconds after the last input.
- Bundled fonts (all OFL): **Literata** and **Source Serif 4** (serif), **Inter** (UI and sans), **Atkinson Hyperlegible** (legibility) and **JetBrains Mono** (code blocks). System fonts are listed through the core.

### Windows and session

- The library is the home window. Opening a book replaces the library view in the same window, and Esc returns to it. Ctrl+click or the "Open in new window" Command opens a separate window, so two books can sit side by side. Open windows and books are restored on launch.

### Performance budget

- Cold start to an interactive library in under 800 ms on a typical SSD laptop. First page of a 1,000-page PDF visible in under 400 ms. Page turns in under 50 ms for reflowable books and cached comic pages. Idle memory under 150 MB with one book open. Installer under 20 MB, excluding the dictionary if it is shipped as an optional component.
- Heavy work (indexing, OCR, thumbnails, fingerprinting) runs off the UI thread in the Rust core or in workers.

## Testing Decisions

- **Good tests check what the user can observe through public interfaces**: where the reader ends up, what text is shown, which annotations exist, what the library lists. They never check component internals, DOM structure details or private functions. Tests must survive refactors.
- **Seam 1 (primary): the UI driven through the Command registry.** Playwright runs against the Vite build in Chromium, the same engine as WebView2. The Tauri IPC is replaced by an **in-memory fake core** that implements the same typed backend contract. Tests open fixture documents, call `commands.execute(...)` (or press keys, to check the Keymap), and assert on visible results: the current Locator, visible text, the number of highlights shown, the theme applied to the page, search hits. This one seam covers every Engine, the Keymap, the palette, annotations, typography and progress.
- **Seam 2: the backend contract tested in Rust.** Integration tests call the core's command functions against a temporary database and a temporary folder tree. They cover fingerprint re-linking after a move or rename, watched-folder ingestion, progress and annotation persistence, FTS search, backup and restore round-trips, and OCR word boxes on a fixture scan (Windows-only test).
- The backend contract is defined once, as a Rust type plus TypeScript types generated with **specta / tauri-specta**, so the fake core and the real core cannot drift apart.
- **Fixtures**: a small committed corpus of a text PDF, a scanned PDF, an encrypted PDF, a 2,000-page synthetic PDF, public-domain EPUB 2 and EPUB 3 files (with footnotes and embedded fonts), MOBI, AZW3, FB2, CBZ, CBR, an RTL manga CBZ, a folder of images, and a corrupt file for each format.
- **Visual checks**: Playwright screenshots of each theme × each Engine, compared against baselines, to catch rendering and Page Tint regressions.
- **Performance checks**: scripted timings for cold start and first-page-of-a-large-PDF, compared against the budget above. These warn rather than fail on CI noise.
- There is no prior art, since the repo is new. These tests set the pattern.

## Out of Scope

- Office formats (DOCX, PPTX, XLSX), XPS, DjVu and CHM. These may come later through a converter.
- DRM-protected books (Kindle KFX, Adobe ADEPT).
- Reading statistics, streaks and goals (only the reading speed used for "time left" is tracked).
- Writing annotations into the PDF or EPUB files, and importing annotations from other apps.
- Cloud sync, accounts, and mobile or macOS builds.
- Tabs within a window.
- Editing PDFs (merging, page reordering, form filling that saves to the file, signing).
- Auto-update, code signing and Microsoft Store distribution.
- AI features (summaries, chat with a book).

## Further Notes

- Licences: pdf.js (Apache-2.0), foliate-js (MIT), libarchive.js (MIT, with libarchive under BSD and unrar under the unRAR licence, which allows extraction) and the bundled OFL fonts are all fine for personal use and for a future public release. If the app is ever published, MuPDF (AGPL) was deliberately avoided.
- Suggested build order: (1) app shell, themes, Command registry, Keymap and palette; (2) PDF Engine with Page Tint; (3) library, fingerprints and progress; (4) Reflow Engine and typography; (5) annotations and export; (6) Comic & Image Engine; (7) search, FTS and OCR; (8) read-aloud, lookup, focus tools; (9) installer and file associations; (10) performance pass.
- Natural follow-ups: DjVu (through a WASM djvu.js port), syncing the database to a folder (for example OneDrive) so two PCs share progress, and optional AI summaries.
