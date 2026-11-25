# Quire E-ink (Android) — coordination board

A parallel, native Android build of Quire for a very low-end e-ink reader. It lives entirely under `android-eink/`
and never touches the desktop app (`src/`, `src-tauri/`, root `package.json`, etc.). Desktop `SPEC.md` describes
the product; this board says what the e-ink version keeps and how the work is split.

## Target device (probed over ADB, 2026-11-25)

| | |
|---|---|
| Device | Fidibook F1 (Boyue/Boeye OEM, `ro.boeye.machine=FIDIBO-f1`), Rockchip RK3026 |
| OS | Android 4.2.2, **API 17**, old WebKit WebView (no Chromium) → no web stack |
| CPU | 2× Cortex-A9 (ARMv7, NEON), ABI `armeabi-v7a` |
| RAM | **512 MB** total, ~90 MB free while Moon+ Reader runs. Heap per app is small: budget ≤ 48 MB Java heap |
| Screen | 758 × 1024 px, 212 dpi (density bucket hdpi-ish, `density 1.325`), grayscale e-ink, touch (goodix) |
| Storage | /data 1 GB (700 MB free), /sdcard 5.7 GB |
| Keys (`rk29-keypad.kl`) | `PAGE_UP` (92), `PAGE_DOWN` (93), `BACK`, `HOME`, `NOTIFICATION`, `POWER`. Also handle `VOLUME_UP/DOWN`, `DPAD_LEFT/RIGHT` as page turns for other devices |
| Other readers installed | Moon+ Reader, Boyue apps (`com.boyue.*`, `boeye.reader.bicp`) — may reveal the vendor e-ink refresh API |

## Architecture (fixed — do not change without the coordinator)

- Native **Java** (no Kotlin, no AndroidX/support libs — keeps the APK and heap tiny). `minSdk 17`, ABI `armeabi-v7a` only.
- Package id **`app.quire.eink`** (desktop is `app.quire.reader`). App name "Quire".
- Rendering engine: **MuPDF** via JNI (PDF, EPUB, FB2, CBZ, XPS, images; MOBI if the MuPDF version supports it). Reflowable books use MuPDF layout (`layout(w, h, em)`) + user CSS for typography.
- Gradle project at `android-eink/` with its own wrapper. Nothing in the root build references it.
- Storage: one SQLite DB (framework `android.database.sqlite`, FTS4 for library search). Covers cached as small grayscale PNGs in app cache.
- No animations anywhere. Draw on e-ink: pure black/white/4–16 grays, no gradients, no shadows except hard 1-px lines, partial refresh for UI, full refresh every N page turns (setting).
- All heavy work (render, layout, indexing, cover extraction) on one background worker thread with a priority queue; UI thread only blits bitmaps.

```
android-eink/
  COORDINATION.md, DESIGN.md (E-D1), README.md (build/install)
  settings.gradle, build.gradle, gradlew*, gradle/
  app/
    build.gradle
    src/main/AndroidManifest.xml
    src/main/java/app/quire/eink/
      QuireApp.java                    app singleton, DB, worker
      core/      Db, BookStore, Scanner, Covers, Settings, Worker   (E2)
      engine/    Document wrapper over MuPDF, PageCache, Reflow opts (E0/E3)
      eink/      Epd (vendor refresh API wrapper), Keys (page-turn mapping) (E0)
      ui/        LibraryActivity, ReaderActivity, views, dialogs      (E4/E5)
      annot/     highlights, notes, bookmarks, export                 (E6)
      search/    in-book search, FTS indexer                          (E7)
    src/main/res/  layouts, drawables (vector-free PNG/9-patch or code-drawn), fonts in assets/fonts
  libs/ or a maven dep for MuPDF (decided by E0)
```

## Scope (user decision)

Keep: library (scan + covers + continue reading + sort/filter + collections if cheap), reading PDF/EPUB/MOBI/FB2/CBZ (CBR if cheap),
contents/TOC, go-to page, progress, bookmarks, text size/font/margins/line spacing, **highlights & notes** (+ Markdown export to /sdcard),
**in-book search + library-wide search**.
Drop: keyboard shortcuts/palette/cheat-sheet, OCR, read-aloud, dictionary, Wikipedia, multi-window, themes editor, animations.

