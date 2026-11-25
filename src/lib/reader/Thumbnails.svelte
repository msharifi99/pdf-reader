<script lang="ts">
  // Page thumbnails (story 43): virtualised grid, rendered lazily by the engine, current page marked.
  import { onDestroy, tick } from 'svelte';
  import type { BookHandle } from '../engines/types';
  import type { ReaderSession } from './session.svelte';

  interface Props {
    session: ReaderSession;
    handle: BookHandle;
    focusRev: number;
  }
  let { session, handle, focusRev }: Props = $props();

  const count = $derived(handle.pageCount ?? 0);
  const current = $derived(session.location?.progress.page?.index ?? (session.location?.locator.kind === 'fixed' ? session.location.locator.page : 0));

  let scroller: HTMLElement | undefined = $state();
  let width = $state(280);
  let height = $state(600);
  let scrollTop = $state(0);
  let aspect = $state(1.3);
  const GAP = 12;
  const LABEL = 22;
  const cols = $derived(Math.max(1, Math.floor((width - GAP) / 128)));
  const thumbW = $derived(Math.floor((width - GAP * (cols + 1)) / cols));
  const rowH = $derived(Math.round(thumbW * aspect) + LABEL + GAP);
  const rows = $derived(Math.ceil(count / cols));
  const first = $derived(Math.max(0, Math.floor(scrollTop / rowH) - 2));
  const last = $derived(Math.min(rows - 1, Math.ceil((scrollTop + height) / rowH) + 2));
  const pages = $derived.by(() => {
    const out: number[] = [];
    for (let r = first; r <= last; r++) for (let c = 0; c < cols; c++) if (r * cols + c < count) out.push(r * cols + c);
    return out;
  });

  // bitmap cache (closed on destroy); renders are queued so scrolling fast never floods the engine
  const cache = new Map<number, ImageBitmap | Blob>();
  const inflight = new Set<number>();
  let rev = $state(0);
  async function load(page: number) {
    if (cache.has(page) || inflight.has(page) || !session.engine?.thumbnail) return;
    inflight.add(page);
    try {
      const bm = await session.engine.thumbnail(page, Math.round(thumbW * Math.min(2, devicePixelRatio || 1)));
      if (bm) {
        cache.set(page, bm);
        if (page === 0 && 'width' in bm && bm.width) aspect = Math.min(1.8, Math.max(0.5, bm.height / bm.width));
        if (cache.size > 240) {
          const old = cache.keys().next().value!;
          const b = cache.get(old);
          if (b && 'close' in b) b.close();
          cache.delete(old);
        }
        rev++;
      }
    } catch (e) {
      console.debug('[thumbnails]', e);
    } finally {
      inflight.delete(page);
    }
  }
  $effect(() => {
    for (const p of pages) void load(p);
  });

  function draw(canvas: HTMLCanvasElement, arg: [page: number, rev: number]) {
    let page = arg[0];
    const paint = () => {
      const bm = cache.get(page);
      if (!bm || !('width' in bm)) return;
      canvas.width = bm.width;
      canvas.height = bm.height;
      canvas.getContext('2d')?.drawImage(bm, 0, 0);
      canvas.dataset.ready = 'true';
    };
    paint();
    return {
      update: (a: [number, number]) => {
        page = a[0];
        paint();
      },
    };
  }

  onDestroy(() => {
    for (const b of cache.values()) if ('close' in b) b.close();
    cache.clear();
  });

  let active = $state(-1);
  const focusPage = $derived(active >= 0 ? active : current);
  async function focusOn(p: number) {
    active = Math.max(0, Math.min(count - 1, p));
    ensureVisible(active);
    await tick();
    scroller?.querySelector<HTMLElement>(`[data-page="${active}"]`)?.focus({ preventScroll: true });
  }
  function ensureVisible(p: number, center = false) {
    if (!scroller) return;
    const top = Math.floor(p / cols) * rowH;
    if (center) scroller.scrollTop = top - (height - rowH) / 2;
    else if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + rowH > scroller.scrollTop + height) scroller.scrollTop = top + rowH - height;
  }
  function onkeydown(e: KeyboardEvent) {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, PageDown: cols * 3, PageUp: -cols * 3 }[e.key];
    if (d !== undefined) {
      e.preventDefault();
      void focusOn(focusPage + d);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      void focusOn(e.key === 'Home' ? 0 : count - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go(focusPage);
    }
  }
  function go(p: number) {
    active = p;
    void session.jump({ kind: 'fixed', page: p, y: 0 });
  }

  // follow the reading position; on open from the keyboard, take focus
  $effect(() => {
    void current;
    void rowH;
    if (scroller) tick().then(() => ensureVisible(current, true));
  });
  let lastRev = -1;
  $effect(() => {
    if (focusRev === lastRev || !scroller) return;
    lastRev = focusRev;
    void tick().then(() => focusOn(current));
  });

  const label = (p: number) => handle.pageLabels?.[p] ?? String(p + 1);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="thumbs"
  role="listbox"
  aria-label="Pages"
  tabindex="-1"
  bind:this={scroller}
  bind:clientWidth={width}
  bind:clientHeight={height}
  onscroll={() => (scrollTop = scroller!.scrollTop)}
  {onkeydown}
  data-testid="thumbnails"
>
  <div class="space" style:height="{rows * rowH + GAP}px">
    {#each pages as p (p)}
      <div
        class="thumb"
        role="option"
        aria-selected={p === current}
        aria-label="Page {label(p)}"
        tabindex={p === focusPage ? 0 : -1}
        data-page={p}
        style:left="{GAP + (p % cols) * (thumbW + GAP)}px"
        style:top="{GAP + Math.floor(p / cols) * rowH}px"
        style:width="{thumbW}px"
        onclick={() => go(p)}
        onkeydown={() => {}}
        onfocus={() => (active = p)}
      >
        <div class="frame" style:height="{Math.round(thumbW * aspect)}px">
          <canvas use:draw={[p, rev]}></canvas>
        </div>
        <span class="num tabular">{label(p)}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .thumbs {
    flex: 1;
    min-height: 0;
    overflow: auto;
    position: relative;
    outline: none;
  }
  .space {
    position: relative;
  }
  .thumb {
    position: absolute;
    display: grid;
    gap: 4px;
    justify-items: center;
    border-radius: var(--radius-sm);
    outline: none;
  }
  .frame {
    width: 100%;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    border-radius: var(--radius-xs);
    box-shadow: 0 0 0 1px var(--border-soft);
    overflow: hidden;
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
    display: block;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
  }
  canvas:global([data-ready]) {
    opacity: 1;
  }
  .thumb:hover .frame {
    box-shadow: 0 0 0 1px var(--border-strong);
  }
  .thumb[aria-selected='true'] .frame {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .thumb:focus-visible .frame {
    box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px color-mix(in oklab, var(--accent) 30%, transparent);
  }
  .num {
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .thumb[aria-selected='true'] .num {
    color: var(--text);
    font-weight: var(--weight-medium);
  }
</style>
