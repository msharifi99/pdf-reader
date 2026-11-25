<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';
  import { uid } from './anchor';

  interface Tab {
    id: T;
    label: string;
    /** small count badge, e.g. number of highlights */
    count?: number;
  }
  interface Props {
    tabs: Tab[];
    value: T;
    label: string;
    /** panel content for the active tab */
    children?: Snippet<[T]>;
    onchange?: (v: T) => void;
  }
  let { tabs, value = $bindable(), label, children, onchange }: Props = $props();
  const id = uid('tabs');
  let list: HTMLElement | undefined = $state();

  function select(i: number) {
    const t = tabs[(i + tabs.length) % tabs.length];
    if (!t) return;
    value = t.id;
    onchange?.(t.id);
    list?.querySelector<HTMLElement>(`#${id}-${t.id}`)?.focus();
  }
  function onkeydown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      select(to);
    }
  }
</script>

<div class="tabs">
  <div class="list" role="tablist" aria-label={label} bind:this={list} tabindex="-1" {onkeydown}>
    {#each tabs as t (t.id)}
      <button
        type="button"
        role="tab"
        id="{id}-{t.id}"
        aria-selected={t.id === value}
        aria-controls="{id}-panel"
        tabindex={t.id === value ? 0 : -1}
        onclick={() => select(tabs.indexOf(t))}
      >
        {t.label}
        {#if t.count !== undefined}<span class="count tabular">{t.count}</span>{/if}
      </button>
    {/each}
  </div>
  {#if children}
    <div class="panel" role="tabpanel" id="{id}-panel" aria-labelledby="{id}-{value}" tabindex="0">
      {@render children(value)}
    </div>
  {/if}
</div>

<style>
  .list { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-soft); }
  button {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: 36px;
    padding: 0 var(--space-2-5);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--muted);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    transition: color var(--dur-fast) var(--ease-out);
  }
  button:hover { color: var(--text); }
  button::after {
    content: '';
    position: absolute;
    left: var(--space-2-5);
    right: var(--space-2-5);
    bottom: -1px;
    height: 2px;
    border-radius: 2px;
    background: var(--accent);
    scale: 0 1;
    transition: scale var(--dur-base) var(--ease-out);
  }
  button[aria-selected='true'] { color: var(--text); }
  button[aria-selected='true']::after { scale: 1 1; }
  button:focus-visible { outline-offset: -2px; }
  .count {
    min-width: 18px;
    padding: 1px 5px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--text) 8%, transparent);
    font-size: var(--text-2xs);
    color: var(--muted);
  }
  .panel { padding-top: var(--space-4); }
  .panel:focus-visible { outline-offset: 4px; }
</style>
