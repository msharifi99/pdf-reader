<script lang="ts">
  // Full-window drop target shown while files hover the window.
  import { Icon } from '../ui';
  import { fade } from '../design/motion';
  import { win } from './window.svelte';
</script>

{#if win.dragging}
  <div class="drop" data-testid="drop-overlay" role="status" aria-live="polite" transition:fade={{ duration: 160 }}>
    <div class="target">
      <span class="icon"><Icon name="book-open" size={20} /></span>
      <p class="title">Drop to open</p>
      <p class="sub">PDF, EPUB, MOBI, FB2, CBZ, CBR or images</p>
    </div>
  </div>
{/if}

<style>
  .drop {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--space-6);
    background: color-mix(in oklab, var(--bg) 72%, transparent);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    pointer-events: none;
  }
  .target {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: min(560px, 100%);
    aspect-ratio: 16 / 9;
    border: 1.5px dashed color-mix(in oklab, var(--accent) 70%, transparent);
    border-radius: var(--radius-lg);
    background: color-mix(in oklab, var(--accent) 5%, var(--surface));
    animation: lift var(--dur-slow) var(--ease-out);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .title { font-family: var(--font-display); font-size: var(--text-xl); font-weight: var(--weight-medium); letter-spacing: -0.01em; }
  .sub { font-size: var(--text-xs); color: var(--muted); }
  @keyframes lift {
    from { scale: 0.98; translate: 0 4px; }
  }
</style>
