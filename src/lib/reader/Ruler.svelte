<script lang="ts">
  // Reading ruler (story 80): everything but a band of lines is dimmed. The band follows the mouse,
  // walks with the keyboard (j/k, arrows), and is resized by dragging its lower edge.
  import type { ReadingTools } from './tools.svelte';

  interface Props {
    tools: ReadingTools;
  }
  let { tools }: Props = $props();

  let drag: { y: number; h: number } | null = null;
  function down(e: PointerEvent) {
    e.stopPropagation();
    drag = { y: e.clientY, h: tools.rulerHeight };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    e.stopPropagation();
    if (drag) tools.setRulerHeight(drag.h + e.clientY - drag.y);
  }
  function key(e: KeyboardEvent) {
    const d = { ArrowUp: -8, ArrowDown: 8 }[e.key];
    if (!d) return;
    e.preventDefault();
    tools.setRulerHeight(tools.rulerHeight + d);
  }
</script>

<div class="ruler" data-testid="reading-ruler" aria-hidden="true" style:top="{tools.rulerTop}px" style:height="{tools.rulerHeight}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="grip" onpointerdown={down} onpointermove={move} onpointerup={() => (drag = null)} onkeydown={key}></div>
</div>

<style>
  .ruler {
    position: absolute;
    left: 0;
    right: 0;
    z-index: var(--z-content-overlay);
    pointer-events: none;
    box-shadow: 0 0 0 100vmax color-mix(in oklab, var(--bg) 66%, transparent);
    border-block: 1px solid color-mix(in oklab, var(--accent) 35%, transparent);
    transition: top 90ms linear, height var(--dur-fast) var(--ease-out);
  }
  .grip {
    position: absolute;
    left: 50%;
    bottom: -5px;
    width: 40px;
    height: 10px;
    margin-left: -20px;
    pointer-events: auto;
    cursor: ns-resize;
  }
  .grip::after {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    top: 4px;
    height: 2px;
    border-radius: 2px;
    background: color-mix(in oklab, var(--accent) 55%, transparent);
  }
  :global(:root[data-chrome-hidden]) .grip {
    opacity: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .ruler { transition: none; }
  }
  :global(:root[data-reduce-motion='on']) .ruler {
    transition: none;
  }
</style>
