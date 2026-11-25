<script lang="ts">
  // Table of contents (story 42): nested, the current chapter highlighted and kept in view.
  // A WAI-ARIA tree: Up/Down move, Left/Right collapse/expand, Home/End, Enter jumps.
  import { tick, untrack } from 'svelte';
  import { Icon, EmptyState } from '../ui';
  import type { ReaderSession } from './session.svelte';
  import { chapterIndexAt, type FlatToc } from './progress';

  interface Props {
    session: ReaderSession;
    focusRev: number;
  }
  let { session, focusRev }: Props = $props();

  const flat = $derived(session.flat);
  const pageCount = $derived(session.handle?.pageCount ?? 1);
  const current = $derived.by(() => {
    const l = session.location;
    if (!l) return -1;
    const i = l.progress.chapter?.index;
    return i !== undefined && i >= 0 && i < flat.length ? i : chapterIndexAt(flat, l.locator, pageCount);
  });

  const hasKids = (t: FlatToc) => flat[t.index + 1]?.parent === t.index;
  // Top levels open by default; the current chapter's ancestors are always opened.
  let collapsed = $state(new Set<number>());
  let opened = $state(new Set<number>());
  const isOpen = (t: FlatToc) => (t.depth === 0 ? !collapsed.has(t.index) : opened.has(t.index));
  $effect(() => {
    let p = flat[current]?.parent ?? -1;
    if (p < 0) return;
    untrack(() => {
      const o = new Set(opened);
      const c = new Set(collapsed);
      while (p >= 0) {
        o.add(p);
        c.delete(p);
        p = flat[p]!.parent;
      }
      opened = o;
      collapsed = c;
    });
  });

  const visible = $derived.by(() => {
    const out: FlatToc[] = [];
    const shut = new Set<number>();
    for (const t of flat) {
      if (t.parent >= 0 && shut.has(t.parent)) {
        shut.add(t.index);
        continue;
      }
      out.push(t);
      if (hasKids(t) && !isOpen(t)) shut.add(t.index);
    }
    return out;
  });

  let active = $state(-1);
  let list: HTMLElement | undefined = $state();
  const focusedIndex = $derived(active >= 0 ? active : current >= 0 ? current : (visible[0]?.index ?? -1));

  function toggle(t: FlatToc, open?: boolean) {
    const want = open ?? !isOpen(t);
    if (t.depth === 0) {
      const c = new Set(collapsed);
      if (want) c.delete(t.index);
      else c.add(t.index);
      collapsed = c;
    } else {
      const o = new Set(opened);
      if (want) o.add(t.index);
      else o.delete(t.index);
      opened = o;
    }
  }

  async function focusItem(i: number) {
    active = i;
    await tick();
    list?.querySelector<HTMLElement>(`[data-toc="${i}"]`)?.focus();
  }

  function go(t: FlatToc) {
    active = t.index;
    void session.jump(t.entry.locator);
  }

  function onkeydown(e: KeyboardEvent) {
    const pos = visible.findIndex((t) => t.index === focusedIndex);
    const t = visible[pos];
    if (!t) return;
    let to = -1;
    switch (e.key) {
      case 'ArrowDown': to = visible[Math.min(visible.length - 1, pos + 1)]!.index; break;
      case 'ArrowUp': to = visible[Math.max(0, pos - 1)]!.index; break;
      case 'Home': to = visible[0]!.index; break;
      case 'End': to = visible[visible.length - 1]!.index; break;
      case 'ArrowRight':
        if (hasKids(t) && !isOpen(t)) toggle(t, true);
        else if (hasKids(t)) to = t.index + 1;
        break;
      case 'ArrowLeft':
        if (hasKids(t) && isOpen(t)) toggle(t, false);
        else if (t.parent >= 0) to = t.parent;
        break;
      case 'Enter':
      case ' ':
        go(t);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (to >= 0) void focusItem(to);
  }

  // keep the current chapter in view, and take focus when opened from the keyboard
  $effect(() => {
    if (current < 0 || !list) return;
    void tick().then(() => list?.querySelector<HTMLElement>(`[data-toc="${current}"]`)?.scrollIntoView({ block: 'nearest' }));
  });
  let lastRev = -1;
  $effect(() => {
    const rev = focusRev;
    if (rev === lastRev || !list) return;
    lastRev = rev;
    void tick().then(() => {
      const el = list?.querySelector<HTMLElement>(`[data-toc="${focusedIndex}"]`);
      el?.scrollIntoView({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
  });

  const detail = (t: FlatToc) => {
    const l = t.entry.locator;
    if (l.kind === 'fixed') return session.handle?.pageLabels?.[l.page] ?? String(l.page + 1);
    return '';
  };
</script>

{#if flat.length}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="tree" role="tree" aria-label="Table of contents" bind:this={list} {onkeydown} data-testid="toc">
    {#each visible as t (t.index)}
      <!-- svelte-ignore a11y_click_events_have_key_events (the tree handles keys) -->
      <li
        role="treeitem"
        class="item"
        class:current={t.index === current}
        aria-level={t.depth + 1}
        aria-expanded={hasKids(t) ? isOpen(t) : undefined}
        aria-selected={t.index === current}
        aria-current={t.index === current ? 'location' : undefined}
        tabindex={t.index === focusedIndex ? 0 : -1}
        data-toc={t.index}
        style:--depth={t.depth}
        onclick={() => go(t)}
        onfocus={() => (active = t.index)}
      >
        {#if hasKids(t)}
          <button class="twisty" tabindex="-1" aria-hidden="true" onclick={(e) => (e.stopPropagation(), toggle(t))}>
            <Icon name={isOpen(t) ? 'chevron-down' : 'chevron-right'} size={16} />
          </button>
        {:else}
          <span class="twisty" aria-hidden="true"></span>
        {/if}
        <span class="title">{t.entry.title}</span>
        {#if detail(t)}<span class="page tabular">{detail(t)}</span>{/if}
      </li>
    {/each}
  </ul>
{:else}
  <div class="empty">
    <EmptyState icon="toc" size="inline" title="No table of contents" description="This book doesn’t list its chapters. Use Go to (Ctrl+G) for a page or percentage." />
  </div>
{/if}

<style>
  .tree {
    flex: 1;
    overflow: auto;
    padding: var(--space-2);
    list-style: none;
    margin: 0;
    outline: none;
  }
  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: 32px;
    padding: 4px var(--space-2) 4px calc(var(--space-1) + var(--depth) * 16px);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: 1.35;
    color: var(--text);
    cursor: default;
  }
  .item:hover {
    background: var(--hover);
  }
  .item:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .item.current {
    background: var(--selected);
    font-weight: var(--weight-medium);
  }
  .item.current::before {
    content: '';
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .item[aria-level='1'] {
    font-weight: var(--weight-medium);
  }
  .item:not([aria-level='1']) {
    color: color-mix(in oklab, var(--text) 86%, var(--muted));
  }
  .twisty {
    flex: none;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    color: var(--muted);
    border-radius: var(--radius-xs);
  }
  button.twisty:hover {
    color: var(--text);
    background: var(--hover);
  }
  .title {
    flex: 1;
    min-width: 0;
  }
  .page {
    flex: none;
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .empty {
    padding: var(--space-8) var(--space-4);
  }
</style>
