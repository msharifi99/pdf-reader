<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import Spinner from './Spinner.svelte';
  import type { IconName } from './icons';

  interface Props extends HTMLButtonAttributes {
    /** primary: the one main action per view. secondary: standard. ghost: toolbar text buttons. subtle: low-emphasis links-as-buttons */
    variant?: 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    iconEnd?: IconName;
    loading?: boolean;
    full?: boolean;
    children?: Snippet;
  }
  let {
    variant = 'secondary',
    size = 'md',
    icon,
    iconEnd,
    loading = false,
    full = false,
    type = 'button',
    disabled,
    children,
    class: cls = '',
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  class="btn {variant} {size} {cls}"
  class:full
  disabled={disabled || loading}
  aria-busy={loading || undefined}
  {...rest}
>
  {#if loading}
    <Spinner size={size === 'sm' ? 14 : 16} />
  {:else if icon}
    <Icon name={icon} size={size === 'sm' ? 16 : 18} />
  {/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
  {#if iconEnd}<Icon name={iconEnd} size={16} />{/if}
</button>

<style>
  .btn {
    --h: var(--control-md);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1-5);
    height: var(--h);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    user-select: none;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out), scale var(--dur-instant) var(--ease-out);
  }
  .btn:active:not(:disabled) { scale: 0.98; }
  .btn:disabled { opacity: 0.45; }
  .sm { --h: var(--control-sm); padding: 0 var(--space-2-5, 10px); font-size: var(--text-xs); }
  .lg { --h: var(--control-lg); padding: 0 var(--space-5); font-size: var(--text-md); }
  .full { width: 100%; }
  .btn:has(> :global(.icon):only-child) { padding: 0; width: var(--h); }

  .primary { background: var(--accent); color: var(--on-accent); }
  .primary:hover:not(:disabled) { background: var(--accent-hover); }
  .primary:active:not(:disabled) { background: var(--accent-pressed); }

  .secondary {
    background: var(--surface-2);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--border-soft);
  }
  .secondary:hover:not(:disabled) { background: color-mix(in oklab, var(--surface-2), var(--text) 5%); }
  .secondary:active:not(:disabled) { background: color-mix(in oklab, var(--surface-2), var(--text) 9%); }

  .ghost { color: var(--text); }
  .ghost:hover:not(:disabled) { background: var(--hover); }
  .ghost:active:not(:disabled) { background: var(--pressed); }

  .subtle { color: var(--muted); }
  .subtle:hover:not(:disabled) { color: var(--text); background: var(--hover); }

  .danger { color: var(--danger); background: color-mix(in oklab, var(--danger) 12%, transparent); }
  .danger:hover:not(:disabled) { background: color-mix(in oklab, var(--danger) 18%, transparent); }

  @media (forced-colors: active) {
    .btn { border: 1px solid ButtonText; }
  }
</style>
