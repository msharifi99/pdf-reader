<script lang="ts" module>
  export type TriggerAttrs = {
    popovertarget: string;
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog' | 'menu' | 'listbox';
    'aria-controls': string;
    style: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { anchoredStyle, uid, type Placement } from './anchor';

  interface Props {
    open?: boolean;
    placement?: Placement;
    /** accessible name of the panel */
    label: string;
    /** render the trigger; spread `attrs` onto a <button> */
    trigger: Snippet<[TriggerAttrs]>;
    children: Snippet;
    /** padding + width preset */
    size?: 'auto' | 'sm' | 'md';
    role?: 'dialog' | 'menu' | 'listbox';
    /** called when the panel opens (focus management for custom content) */
    onopen?: (panel: HTMLElement) => void;
    onclose?: () => void;
  }
  let {
    open = $bindable(false),
    placement = 'bottom-start',
    label,
    trigger,
    children,
    size = 'auto',
    role = 'dialog',
    onopen,
    onclose,
  }: Props = $props();

  const id = uid('pop');
  const anchor = `--${id}`;
  let panel: HTMLElement | undefined = $state();
  let returnTo: HTMLElement | null = null;

  $effect(() => {
    if (!panel) return;
    const isOpen = panel.matches(':popover-open');
    if (open && !isOpen) panel.showPopover();
    if (!open && isOpen) panel.hidePopover();
  });

  function ontoggle(e: ToggleEvent) {
    const nowOpen = e.newState === 'open';
    open = nowOpen;
    if (nowOpen && panel) {
      returnTo = document.activeElement as HTMLElement | null;
      if (onopen) onopen(panel);
      else panel.querySelector<HTMLElement>('[autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus();
    } else {
      // only steal focus back if it was inside the panel (light dismiss by clicking elsewhere keeps it there)
      if (panel?.contains(document.activeElement) || document.activeElement === document.body) returnTo?.focus();
      onclose?.();
    }
  }
</script>

{@render trigger({
  popovertarget: id,
  'aria-expanded': open,
  'aria-haspopup': role,
  'aria-controls': id,
  style: `anchor-name:${anchor}`,
})}
<div
  bind:this={panel}
  {id}
  popover="auto"
  {role}
  aria-label={label}
  class="popover {size}"
  style={anchoredStyle(anchor, placement)}
  {ontoggle}
>
  {@render children()}
</div>

<style>
  .popover {
    position: fixed;
    z-index: var(--z-popover);
    min-width: 160px;
    max-width: min(420px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow: auto;
    background: var(--flyout-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    opacity: 0;
    translate: 0 -4px;
    scale: 0.98;
    transform-origin: top;
    transition: opacity var(--dur-base) var(--ease-out), translate var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out), display var(--dur-base) allow-discrete,
      overlay var(--dur-base) allow-discrete;
  }
  .popover:popover-open { opacity: 1; translate: 0 0; scale: 1; }
  @starting-style {
    .popover:popover-open { opacity: 0; translate: 0 -4px; scale: 0.98; }
  }
  .sm { padding: var(--space-3); width: 240px; }
  .md { padding: var(--space-4); width: 320px; }
</style>
