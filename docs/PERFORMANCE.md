# Performance

Budget (SPEC): cold start to an interactive library < 800 ms, first page of a 1,000-page PDF < 400 ms, page turns < 50 ms,
idle memory < 150 MB with one book open, installer < 20 MB, heavy work off the UI thread.

## Running it

    npm run perf                 # web layer, then the real app
    npm run perf -- --web        # Playwright against the production build (tests/perf/web.perf.ts)
    npm run perf -- --app        # the release exe (build it first: npm run tauri build)
    npm run perf -- --app --runs 5 --settle 30

It prints a table against the budget and only warns when a line is over (timings are machine-dependent; it never fails).
`QUIRE_EXE=<path>` measures another build, e.g. the installed `%LOCALAPPDATA%\Quire\quire.exe`.

- **Web layer** (`playwright.perf.config.ts`, one worker): library first-interactive, first page of `big.pdf` and of the
  generated 600 MB PDF (median of 5), EPUB and cached-comic page-turn medians, long tasks while scrolling the large PDF.
  Results: `test-results/perf-web.json`.
- **Real app** (`scripts/perf/app.mjs`): launches the exe with `QUIRE_PERF=1` against a throw-away APPDATA/LOCALAPPDATA
  (your library is never touched). One warm-up launch, then 5 cold-start runs (median), 5 first-page runs, and idle memory
  after opening a book and waiting 30 s, summed over quire.exe and every descendant msedgewebview2.exe (private working
  set, plus the sum of working sets). Results: `test-results/perf-app.json`.
- `QUIRE_PERF=1` makes the app append `epoch-ms pid mark` lines to `%TEMP%\quire-perf.log` (or `QUIRE_STARTUP_LOG`):
  `run`, `setup-start`, `db-open`, `setup-done`, `window-shown`, then from the webview `main-script`, `webview-dcl`,
  `library-interactive`, `open-start`, `first-page` (after two animation frames). Without the variable nothing is written.

## Before / after (release build, this machine, WebView2 158)

| Budget line | Before | After | Budget |
| --- | --- | --- | --- |
| Cold start to interactive library (median of 5) | 455 ms | 440 ms | 800 ms |
| First page, 2,000-page PDF (open to painted) | 1,093 ms | 160 ms | 400 ms |
| Idle memory, EPUB open (private working set, whole tree) | 134 MB | 100-120 MB | 150 MB |
| Idle memory, 2,000-page PDF open (private working set) | 1,001 MB | 117-151 MB | 150 MB |
| Sum of working sets, EPUB / PDF | 482 / 1,503 MB | 428 / 484 MB | n/a |
| Page turn, EPUB / cached comic (web layer) | 0.8 / 0.6 ms | 0.8 / 0.6 ms | 50 ms |
| Installer (incl. 16 MB dictionary) | 14.1 MB | 14.2 MB | 20 MB |
| Main-thread long tasks scrolling the 600 MB PDF | not measured | 0 | n/a |

Memory varies by about 20 MB between runs (the WebView2 browser/GPU processes are ~65 MB of every total). "Sum of working
sets" counts shared pages (DLLs) once per process, so it is much larger than private memory; the budget is read as private.

## What changed

- **The big one: the PDF engine mounted every page of a 2,000-page document in the real app** (the stage's `clientHeight` is
  the whole document height while it is still unconstrained, and nothing re-ran the mount pass). 2,000 page nodes, 900 MB,
  a 1 s first page. The visible range is now capped at the window height. Not reproducible in Chromium tests, found by
  attaching CDP to the release exe.
- Cold path: reader view, annotations, read-aloud/lookup and settings are dynamic imports. `App` chunk 158 -> 52 kB,
  `ui` 121 -> 47 kB; pdf.js (661 kB), foliate, libarchive and zip were already lazy. The reader chunk is warmed on idle
  250 ms after the shell mounts. The palette stays eager on purpose (keys typed right after Ctrl+K must find it).
  Fonts are `@font-face` with unicode-range, fetched on use; nothing is preloaded.
- Startup was already deferred: indexer window (4 s), cover pass (idle callbacks), dictionary opens on first lookup,
  watcher/rescan on a worker thread. `list_books` returns ~0.4 KB per book; the library is virtualised in the UI.
- Memory: the hidden indexer window now exists only while something needs indexing and the user isn't reading, and closes
  itself when done (`indexer_done`); WebView2 `MemoryUsageTargetLevel` is Low while a window is minimised; PDF and comic bitmap
  caches scale with `navigator.deviceMemory` (PDF 300 MB cap, comic 320 -> max 160 MB), shrink to 32 MB when the window is
  hidden, and the PDF cache keeps 24 MB after 4 s without scrolling.
- Packaging: CSP `style-src` gets `blob:` and Tauri's nonce injection is disabled for it (the nonce made WebView2 ignore
  `'unsafe-inline'`, blocking EPUB stylesheets and inline style attributes in the real app only).

## Tried, not kept

- `opt-level = 3`: exe 19.2 -> 23.2 MB, installer 14.2 -> 14.9 MB, cold start unchanged (447 vs 443 ms). Kept `"s"`.
- WebView2 flags (`--enable-low-end-device-mode`, background-networking/component-update/feature disables): no measurable change.
- Cold start is ~250 ms of WebView2 environment + window creation before `setup` even runs, then ~200 ms of module
  load, settings and the library query. Nothing in our control dominates.