## Tasks

| ID | Task | Model | Depends | Status |
|----|------|-------|---------|--------|
| E0 | Toolchain + MuPDF spike: Gradle project, MuPDF on API 17, render PDF + EPUB page on device, page keys, find vendor e-ink refresh API, timings | sonnet | — | done (coordinator rebuilt + ran on device) |
| D1 | E-ink visual design: DESIGN.md (type, grays, spacing, every screen), font choice as static TTF, mockups | opus | — | done (mockups reviewed by coordinator; on-device check in E9) |
| E2 | Core: DB schema, library scanner, covers, progress, settings | sonnet | E0 | |
| E3 | Reader engine: page render pipeline, prefetch cache, reflow typography, tap zones, keys, refresh policy | sonnet | E0 | |
| E4 | Library UI per DESIGN.md | sonnet + opus review | E2 D1 | |
| E5 | Reader UI: chrome overlay, TOC, go-to, typography sheet, settings | sonnet + opus review | E3 D1 | |
| E6 | Highlights, notes, bookmarks, export | sonnet | E5 | |
| E7 | In-book search + library FTS index | sonnet | E2 E3 | |
| E8 | Perf + memory pass on device, release APK | sonnet | all | |
| E9 | Visual review on device screenshots | opus | E4 E5 E6 | |

## Log
- 2026-11-25: Device probed; Tauri impossible (needs API 24, Chromium WebView). Native Java + MuPDF chosen. Branch `eink-android`.
  Toolchain present: Android SDK (platforms 35/36, build-tools 35, cmdline-tools), JDK 21. Missing: Gradle (use wrapper), NDK.
- D1 done: DESIGN.md (601 lines), 6 mockups in docs/mockups (reviewed: premium, calm, recognisably Quire), launcher + 38 UI icons in docs/icon, 10 static TTFs (Literata, Inter, Atkinson Hyperlegible Next; 964 KB) in app/src/main/assets/fonts built by tools/make_fonts.py.
  Grays #000/#555 carry information, #AAA/#CCC decorative only. Highlights = 4 styles (gray fill, underline, dashed, margin bar) keeping desktop colour index 0–3. Lists paged, not scrolled.
  Watch-outs for E3/E5: Persian/Arabic-script books likely on a Fidibo device (needs MuPDF shaping + Vazirmatn fallback, RTL), cursor blink refreshes, MuPDF may need fonts copied to filesDir, load Typefaces once.
- E0 done: Gradle 8.9 / AGP 8.7.3 / JDK 21, minSdk+targetSdk 17. MuPDF 1.27.1 JNI built from source with NDK r23c (android-17) via tools/build-mupdf.bat — every Maven fitz AAR ≥1.20 fails dlopen on 4.2 (__strrchr_chk). Java half = fitz 1.27.1 classes.jar in app/libs. APK ~5 MB.
  Opens PDF, EPUB2/3, FB2, MOBI, AZW3, CBZ; not CBR (needs RAR lib) or FBZ (unzip to FB2 first). layout(w,h,em), setUserCSS, loadOutline work; default reflow margins ~0 → set via CSS.
  Render ARGB_8888 via AndroidDrawDevice (3.1 MB/page; RGB565 unsupported, gray→ARGB 2–4× slower). 3-slot cache. MuPDF not thread-safe → single worker thread.
  E-ink: View.requestEpdMode(View$EINK_MODE, boolean force) reflected in eink/Epd.java (EPD_FULL/PART/A2/...); call returns true, flash not visually confirmed.
  Keys 92/93 confirmed. Coordinator check: debug build OK, on device epub3 first page 859 ms, prefetched turns 26–82 ms, heap 8.5 MB.
  Slow paths: CBZ 300–560 ms/page, scanned PDF 200–320 ms/page. Fonts: JNI built with TOFU_NOTO/CJK/SIL → Arabic-script/CJK need bundled fonts.
- Concurrent desktop edits (PDF forms: src/, src-tauri/, tests/, public/fixtures/pdf/form.pdf) appeared in the working tree from another session — not ours, left untouched.
- MILESTONE: E0 + D1 verified. Paused at user's request before E2/E3.
