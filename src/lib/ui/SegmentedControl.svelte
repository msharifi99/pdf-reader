<script lang="ts" generics="T extends string | number">
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  interface Option {
    value: T;
    label: string;
    icon?: IconName;
    /** show only the icon (label becomes aria-label) */
    iconOnly?: boolean;
  }
  interface Props {
    options: Option[];
    value: T;
    label: string;
    size?: 'sm' | 'md';
    onchange?: (v: T) => void;
  }
  let { options, value = $bindable(), label, size = 'md', onchange }: Props = $props();

  let root: HTMLElement | undefined = $state();
  const index = $derived(Math.max(0, options.findIndex((o) => o.value === value)));

  function select(i: number, focus = false) {
    const o = options[(i + options.length) % options.length];
    if (!o) return;
    value = o.value;
    onchange?.(o.value);
    if (focus) root?.querySelectorAll<HTMLElement>('[role="radio"]')[(i + options.length) % options.length]?.focus();
  }
  function onkeydown(e: KeyboardEvent) {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) {
      e.preventDefault();
      select(index + d, true);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      select(e.key === 'Home' ? 0 : options.length - 1, true);
    }
  }
</script>

<div
  bind:this={root}
  class="seg {size}"
  role="radiogroup"
  aria-label={label}
  style="--n:{options.length};--i:{index}"
  tabindex="-1"
  {onkeydown}
>
  <span class="indicator" aria-hidden="true"></span>
  {#each options as o, i (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      aria-label={o.iconOnly ? o.label : undefined}
      tabindex={o.value === value ? 0 : -1}
      onclick={() => select(i)}
    >
      {#if o.icon}<Icon name={o.icon} size={16} />{/if}
      {#if !o.iconOnly}<span>{o.label}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .seg {
    --h: var(--control-md);
    position: relative;
    display: inline-grid;
    grid-template-columns: repeat(var(--n), 1fr);
    padding: 2px;
    height: var(--h);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--text) 6%, transparent);
    isolation: isolate;
  }
  .sm { --h: var(--control-sm); }
  .indicator {
    position: absolute;
    z-index: -1;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--n));
    translate: calc(100% * var(--i)) 0;
    border-radius: calc(var(--radius-sm) - 1px);
    background: var(--surface);
    box-shadow: var(--shadow-1), inset 0 0 0 1px var(--border-soft);
    transition: translate var(--dur-base) var(--ease-out);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    padding: 0 var(--space-3);
    border-radius: calc(var(--radius-sm) - 1px);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--muted);
    white-space: nowrap;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .md button { font-size: var(--text-sm); }
  button:hover { color: var(--text); }
  button[aria-checked='true'] { color: var(--text); }
  button:focus-visible { outline-offset: 0; }
  @media (forced-colors: active) {
    button[aria-checked='true'] { outline: 2px solid Highlight; }
  }
</style>
