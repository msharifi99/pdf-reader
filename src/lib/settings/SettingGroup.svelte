<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    title?: string;
    children: Snippet;
  }
  let { title, children }: Props = $props();
</script>

<div class="group">
  {#if title}<h3>{title}</h3>{/if}
  {@render children()}
</div>

<style>
  .group { margin-bottom: var(--space-8); }
  /* nothing in this group matches the search: hide the label too */
  .group:not(:has(:global([data-setting]:not([hidden])))) { display: none; }
  h3 {
    margin-bottom: var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .group > :global([data-setting]:last-child) { border-bottom: 0; }
</style>
