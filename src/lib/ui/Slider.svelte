<script lang="ts">
  import { uid } from './anchor';

  interface Props {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    label: string;
    hideLabel?: boolean;
    /** live value display, e.g. v => `${v}px` */
    format?: (v: number) => string;
    showValue?: boolean;
    disabled?: boolean;
    /** fires while dragging (live preview) */
    oninput?: (v: number) => void;
    /** fires on release */
    onchange?: (v: number) => void;
  }
  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    label,
    hideLabel = false,
    format = (v: number) => String(v),
    showValue = true,
    disabled = false,
    oninput,
    onchange,
  }: Props = $props();

  const id = uid('sl');
  const pct = $derived(((value - min) / (max - min || 1)) * 100);
</script>

<div class="slider" class:disabled>
  {#if !hideLabel || showValue}
    <div class="head">
      <label for={id} class:sr-only={hideLabel}>{label}</label>
      {#if showValue}<output for={id} class="value tabular">{format(value)}</output>{/if}
    </div>
  {/if}
  <input
    {id}
    type="range"
    {min}
    {max}
    {step}
    {disabled}
    bind:value
    aria-valuetext={format(value)}
    aria-label={hideLabel ? label : undefined}
    style="--pct:{pct}%"
    oninput={() => oninput?.(value)}
    onchange={() => onchange?.(value)}
  />
</div>

<style>
  .slider { display: flex; flex-direction: column; gap: var(--space-1-5); min-width: 160px; }
  .disabled { opacity: 0.45; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
  label { font-size: var(--text-sm); color: var(--text); }
  .value { font-size: var(--text-xs); color: var(--muted); }
  input {
    appearance: none;
    width: 100%;
    height: 20px;
    margin: 0;
    background: transparent;
    --track-h: 4px;
  }
  input::-webkit-slider-runnable-track {
    height: var(--track-h);
    border-radius: var(--radius-full);
    background: linear-gradient(to right, var(--accent) var(--pct), var(--track) var(--pct));
  }
  input::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    margin-top: calc((var(--track-h) - 16px) / 2);
    border-radius: var(--radius-full);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-1), inset 0 0 0 4px var(--accent);
    transition: box-shadow var(--dur-fast) var(--ease-out), scale var(--dur-fast) var(--ease-out);
  }
  input:hover:not(:disabled)::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-1), inset 0 0 0 3px var(--accent); }
  input:active:not(:disabled)::-webkit-slider-thumb { box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-1), inset 0 0 0 5px var(--accent); }
  input:focus-visible { outline: none; }
  input:focus-visible::-webkit-slider-thumb { outline: var(--focus-ring); outline-offset: 2px; }
  @media (forced-colors: active) {
    input::-webkit-slider-runnable-track { background: ButtonText; }
    input::-webkit-slider-thumb { background: Highlight; }
  }
</style>
