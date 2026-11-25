<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  interface Props {
    icon?: IconName;
    title: string;
    description?: string;
    /** buttons; primary first */
    actions?: Snippet;
    /** 'page' for whole screens (serif display title), 'inline' for panels */
    size?: 'page' | 'inline';
  }
  let { icon, title, description, actions, size = 'inline' }: Props = $props();
</script>

<div class="empty {size}">
  {#if icon}<span class="glyph"><Icon name={icon} size={size === 'page' ? 28 : 20} /></span>{/if}
  <h2>{title}</h2>
  {#if description}<p>{description}</p>{/if}
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    padding: var(--space-8) var(--space-6);
    max-width: 420px;
    margin: 0 auto;
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--text) 5%, transparent);
    color: var(--muted);
  }
  .page .glyph { width: 64px; height: 64px; margin-bottom: var(--space-4); }
  h2 { font-size: var(--text-md); font-weight: var(--weight-semibold); }
  .page h2 {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    font-weight: 500;
    letter-spacing: -0.015em;
  }
  p { color: var(--muted); font-size: var(--text-sm); line-height: var(--leading-normal); }
  .page p { font-size: var(--text-md); }
  .actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }
</style>
