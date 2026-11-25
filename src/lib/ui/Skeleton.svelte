<script lang="ts">
  interface Props {
    width?: string;
    height?: string;
    radius?: string;
    /** cover placeholder at 2:3 */
    cover?: boolean;
    /** n lines of text, last one shorter */
    lines?: number;
  }
  let { width = '100%', height = '12px', radius = 'var(--radius-xs)', cover = false, lines = 0 }: Props = $props();
</script>

{#if lines > 0}
  <span class="lines" aria-hidden="true" style:width>
    {#each { length: lines } as _, i (i)}
      <span class="sk" style:height style:border-radius={radius} style:width={i === lines - 1 && lines > 1 ? '62%' : '100%'}></span>
    {/each}
  </span>
{:else}
  <span
    class="sk"
    class:cover
    aria-hidden="true"
    style:width
    style:height={cover ? undefined : height}
    style:border-radius={cover ? 'var(--radius-md)' : radius}
  ></span>
{/if}

<style>
  .lines { display: flex; flex-direction: column; gap: 8px; }
  .sk {
    display: block;
    background: linear-gradient(
        100deg,
        transparent 30%,
        color-mix(in oklab, var(--text) 5%, transparent) 50%,
        transparent 70%
      )
      0 0 / 300% 100%,
      color-mix(in oklab, var(--text) 7%, transparent);
    animation: shimmer 1.6s linear infinite;
  }
  .cover { aspect-ratio: 2 / 3; }
  @keyframes shimmer {
    from { background-position: 100% 0, 0 0; }
    to { background-position: 0% 0, 0 0; }
  }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
  :global(:root[data-reduce-motion='on']) .sk { animation: none; }
</style>
