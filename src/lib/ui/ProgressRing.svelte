<script lang="ts">
  interface Props {
    /** 0..1 */
    value: number;
    size?: number;
    stroke?: number;
    label?: string;
    /** show the % in the middle (only legible at size >= 32) */
    showValue?: boolean;
  }
  let { value, size = 20, stroke = 2, label, showValue = false }: Props = $props();
  const r = $derived((size - stroke) / 2);
  const c = $derived(2 * Math.PI * r);
  const v = $derived(Math.max(0, Math.min(1, value)));
</script>

<span
  class="ring"
  role={label ? 'progressbar' : undefined}
  aria-label={label}
  aria-valuemin={label ? 0 : undefined}
  aria-valuemax={label ? 100 : undefined}
  aria-valuenow={label ? Math.round(v * 100) : undefined}
  aria-hidden={label ? undefined : 'true'}
  style:width="{size}px"
  style:height="{size}px"
>
  <svg width={size} height={size} viewBox="0 0 {size} {size}">
    <circle cx={size / 2} cy={size / 2} {r} fill="none" stroke="var(--track)" stroke-width={stroke} />
    <circle
      class="arc"
      cx={size / 2}
      cy={size / 2}
      {r}
      fill="none"
      stroke="var(--accent)"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={c}
      stroke-dashoffset={c * (1 - v)}
      transform="rotate(-90 {size / 2} {size / 2})"
    />
  </svg>
  {#if showValue}<span class="val tabular">{Math.round(v * 100)}</span>{/if}
</span>

<style>
  .ring { position: relative; display: inline-grid; place-items: center; flex: none; }
  .ring svg { position: absolute; inset: 0; }
  .arc { transition: stroke-dashoffset var(--dur-slow) var(--ease-out); }
  .val { font-size: var(--text-2xs); font-weight: var(--weight-semibold); color: var(--text); }
</style>
