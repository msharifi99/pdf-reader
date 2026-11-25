<script lang="ts" module>
  // Once one tooltip has shown, neighbours show instantly while the pointer moves across a toolbar.
  let warmUntil = 0;
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Kbd from './Kbd.svelte';
  import { anchoredStyle, uid, type Placement } from './anchor';

  interface Props {
    text: string;
    /** shortcut hint chip, e.g. "Ctrl+K" */
    shortcut?: string;
    placement?: Placement;
    delay?: number;
    disabled?: boolean;
    children: Snippet;
  }
  let { text, shortcut, placement = 'bottom', delay = 500, disabled = false, children }: Props = $props();

  const id = uid('tt');
  const anchor = `--${id}`;
  let tip: HTMLElement | undefined = $state();
  let wrap: HTMLElement | undefined = $state();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show() {
    if (disabled || !tip) return;
    clearTimeout(timer);
    const open = () => {
      if (tip && !tip.matches(':popover-open')) tip.showPopover();
    };
    if (performance.now() < warmUntil) open();
    else timer = setTimeout(open, delay);
  }
  function hide() {
    clearTimeout(timer);
    if (tip?.matches(':popover-open')) {
      tip.hidePopover();
      warmUntil = performance.now() + 400;
    }
  }

  // Describe the trigger element itself, so screen readers announce the hint with the control.
  $effect(() => {
    const target = wrap?.querySelector<HTMLElement>('button, a, input, [tabindex]');
    if (!target) return;
    target.setAttribute('aria-describedby', id);
    return () => target.removeAttribute('aria-describedby');
  });
  $effect(() => () => clearTimeout(timer));
</script>

<span
  class="anchor"
  bind:this={wrap}
  style="anchor-name:{anchor}"
  onpointerenter={show}
  onpointerleave={hide}
  onpointerdown={hide}
  onfocusin={(e) => (e.target as HTMLElement).matches(':focus-visible') && show()}
  onfocusout={hide}
  onkeydown={(e) => e.key === 'Escape' && hide()}
  role="presentation"
>
  {@render children()}
</span>
<div bind:this={tip} {id} popover="manual" role="tooltip" class="tooltip" style={anchoredStyle(anchor, placement)}>
  <span>{text}</span>
  {#if shortcut}<Kbd keys={shortcut} />{/if}
</div>

<style>
  .anchor { display: inline-flex; }
  .tooltip {
    position: fixed;
    z-index: var(--z-tooltip);
    display: none;
    align-items: center;
    gap: var(--space-2);
    max-width: 280px;
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--flyout-bg);
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
    font-size: var(--text-xs);
    line-height: var(--leading-snug);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out), display var(--dur-fast) allow-discrete,
      overlay var(--dur-fast) allow-discrete;
  }
  .tooltip:popover-open {
    display: inline-flex;
    opacity: 1;
  }
  @starting-style {
    .tooltip:popover-open { opacity: 0; }
  }
</style>
