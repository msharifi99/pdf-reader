<script lang="ts">
  // Find in book (stories 46–47): compact bar under the title bar, "3 of 27", expandable results with context.
  import { onDestroy, tick } from 'svelte';
  import { contextStack, keyState } from '../commands';
  import { Icon, IconButton, Spinner } from '../ui';
  import type { FindState } from './find.svelte';
  import type { ReaderSession } from './session.svelte';

  interface Props {
    find: FindState;
    session: ReaderSession;
  }
  let { find, session }: Props = $props();

  let input: HTMLInputElement | undefined = $state();
  let pop: (() => void) | null = null;
  const searchable = $derived(session.handle?.capabilities.search !== false);

  // Enter / Shift+Enter / Esc step and close while the bar has focus (the 'find' key context)
  function focusin() {
    pop ??= contextStack.push('find');
  }
  function focusout(e: FocusEvent) {
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    pop?.();
    pop = null;
  }
  onDestroy(() => pop?.());

  $effect(() => {
    void find.focusRev;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  });

  const status = $derived.by(() => {
    if (!searchable) return 'No searchable text';
    if (!find.query.trim()) return '';
    if (!find.hits.length) return find.searching ? 'Searching…' : 'No matches';
    return `${find.index >= 0 ? find.index + 1 : 0} of ${find.hits.length}${find.searching ? '+' : ''}`;
  });

  let list: HTMLElement | undefined = $state();
  $effect(() => {
    void find.index;
    if (find.expanded) void tick().then(() => list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
  });

  const where = (i: number) => {
    const h = find.hits[i]!;
    const l = h.locator;
    if (l.kind === 'fixed') return `p. ${session.handle?.pageLabels?.[l.page] ?? l.page + 1}`;
    return h.section ?? `${Math.round(l.fraction * 100)}%`;
  };
</script>

<div class="find" role="search" aria-label="Find in book" data-testid="find-bar" data-keynav onfocusin={focusin} onfocusout={focusout}>
  <div class="row">
    <Icon name="search" size={16} />
    <input
      bind:this={input}
      type="search"
      placeholder={searchable ? 'Find in book' : 'This book has no text to search'}
      aria-label="Find in book"
      disabled={!searchable}
      bind:value={find.query}
      oninput={() => void find.run(find.query)}
      spellcheck="false"
      autocomplete="off"
    />
    <span class="count tabular" aria-live="polite" data-testid="find-count">
      {#if find.searching && !find.hits.length}<Spinner size={12} />{/if}{status}
    </span>
    <IconButton icon="chevron-up" label="Previous match" shortcut="Shift+Enter" size="sm" disabled={!find.hits.length} onclick={() => find.step(-1)} />
    <IconButton icon="chevron-down" label="Next match" shortcut="Enter" size="sm" disabled={!find.hits.length} onclick={() => find.step(1)} />
    <IconButton icon="list" label={find.expanded ? 'Hide results' : 'Show all results'} size="sm" pressed={find.expanded} disabled={!find.hits.length} onclick={() => (find.expanded = !find.expanded)} />
    <IconButton icon="close" label="Close" shortcut={keyState.shortcut('reader.closeFind') ?? 'Esc'} size="sm" onclick={() => find.close()} />
  </div>
  {#if find.expanded && find.hits.length}
    <ul class="results" role="listbox" aria-label="Matches" bind:this={list} data-testid="find-results">
      {#each find.hits.slice(0, 500) as h, i (i)}
        <li role="option" aria-selected={i === find.index}>
          <button type="button" onclick={() => find.select(i)}>
            <span class="ctx">…{h.excerpt.before.replace(/^…/, '').slice(-40).trimStart()}<mark>{h.excerpt.match}</mark>{h.excerpt.after.replace(/…$/, '').slice(0, 80).trimEnd()}…</span>
            <span class="where tabular">{where(i)}</span>
          </button>
        </li>
      {/each}
      {#if find.hits.length > 500}<li class="more">{find.hits.length - 500} more — refine the search to see them</li>{/if}
    </ul>
  {/if}
</div>

<style>
  .find {
    position: absolute;
    top: 48px;
    right: var(--space-4);
    width: min(440px, calc(100% - 32px));
    z-index: var(--z-dropdown);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    animation: in var(--dur-base) var(--ease-out);
  }
  @keyframes in {
    from { opacity: 0; translate: 0 -4px; }
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    color: var(--muted);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 32px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--text-md);
    outline: none;
    padding: 0 var(--space-2);
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  input::placeholder {
    color: var(--faint);
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--text-xs);
    color: var(--muted);
    padding: 0 var(--space-2);
    white-space: nowrap;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: var(--space-1);
    max-height: min(50vh, 420px);
    overflow: auto;
    border-top: 1px solid var(--border-soft);
  }
  /* where (chapter or page) on a quiet caption line, the snippet below at full width */
  .results button {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: var(--space-2) var(--space-2-5);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: 1.45;
    color: var(--text);
  }
  .results button:hover {
    background: var(--hover);
  }
  .results [aria-selected='true'] button {
    background: var(--selected);
  }
  .results button:focus-visible {
    outline-offset: -2px;
  }
  .ctx {
    flex: 1;
    min-width: 0;
    color: color-mix(in oklab, var(--text) 78%, var(--muted));
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  mark {
    background: color-mix(in oklab, var(--accent) 32%, transparent);
    color: var(--text);
    border-radius: 2px;
    padding: 0 1px;
  }
  .where {
    order: -1;
    font-size: var(--text-xs);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .more {
    padding: var(--space-2) var(--space-2-5);
    font-size: var(--text-xs);
    color: var(--muted);
  }
</style>
