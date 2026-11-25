<script lang="ts">
  import Icon from './Icon.svelte';
  import Kbd from './Kbd.svelte';
  import { isAction, type MenuAction, type MenuItem } from './menu';

  interface Props {
    items: MenuItem[];
    /** called after an item is chosen, or on Esc / Tab */
    onclose: () => void;
    label?: string;
  }
  let { items, onclose, label }: Props = $props();
  let list: HTMLElement | undefined = $state();
  let typed = '';
  let typedTimer: ReturnType<typeof setTimeout> | undefined;

  const hasIcons = $derived(items.some((i) => isAction(i) && (i.icon || i.checked !== undefined)));

  const enabled = () => [...(list?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];

  export function focusFirst(last = false) {
    const els = enabled();
    (last ? els.at(-1) : els[0])?.focus();
  }

  function choose(item: MenuAction) {
    if (item.disabled) return;
    onclose();
    item.onselect?.();
  }

  function onkeydown(e: KeyboardEvent) {
    const els = enabled();
    const i = els.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      els[(to + els.length) % els.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown': return move(i + 1);
      case 'ArrowUp': return move(i < 0 ? els.length - 1 : i - 1);
      case 'Home': return move(0);
      case 'End': return move(els.length - 1);
      case 'Tab': e.preventDefault(); return onclose();
      case 'Escape': e.preventDefault(); e.stopPropagation(); return onclose();
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      clearTimeout(typedTimer);
      typed += e.key.toLowerCase();
      typedTimer = setTimeout(() => (typed = ''), 600);
      const start = Math.max(i, 0);
      const order = [...els.slice(start + (typed.length === 1 ? 1 : 0)), ...els.slice(0, start + 1)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(typed))?.focus();
    }
  }
</script>

<div class="menu" role="menu" aria-label={label} tabindex="-1" bind:this={list} {onkeydown}>
  {#each items as item, i (i)}
    {#if item.type === 'separator'}
      <div class="sep" role="separator"></div>
    {:else if item.type === 'label'}
      <div class="group-label" role="presentation">{item.label}</div>
    {:else}
      <div
        class="item"
        class:danger={item.danger}
        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={item.checked}
        aria-disabled={item.disabled || undefined}
        tabindex="-1"
        onclick={() => choose(item)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(item))}
        onpointermove={(e) => !item.disabled && (e.currentTarget as HTMLElement).focus()}
      >
        {#if hasIcons}
          <span class="lead">
            {#if item.checked}<Icon name="check" size={16} />{:else if item.icon}<Icon name={item.icon} size={16} />{/if}
          </span>
        {/if}
        <span class="text">{item.label}</span>
        {#if item.shortcut}<Kbd keys={item.shortcut} variant="plain" />{/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .menu {
    display: flex;
    flex-direction: column;
    padding: var(--space-1);
    min-width: 200px;
    outline: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-2) 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--text);
    user-select: none;
    outline: none;
    transition: background-color var(--dur-instant) var(--ease-out);
  }
  .item:focus { background: var(--hover); }
  .item:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
  .item:active { background: var(--pressed); }
  .item[aria-disabled='true'] { color: var(--faint); }
  .item[aria-disabled='true']:focus { background: none; }
  .danger { color: var(--danger); }
  .lead { width: 16px; display: grid; place-items: center; color: var(--muted); }
  .item[aria-checked='true'] .lead { color: var(--accent); }
  .text { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: var(--space-4); }
  .sep { height: 1px; margin: var(--space-1) calc(var(--space-1) * -1); background: var(--border); }
  .group-label {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
</style>
