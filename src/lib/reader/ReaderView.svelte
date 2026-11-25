<!--
  ReaderView (T8): the screen where the user reads. Only the text remains; every control fades with
  the chrome and comes back on input.

  Contract (unchanged from T5)
  - Props `{ bookId }`; mounted by App.svelte per book (keyed by bookId). The book is `app.book`.
  - The title bar floats over the top 40px; reader toolbar buttons go in its `trailing` slot.
  - Esc: menus/dialogs/overlays (shell) → footnote → find → right panel → sidebar → focus mode →
    auto-scroll → back to the library (the reader re-registers `app.back` while mounted).

  Slots for annotations (T11) and read-aloud / lookup (T13): see ./slots.svelte.ts
  - Session:      `readerApi.session` (ReaderSession) — `.engine` (the Engine), `.handle`, `.location`
                  (last RelocatedEvent), `.jump(locator)` (history-aware), `.flush()`.
  - Selection:    `readerApi.session.onSelection(fn)` → fn({ anchor, text, rects } | null); rects are in
                  stage space, `readerApi.selectionRect()` gives the union in viewport coords for a
                  floating menu. `readerApi.session.selection` is the reactive current value.
  - Decorations:  `readerApi.session.decorate(layer, items)` → `engine.setDecorations` ('annotations',
                  'speech'; 'search' belongs to the find bar). Engines redraw on re-layout.
                  Decoration clicks: `readerApi.session.engine.on('decorationclick', ...)`.
  - Right panel:  `setReaderPanel({ id: 'annotations', title, body: snippet, width? })` registers it;
                  `readerApi.togglePanel('annotations')` shows it (the toolbar's Annotations button
                  appears once `annotate.togglePanel` is registered and runs that command).
  - Bottom bar:   `addBottomBarItem(snippet)` renders on the left of the bottom bar (fades with chrome).
  - Speech:       `engine.textStream(from)` + `decorate('speech', …)`; page turns via `engine.next()`.
                  Auto page-turn while speaking should call `readerApi.session.engine.goTo(chunk.locator)`.
  - Overlays:     `addReaderOverlay(snippet)` renders over the page once the book is ready and is torn
                  down on close: the place to mount the lookup popover and to call
                  `registerSpeechCommands` / `registerLookupCommands` in onMount (wiring in slots.svelte.ts).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app, closeBook, type OpenBook } from '../stores/app.svelte';
  import { settings } from '../stores/settings.svelte';
  import { chrome } from '../shell/chrome.svelte';
  import { setTitleBar } from '../shell/titlebarSlots.svelte';
  import { presentError } from '../shell/errors.svelte';
  import { core, isTauri } from '../core/core';
  import { commands, contextStack } from '../commands';
  import { Skeleton } from '../ui';
  import { ocr, setReadingActive, type OcrJob } from '../indexing';
  import type { EngineError } from '../engines/types';
  import { ReaderSession } from './session.svelte';
  import { FindState } from './find.svelte';
  import { ReadingTools } from './tools.svelte';
  import { ReaderUi } from './ui.svelte';
  import { registerReaderCommands } from './commands';
  import { registerReaderPalette } from './palette';
  import { readerApi } from './slots.svelte';
  import Toolbar from './Toolbar.svelte';
  import BottomBar from './BottomBar.svelte';
  import Sidebar from './Sidebar.svelte';
  import FindBar from './FindBar.svelte';
  import Footnote from './Footnote.svelte';
  import Ruler from './Ruler.svelte';
  import PasswordDialog from './PasswordDialog.svelte';
  import OcrBanner from './OcrBanner.svelte';
  import Hud from './Hud.svelte';

  interface Props {
    bookId: string;
  }
  let { bookId }: Props = $props();

  // Remounted per book, so the book is fixed for this instance.
  const book = untrack(() => ($state.snapshot(app.book) as OpenBook));
  const session = new ReaderSession(book);
  const ui = new ReaderUi();
  const find = new FindState(session);
  const tools = new ReadingTools(session);

  let stage: HTMLElement | undefined = $state();
  let password = $state<{ retry: boolean; resolve: (v: string | null) => void } | null>(null);
  let slow = $state(false);
  let ocrOffer = $state(false);
  let ocrProgress = $state<{ done: number; total: number } | null>(null);
  let ocrJob: OcrJob | null = null;
  let capsRev = $state(0);

  const handle = $derived((void capsRev, session.handle));
  const ready = $derived(session.status === 'ready');

  function requestPassword(retry: boolean): Promise<string | null> {
    return new Promise((resolve) => (password = { retry, resolve }));
  }

  function openExternal(href: string) {
    if (!/^(https?|mailto):/i.test(href)) return;
    if (isTauri()) void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(href)).catch((e) => console.warn('[reader] open link', e));
    else window.open(href, '_blank', 'noopener,noreferrer');
  }

  async function start() {
    const slowTimer = setTimeout(() => (slow = true), 140);
    try {
      await session.open(stage!, requestPassword);
      if (session.disposed) return;
      wireEngine();
      void prepareOcr();
    } catch (err) {
      if (session.disposed || (err as EngineError)?.code === 'aborted') return;
      presentError(err, { fileName: book.source.kind === 'file' ? (book.source.fileName ?? book.title) : book.title });
      if (app.book?.id === bookId) closeBook();
    } finally {
      clearTimeout(slowTimer);
      slow = false;
      password = null;
    }
  }

  // Reflow sections live in iframes: pointer moves there never reach us, so the ruler listens inside.
  const boundDocs = new WeakSet<Document>();
  function bindDocs() {
    const e = session.engine as { getContents?: () => { doc: Document }[] } | null;
    for (const { doc } of e?.getContents?.() ?? []) {
      if (boundDocs.has(doc)) continue;
      boundDocs.add(doc);
      doc.addEventListener('pointermove', (ev) => {
        const fr = doc.defaultView?.frameElement?.getBoundingClientRect();
        moveRuler(ev.clientY + (fr?.top ?? 0));
        chrome.show();
      });
    }
  }

  function wireEngine() {
    const e = session.engine!;
    const offs = [
      e.on('footnote', (f) => (ui.footnote = f)),
      e.on('link', (l) => {
        if (l.external) openExternal(l.href);
        ui.footnote = null;
      }),
      e.on('pointer', (p) => {
        if (p.button !== 0) return;
        ui.footnote = null;
        if (p.zone === 'center' || session.flow !== 'paginated') return;
        // edge taps turn the page; comics turn toward the side tapped (RTL aware)
        if (e.turnToward) void e.turnToward(p.zone);
        else void (p.zone === 'right' ? e.next() : e.prev());
      }),
      e.on('layout', bindDocs),
    ];
    bindDocs();
    cleanups.push(() => offs.forEach((f) => f()));
  }

  async function prepareOcr() {
    const h = session.handle;
    const e = session.engine;
    if (!h || !e || session.kind !== 'pdf' || !h.capabilities.ocr || /^(file|path):/.test(bookId)) return;
    try {
      const st = await ocr.prepare(bookId, e, h);
      capsRev++;
      ocrOffer = st.scanned && !st.complete && !session.bookSettings.ocrDismissed;
    } catch (err) {
      console.debug('[reader] OCR state unavailable', err);
    }
  }

  async function startOcr() {
    const h = session.handle;
    const e = session.engine;
    ocrOffer = false;
    if (!h?.pageCount || !e) return;
    ocrProgress = { done: 0, total: h.pageCount };
    ocrJob = ocr.start(bookId, e, { pageCount: h.pageCount, onProgress: (p) => (ocrProgress = { done: p.done, total: p.total }) });
    try {
      await ocrJob.done;
      capsRev++;
    } catch (err) {
      presentError(err);
    } finally {
      ocrProgress = null;
      ocrJob = null;
    }
  }

  function dismissOcr() {
    ocrOffer = false;
    session.setBookSetting({ ocrDismissed: true });
  }

  function moveRuler(clientY: number) {
    if (!tools.ruler || !stage) return;
    const r = stage.getBoundingClientRect();
    tools.rulerTop = Math.max(0, Math.min(r.height - tools.rulerHeight, clientY - r.top - tools.rulerHeight / 2));
  }

  // Wheel paging where the page itself can't scroll (paginated PDFs scroll-snap natively, reflow pages itself).
  let wheelAcc = 0;
  let wheelAt = 0;
  function onWheel(e: WheelEvent) {
    if (e.ctrlKey || !ready || session.flow !== 'paginated' || session.kind === 'reflow') return;
    const dy = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    for (let el = e.target as HTMLElement | null; el && el !== stage; el = el.parentElement) {
      const canScroll = el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
      if (canScroll && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return;
    }
    e.preventDefault();
    wheelAcc += dy;
    const now = performance.now();
    if (Math.abs(wheelAcc) < 50 || now - wheelAt < 320) return;
    wheelAt = now;
    const dir = wheelAcc > 0 ? 1 : -1;
    wheelAcc = 0;
    void commands.execute(dir > 0 ? 'reader.nextPage' : 'reader.prevPage');
  }

  const cleanups: (() => void)[] = [];

  onMount(() => {
    readerApi.session = session;
    readerApi.stage = stage ?? null;
    setReadingActive(true);
    const flush = () => void session.flush();
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(
      registerReaderCommands({ session, find, tools, ui, stage: () => stage ?? null }),
      registerReaderPalette(session, find),
      () => window.removeEventListener('blur', flush),
      () => window.removeEventListener('beforeunload', flush),
      () => window.removeEventListener('pagehide', flush),
      () => document.removeEventListener('visibilitychange', onVis),
    );
    if (import.meta.env.DEV || !isTauri()) (globalThis as Record<string, unknown>).__QUIRE_READER__ = { session, find, tools, ui, readerApi, core };
    void start();
    return () => {
      ocrJob?.cancel();
      cleanups.forEach((f) => f());
      find.cancel();
      tools.dispose();
      session.dispose();
      setReadingActive(false);
      if (readerApi.session === session) {
        readerApi.session = null;
        readerApi.stage = null;
        readerApi.panelId = null;
      }
    };
  });

  // Theme, typography profile, defaults and per-book settings → engine (only what changed).
  $effect(() => {
    void session.engine;
    session.applyPresentation();
  });
  $effect(() => {
    const on = settings.value.pageAnimations;
    untrack(() => session.engine?.setOptions?.({ animatePageTurns: on }));
  });

  // A shown panel keeps the chrome up (so the user sees where they are).
  $effect(() => {
    if (!ui.sidebar && !find.open && !readerApi.panelOpen) return;
    return chrome.hold();
  });
  // Images are comics: make sure the key context matches the engine actually used.
  $effect(() => {
    if (!session.engine) return;
    contextStack.setBase(session.engine.kind === 'pdf' ? 'reader.fixed' : session.engine.kind === 'comic' ? 'comic' : 'reader.reflow');
  });

  const chapter = $derived(session.location?.progress.chapter?.title);
  $effect(() => setTitleBar({ title: handle?.metadata.title || book.title, subtitle: chapter, trailing: toolbar }));
</script>

{#snippet toolbar()}
  <Toolbar {session} {ui} {find} {tools} handle={handle ?? null} />
{/snippet}

<section
  class="reader"
  class:ready
  class:focus={tools.focus}
  data-testid="reader-view"
  data-book-id={bookId}
  data-status={session.status}
  data-open-ms={session.openMs || undefined}
  aria-label="Reader: {handle?.metadata.title || book.title}"
  onpointermove={(e) => moveRuler(e.clientY)}
>
  <div class="body" style:--panel-w="{readerApi.panel?.width ?? 340}px">
    <div class="stage-wrap" onwheel={onWheel}>
      <div class="stage" bind:this={stage} data-testid="reader-stage"></div>
      {#if slow && !ready}
        <div class="skeleton" aria-hidden="true">
          <div class="sheet" class:fixed={session.kind !== 'reflow'}>
            <Skeleton width="38%" height="14px" />
            <Skeleton lines={6} height="10px" />
            <Skeleton lines={5} height="10px" />
          </div>
        </div>
      {/if}
      {#if tools.ruler && ready}<Ruler {tools} />{/if}
      {#if ui.footnote}<Footnote {ui} {session} />{/if}
      {#if ocrOffer}<OcrBanner onaccept={startOcr} ondismiss={dismissOcr} />{/if}
    </div>
    {#if ui.sidebar && ready && handle}
      <Sidebar {session} {ui} {handle} />
    {/if}
    {#if readerApi.panel}
      <aside class="panel" aria-label={readerApi.panel.title} data-testid="reader-panel">{@render readerApi.panel.body()}</aside>
    {/if}
  </div>

  {#if find.open}<FindBar {find} {session} />{/if}
  <BottomBar {session} {tools} {ocrProgress} />
  <Hud {tools} />
  {#if ready}{#each readerApi.overlays as overlay (overlay)}{@render overlay()}{/each}{/if}
  {#if !ready}<span class="sr-only" role="status">Opening {book.title}</span>{/if}
</section>

{#if password}
  <PasswordDialog
    retry={password.retry}
    title={book.title}
    onsubmit={(v) => {
      password?.resolve(v);
      password = null;
    }}
  />
{/if}

<style>
  .reader {
    position: relative;
    height: 100%;
    background: var(--bg);
    overflow: hidden;
  }
  .body {
    position: absolute;
    inset: 0;
  }
  .stage-wrap {
    position: absolute;
    inset: 0;
  }
  .stage {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .ready .stage {
    opacity: 1;
  }
  .skeleton {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    animation: fade-in var(--dur-slow) var(--ease-out);
  }
  .sheet {
    width: min(62ch, 70vw);
    display: grid;
    gap: var(--space-6);
  }
  .sheet.fixed {
    width: min(560px, 60vw);
    aspect-ratio: 1 / 1.3;
    max-height: calc(100% - 120px);
    padding: var(--space-12) var(--space-10);
    background: var(--surface);
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-xs);
    align-content: start;
  }
  .panel {
    position: absolute;
    top: 40px;
    right: 0;
    bottom: 0;
    width: var(--panel-w);
    z-index: var(--z-sidebar);
    background: var(--surface);
    border-left: 1px solid var(--border);
    overflow: auto;
  }
  @keyframes fade-in {
    from { opacity: 0; }
  }
  /* focus mode: only the text remains */
  :global(:root[data-reader-focus] [data-chrome]) {
    opacity: 0 !important;
    pointer-events: none !important;
  }
</style>
