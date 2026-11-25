<script lang="ts">
  import type { Snippet } from 'svelte';
  import MenuList from './MenuList.svelte';
  import type { MenuItem } from './menu';

  interface Props {
    /** items, or a function computing them for the clicked target */
    items: MenuItem[] | ((target: EventTarget | null) => MenuItem[]);
    label?: string;
    children: Snippet;
  }
  let { items, label = 'Context menu', children }: Props = $props();

  let panel: HTMLElement | undefined = $state();
  let list: ReturnType<typeof MenuList> | undefined = $state();
  let current: MenuItem[] = $state([]);
  let x = $state(0);
  let y = $state(0);
  let returnTo: HTMLElement | null = null;

  function openAt(px: number, py: number, target: EventTarget | null) {
    current = typeof items === 'function' ? items(target) : items;
    if (!current.length || !panel) return;
    returnTo = document.activeElement as HTMLElement | null;
    x = px;
    y = py;
    panel.showPopover();
    // clamp into the viewport once we know the size
    const r = panel.getBoundingClientRect();
    x = Math.min(px, innerWidth - r.width - 8);
    y = py + r.height > innerHeight - 8 ? Math.max(8, py - r.height) : py;
    list?.focusFirst();
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault();
    openAt(e.clientX, e.clientY, e.target);
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      openAt(r.left + 8, r.bottom + 4, e.target);
    }
  }
  function close() {
    panel?.hidePopover();
    returnTo?.focus();
  }
</script>

<div class="ctx-area" role="presentation" {oncontextmenu} {onkeydown}>
  {@render children()}
</div>
<div bind:this={panel} popover="auto" class="ctx" style="left:{x}px;top:{y}px">
  <MenuList bind:this={list} items={current} {label} onclose={close} />
</div>

<style>
  .ctx-area { display: contents; }
  .ctx {
    position: fixed;
    z-index: var(--z-popover);
    background: var(--flyout-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    opacity: 0;
    scale: 0.98;
    transform-origin: top left;
    transition: opacity var(--dur-base) var(--ease-out), scale var(--dur-base) var(--ease-out),
      display var(--dur-base) allow-discrete, overlay var(--dur-base) allow-discrete;
  }
  .ctx:popover-open { opacity: 1; scale: 1; }
  @starting-style {
    .ctx:popover-open { opacity: 0; scale: 0.98; }
  }
</style>
