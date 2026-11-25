<!--
  ReaderView — PLACEHOLDER from T5 (app shell). T8 owns this folder and replaces this file.

  Contract
  - Props: `{ bookId: string }`. Mounted by App.svelte when `app.view === 'reader'`; re-mounted per book
    (keyed by bookId). Everything else about the book is in `app.book` (OpenBook from '../stores/app.svelte'):
    `{ id, path?, title, format, source: BookSource (hand to Engine.open), progress?, startImage? }`.
  - Layout: fills the whole window. The title bar FLOATS over your top 40px (data-chrome="top")
    and fades with the chrome; keep your page's top margin ≥ 40px or accept it overlapping.
  - Chrome: mark toolbars/overlays `data-chrome="top" | "bottom"`; they fade 2 s after the last input.
    `chrome.hold()` / `chrome.show()` from '../shell/chrome.svelte' while a panel must stay visible.
  - Title bar: `setTitleBar({ title, subtitle, trailing })` from '../shell/titlebarSlots.svelte' (returns reset).
  - Close: `closeBook()` from '../stores/app.svelte' (Esc already does this via `app.back`).
  - Key context: the shell sets the base to 'reader.fixed' | 'reader.reflow' | 'comic' from the format;
    override with `contextStack.setBase(...)` if needed. Register reader.* commands while mounted.
  - Palette: register '@' (toc), '#' (goto) and '/' (search) providers with `registerPaletteProvider`.
-->
<script lang="ts">
  import { app } from '../stores/app.svelte';
  import { ProgressBar } from '../ui';

  interface Props {
    bookId: string;
  }
  let { bookId }: Props = $props();
  const book = $derived(app.book?.id === bookId ? app.book : null);
</script>

<div class="reader" data-testid="reader-view" data-book-id={bookId}>
  <article class="page">
    <p class="eyebrow">{book?.format?.toUpperCase()}</p>
    <h1>{book?.title}</h1>
    <p class="lede">The reader arrives with the engines. Move the mouse or press a key and the chrome returns; stay still and only the page remains.</p>
  </article>
  <div class="status" data-chrome="bottom" data-testid="reader-status">
    <span>Placeholder reader</span>
    <span class="tabular">0%</span>
  </div>
  <div class="progress"><ProgressBar variant="line" value={0} label="Book progress" /></div>
</div>

<style>
  .reader { position: relative; height: 100%; background: var(--bg); display: grid; place-items: center; }
  .page { max-width: 62ch; padding: var(--space-16) var(--space-6); font-family: var(--font-reading); }
  .eyebrow { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-caps); color: var(--muted); font-weight: var(--weight-semibold); }
  h1 { margin: var(--space-2) 0 var(--space-4); font-size: 32px; font-weight: 500; }
  .lede { font-size: 19px; line-height: 1.6; color: var(--text); }
  .status {
    position: absolute;
    right: var(--space-6);
    bottom: var(--space-4);
    display: flex;
    gap: var(--space-3);
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .progress { position: absolute; inset: auto 0 0 0; }
</style>
