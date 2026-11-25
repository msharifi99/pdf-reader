<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import Tooltip from './Tooltip.svelte';
  import type { IconName } from './icons';
  import type { Placement } from './anchor';

  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    /** required: becomes aria-label and the tooltip */
    label: string;
    shortcut?: string;
    /** toggle buttons: sets aria-pressed and the accent tint */
    pressed?: boolean;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'ghost' | 'subtle' | 'solid';
    tooltip?: boolean;
    tooltipPlacement?: Placement;
  }
  let {
    icon,
    label,
    shortcut,
    pressed,
    size = 'md',
    variant = 'ghost',
    tooltip = true,
    tooltipPlacement = 'bottom',
    type = 'button',
    class: cls = '',
    ...rest
  }: Props = $props();
</script>

{#snippet button()}
  <button {type} class="ib {size} {variant} {cls}" aria-label={label} aria-pressed={pressed} {...rest}>
    <Icon name={icon} size={size === 'sm' ? 16 : 20} />
  </button>
{/snippet}

{#if tooltip}
  <Tooltip text={label} {shortcut} placement={tooltipPlacement}>{@render button()}</Tooltip>
{:else}
  {@render button()}
{/if}

<style>
  .ib {
    --s: var(--control-md);
    display: inline-grid;
    place-items: center;
    width: var(--s);
    height: var(--s);
    border-radius: var(--radius-sm);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
      scale var(--dur-instant) var(--ease-out);
  }
  .sm { --s: var(--control-sm); }
  .lg { --s: var(--control-lg); }
  .ib:hover:not(:disabled) { color: var(--text); background: var(--hover); }
  .ib:active:not(:disabled) { background: var(--pressed); scale: 0.94; }
  .ib:disabled { opacity: 0.4; }
  .subtle { color: var(--faint); }
  .solid { background: var(--surface-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-soft); }
  .ib[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); }
  .ib[aria-pressed='true']:hover { background: color-mix(in oklab, var(--accent) 24%, transparent); color: var(--accent); }
</style>
