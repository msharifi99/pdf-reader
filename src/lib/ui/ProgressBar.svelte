<script lang="ts">
  interface Props {
    /** 0..1; omit for indeterminate */
    value?: number;
    label: string;
    /** line: 2px hairline for reading progress (sits on an edge). bar: 4px rounded for tasks. */
    variant?: 'line' | 'bar';
    /** extra ticks, e.g. chapter boundaries (0..1) */
    marks?: number[];
    valueText?: string;
  }
  let { value, label, variant = 'bar', marks = [], valueText }: Props = $props();
  const pct = $derived(value === undefined ? undefined : Math.max(0, Math.min(1, value)) * 100);
</script>

<div
  class="progress {variant}"
  class:indeterminate={pct === undefined}
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct === undefined ? undefined : Math.round(pct)}
  aria-valuetext={valueText}
>
  <div class="fill" style:width={pct === undefined ? undefined : `${pct}%`}></div>
  {#each marks as m, i (i)}<span class="mark" style:left="{m * 100}%"></span>{/each}
</div>

<style>
  .progress {
    position: relative;
    width: 100%;
    overflow: hidden;
    background: var(--track);
  }
  .bar { height: 4px; border-radius: var(--radius-full); }
  .line { height: 2px; background: color-mix(in oklab, var(--text) 8%, transparent); }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transition: width var(--dur-slow) var(--ease-out);
  }
  .line .fill { background: color-mix(in oklab, var(--accent) 85%, transparent); }
  .mark { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--bg); }
  .indeterminate .fill { width: 30%; animation: slide 1.4s var(--ease-in-out) infinite; }
  @keyframes slide {
    from { translate: -100% 0; }
    to { translate: 340% 0; }
  }
  @media (prefers-reduced-motion: reduce) { .indeterminate .fill { animation: none; width: 100%; opacity: 0.5; } }
  :global(:root[data-reduce-motion='on']) .indeterminate .fill { animation: none; width: 100%; opacity: 0.5; }
  @media (forced-colors: active) { .fill { background: Highlight; } .progress { outline: 1px solid CanvasText; } }
</style>
