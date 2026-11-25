<!--
  Shelf: the whole library as a cover grid or a compact list, virtualised against the page's
  scroll container (only the rows on screen exist), with 2D roving focus driven by the
  library.move* commands. 5,000 books stay smooth.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Book } from '../core/bindings';
  import { ContextMenu, type MenuItem } from '../ui';
  import { app } from '../stores/app.svelte';
  import BookCover from './BookCover.svelte';
  import { ago, FORMAT_LABEL, formatLeft, isDone, minutesLeft, percent } from './format';
  import { lib, provideShelf } from './library.svelte';

  interface Props {
    books: Book[];
    view: 'grid' | 'list';
    scroller: HTMLElement;
    menu: (b: Book) => MenuItem[];
    onopen: (b: Book, e: MouseEvent | KeyboardEvent) => void;
  }
  let { books, view, scroller, menu, onopen }: Props = $props();

  const MIN_W = 150, COL_GAP = 24, ROW_GAP = 32, CAPTION = 70, LIST_ROW = 52;

  let el: HTMLElement | undefined = $state();
  let width = $state(1000);
  let scrollTop = $state(0);
  let viewH = $state(800);
  let top = $state(0); // shelf offset inside the scroller's content

  const cols = $derived(view === 'list' ? 1 : Math.max(2, Math.floor((width + COL_GAP) / (MIN_W + COL_GAP))));
  const cardW = $derived(view === 'list' ? width : (width - COL_GAP * (cols - 1)) / cols);
  const rowH = $derived(view === 'list' ? LIST_ROW : Math.round(cardW * 1.5 + CAPTION + ROW_GAP));
  const rows = $derived(Math.ceil(books.length / cols));
  const height = $derived(view === 'list' ? rows * rowH : Math.max(0, rows * rowH - ROW_GAP));

  const range = $derived.by(() => {
    const from = Math.max(0, Math.floor((scrollTop - top) / rowH) - 1);
    const to = Math.min(rows, Math.ceil((scrollTop - top + viewH) / rowH) + 1);
    return { from: from * cols, to: Math.min(books.length, to * cols) };
  });
  const shown = $derived(books.slice(range.from, range.to));
  const selIndex = $derived(books.findIndex((b) => b.id === lib.selId));
  // roving tabindex: the selected book, else the first one
  const tabIndexOf = (i: number) => (i === (selIndex >= 0 ? selIndex : 0) ? 0 : -1);

  function measure() {
    if (!el) return;
    top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scrollTop = scroller.scrollTop;
    viewH = scroller.clientHeight;
  }

  onMount(() => {
    const onScroll = () => measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure());
    ro.observe(scroller);
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild);
    measure();
    provideShelf({
      move,
      edge: (end) => select(end ? books.length - 1 : 0),
      focusSelected: () => select(Math.max(0, selIndex)),
      owns: () => {
        const a = document.activeElement;
        return !a || a === document.body || !!el?.contains(a) || !!a.closest('[data-library-root]') && !a.closest('input, select, textarea, [role=radiogroup], [role=menu], [data-continue]');
      },
    });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro.disconnect();
      provideShelf(null);
    };
  });

  // anything above the shelf changing size (continue row, results) moves it
  $effect(() => {
    void books.length;
    void view;
    void width;
    queueMicrotask(measure);
  });

  function move(dx: number, dy: number) {
    const a = document.activeElement;
    // first arrow press from outside the shelf just lands on the selection
    if (selIndex < 0 || !el?.contains(a)) return select(Math.max(0, selIndex));
    let i = selIndex;
    if (view === 'list') i += dy || dx;
    else {
      i += dx + dy * cols;
      if (dy && (i < 0 || i >= books.length)) i = dy < 0 ? selIndex : Math.min(books.length - 1, i);
    }
    select(i);
  }

  async function select(i: number) {
    const b = books[Math.max(0, Math.min(books.length - 1, i))];
    if (!b) return;
    lib.selId = b.id;
    const idx = books.indexOf(b);
    // scroll the row into view, keeping a little air
    const y = top + Math.floor(idx / cols) * rowH;
    const h = rowH - (view === 'grid' ? ROW_GAP : 0);
    const pad = 24;
    if (y - pad < scroller.scrollTop) scroller.scrollTop = Math.max(0, y - pad - (idx < cols ? top : 0));
    else if (y + h + pad > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = y + h + pad - scroller.clientHeight;
    measure();
    await tick();
    el?.querySelector<HTMLElement>(`[data-book-id="${CSS.escape(b.id)}"]`)?.focus({ preventScroll: true });
  }

  const pos = (i: number) => (view === 'list' ? `top:${i * rowH}px` : `top:${Math.floor(i / cols) * rowH}px;left:${(i % cols) * (cardW + COL_GAP)}px;width:${cardW}px`);
  const labelOf = (b: Book) =>
    [b.title, b.author, !b.available ? 'unavailable' : isDone(b) ? 'finished' : b.progress ? `${percent(b.progress)} read` : 'unread'].filter(Boolean).join(', ');

  function menuFor(target: EventTarget | null): MenuItem[] {
    const id = (target as HTMLElement | null)?.closest?.('[data-book-id]')?.getAttribute('data-book-id');
    const b = id ? books.find((x) => x.id === id) : undefined;
    if (!b) return [];
    lib.selId = b.id;
    return menu(b);
  }
</script>

<ContextMenu items={menuFor} label="Book">
  <div
    bind:this={el}
    bind:clientWidth={width}
    class="shelf {view}"
    style:height="{height}px"
    role="list"
    aria-label="Books"
    data-testid="library-shelf"
    data-view={view}
  >
    {#each shown as b, j (b.id)}
      {@const i = range.from + j}
      {@const done = isDone(b)}
      <div class="slot" role="listitem" style={pos(i)}>
        <button
          type="button"
          class="book"
          class:opening={app.opening && lib.selId === b.id}
          class:missing={!b.available}
          data-book-id={b.id}
          data-testid="book"
          data-title={b.title}
          tabindex={tabIndexOf(i)}
          aria-label={labelOf(b)}
          aria-current={lib.selId === b.id || undefined}
          onfocus={() => (lib.selId = b.id)}
          onclick={(e) => onopen(b, e)}
        >
          {#if view === 'grid'}
            <span class="art">
              <BookCover title={b.title} author={b.author} src={b.coverUrl} format={FORMAT_LABEL[b.format]} progress={b.progress} finished={done} missing={!b.available} />
            </span>
            <span class="caption">
              <span class="title">{b.title}</span>
              <span class="sub">
                <span class="author">{b.author || ' '}</span>
                {#if !b.available}<span class="meta">Unavailable</span>
                {:else if b.progress && !done}<span class="meta tabular">{percent(b.progress)}</span>{/if}
              </span>
            </span>
          {:else}
            <span class="thumb"><BookCover title={b.title} src={b.coverUrl} missing={!b.available} bare /></span>
            <span class="l-title">{b.title}</span>
            <span class="l-author">{b.author}</span>
            <span class="l-format"><span class="fmt">{FORMAT_LABEL[b.format]}</span></span>
            <span class="l-progress">
              {#if !b.available}
                <span class="muted">Unavailable</span>
              {:else if done}
                <span class="muted">Finished</span>
              {:else if b.progress}
                <span class="bar"><span style:width="{b.progress * 100}%"></span></span>
                <span class="tabular pct">{percent(b.progress)}</span>
              {:else}
                <span class="muted">Not started</span>
              {/if}
            </span>
            <span class="l-when tabular" title={formatLeft(minutesLeft(b, lib.speed)) ?? undefined}>{ago(b.lastOpenedAt)}</span>
          {/if}
        </button>
      </div>
    {/each}
  </div>
</ContextMenu>

<style>
  .shelf { position: relative; }
  /* rows have their own padding: pull them out so the thumbnails line up with the page gutter */
  .shelf.list { margin-inline: calc(var(--space-3) * -1); }
  .slot { position: absolute; }
  /* grid covers paint outside their box (lift, shadow, focus ring), so only text and rows skip rendering off screen */
  .list .slot { left: 0; right: 0; height: 52px; content-visibility: auto; contain-intrinsic-size: auto 52px; }
  .book { display: flex; width: 100%; text-align: left; color: var(--text); border-radius: var(--radius-md); }
  .book:focus-visible { outline: none; }

  /* ---- grid ---- */
  .grid .book { flex-direction: column; gap: var(--space-2-5); }
  .art {
    display: block;
    border-radius: var(--radius-md);
    transition: translate var(--dur-slow) var(--ease-out), scale var(--dur-instant) var(--ease-out), filter var(--dur-slow) var(--ease-out);
  }
  .art :global(.cover) { transition: box-shadow var(--dur-slow) var(--ease-out); }
  .grid .book:hover .art { translate: 0 -3px; }
  .grid .book:hover .art :global(.cover) { box-shadow: var(--shadow-cover-hover), 0 0 0 1px color-mix(in oklab, var(--text) 8%, transparent); }
  .grid .book:active .art { translate: 0 -1px; scale: 0.98; transition-duration: var(--dur-instant); }
  .grid .book.opening .art { scale: 0.98; filter: brightness(0.92); }
  .grid .book:focus-visible .art { outline: var(--focus-ring); outline-offset: 3px; }
  .caption { content-visibility: auto; contain-intrinsic-size: auto 60px; display: flex; flex-direction: column; gap: 2px; padding: 0 2px; min-width: 0; height: 60px; }
  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-snug);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .sub { display: flex; gap: var(--space-2); justify-content: space-between; font-size: var(--text-xs); color: var(--muted); min-width: 0; }
  .author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { flex: none; }
  .missing .title { color: var(--muted); }

  /* ---- list ---- */
  .list .book {
    display: grid;
    grid-template-columns: 28px minmax(0, 2.2fr) minmax(0, 1.4fr) 64px 150px 84px;
    align-items: center;
    gap: var(--space-4);
    height: 52px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    transition: background-color var(--dur-instant) var(--ease-out);
  }
  .list .book:hover { background: var(--hover); }
  .list .book[aria-current='true'] { background: var(--selected); }
  .list .book:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
  .list .book:active { background: var(--pressed); }
  .thumb { display: block; width: 28px; }
  .l-title { font-size: var(--text-md); font-weight: var(--weight-medium); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .l-author { font-size: var(--text-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fmt {
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    background: color-mix(in oklab, var(--text) 6%, transparent);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    color: var(--muted);
  }
  .l-progress { display: flex; align-items: center; gap: var(--space-2-5); font-size: var(--text-xs); }
  .bar { flex: 1; height: 3px; border-radius: 2px; background: color-mix(in oklab, var(--text) 10%, transparent); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .pct { color: var(--muted); width: 3ch; text-align: right; }
  .muted { color: var(--muted); }
  .l-when { font-size: var(--text-xs); color: var(--muted); text-align: right; }
  .list .missing .l-title { color: var(--muted); }

  @media (max-width: 900px) {
    .list .book { grid-template-columns: 28px minmax(0, 1fr) 64px 120px; }
    .l-author, .l-when { display: none; }
  }
</style>
