<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { uid } from './anchor';

  interface Props {
    items: T[];
    label: string;
    /** stable key per item */
    key: (item: T) => string | number;
    /** text used for type-ahead */
    text?: (item: T) => string;
    /** index of the selected item */
    selected?: number;
    /** row renderer */
    item: Snippet<[T, { selected: boolean; active: boolean; index: number }]>;
    /** Enter / double-click */
    onactivate?: (item: T, index: number) => void;
    onselect?: (item: T, index: number) => void;
    /** set to enable virtualisation: fixed row height in px. The listbox must have a bounded height. */
    itemHeight?: number;
    overscan?: number;
    class?: string;
  }
  let {
    items,
    label,
    key,
    text,
    selected = $bindable(-1),
    item,
    onactivate,
    onselect,
    itemHeight,
    overscan = 6,
    class: cls = '',
  }: Props = $props();

  const id = uid('lb');
  let el: HTMLElement | undefined = $state();
  let scrollTop = $state(0);
  let viewH = $state(400);
  let typed = '';
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const range = $derived.by(() => {
    if (!itemHeight) return { start: 0, end: items.length };
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((scrollTop + viewH) / itemHeight) + overscan);
    return { start, end };
  });
  const visible = $derived(items.slice(range.start, range.end));

  function select(i: number) {
    const idx = Math.max(0, Math.min(items.length - 1, i));
    const it = items[idx];
    if (it === undefined) return;
    selected = idx;
    onselect?.(it, idx);
    reveal(idx);
  }

  function reveal(i: number) {
    if (!el) return;
    if (itemHeight) {
      const top = i * itemHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + itemHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + itemHeight - el.clientHeight;
    } else {
      queueMicrotask(() => el?.querySelector(`#${id}-${i}`)?.scrollIntoView({ block: 'nearest' }));
    }
  }

  function onkeydown(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor((el?.clientHeight ?? 400) / (itemHeight ?? 36)) - 1);
    const to = {
      ArrowDown: selected + 1,
      ArrowUp: selected < 0 ? 0 : selected - 1,
      Home: 0,
      End: items.length - 1,
      PageDown: selected + page,
      PageUp: selected - page,
    }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      select(to);
      return;
    }
    if (e.key === 'Enter' && selected >= 0) {
      e.preventDefault();
      onactivate?.(items[selected]!, selected);
      return;
    }
    if (text && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      clearTimeout(typedTimer);
      typed += e.key.toLowerCase();
      typedTimer = setTimeout(() => (typed = ''), 600);
      const n = items.length;
      for (let k = typed.length === 1 ? 1 : 0; k <= n; k++) {
        const i = (Math.max(selected, 0) + k) % n;
        if (text(items[i]!).toLowerCase().startsWith(typed)) return select(i);
      }
    }
  }
</script>

<div
  bind:this={el}
  class="listbox {cls}"
  role="listbox"
  aria-label={label}
  tabindex="0"
  aria-activedescendant={selected >= 0 ? `${id}-${selected}` : undefined}
  bind:clientHeight={viewH}
  onscroll={() => (scrollTop = el?.scrollTop ?? 0)}
  onfocus={() => selected < 0 && items.length && select(0)}
  {onkeydown}
>
  <div class="inner" style={itemHeight ? `height:${items.length * itemHeight}px;position:relative` : ''}>
    {#each visible as it, j (key(it))}
      {@const index = range.start + j}
      <!-- svelte-ignore a11y_click_events_have_key_events (keyboard is handled on the listbox via aria-activedescendant) -->
      <div
        id="{id}-{index}"
        class="option"
        role="option"
        tabindex="-1"
        aria-selected={index === selected}
        aria-setsize={items.length}
        aria-posinset={index + 1}
        style={itemHeight ? `position:absolute;left:0;right:0;top:${index * itemHeight}px;height:${itemHeight}px` : ''}
        onclick={() => select(index)}
        ondblclick={() => onactivate?.(it, index)}
      >
        {@render item(it, { selected: index === selected, active: index === selected, index })}
      </div>
    {/each}
  </div>
</div>

<style>
  .listbox {
    overflow: auto;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    outline: none;
  }
  .listbox:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
  .option {
    position: relative; /* virtual rows override with inline absolute */
    display: flex;
    align-items: center;
    min-height: 36px;
    padding: 0 var(--space-2-5);
    border-radius: var(--radius-sm);
    color: var(--text);
    user-select: none;
    transition: background-color var(--dur-instant) var(--ease-out);
  }
  .option:hover { background: var(--hover); }
  .option[aria-selected='true'] { background: var(--selected); }
  /* Fluent selection pill on the leading edge */
  .option[aria-selected='true']::before {
    content: '';
    position: absolute;
    width: 3px;
    height: 16px;
    margin-left: calc(var(--space-2-5) * -1 + 1px);
    border-radius: 2px;
    background: var(--accent);
  }
  @media (forced-colors: active) {
    .option[aria-selected='true'] { outline: 2px solid Highlight; }
  }
</style>
