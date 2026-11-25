<script lang="ts">
  // Reading speed: a slider (0.5-3x) plus a few presets. Changes apply from the current sentence.
  import { Kbd, Slider } from '../../ui';
  import { keyState } from '../../commands';
  import { speech, RATE_MAX, RATE_MIN } from '..';

  const presets = [0.75, 1, 1.25, 1.5, 2];
  const formatRate = (v: number) => `${Number(v.toFixed(2))}×`;
  // svelte-ignore state_referenced_locally (local slider value; kept in step with the store below)
  let value = $state(speech.rate);
  $effect(() => {
    value = speech.rate;
  });
  const faster = $derived(keyState.shortcut('speech.faster'));
  const slower = $derived(keyState.shortcut('speech.slower'));
</script>

<div class="speed" data-testid="speed-control">
  <Slider label="Speed" min={RATE_MIN} max={RATE_MAX} step={0.05} bind:value format={formatRate} oninput={(v) => speech.setRate(v)} />
  <div class="presets" role="group" aria-label="Speed presets">
    {#each presets as p (p)}
      <button class="preset tabular" aria-pressed={Math.abs(speech.rate - p) < 0.001} onclick={() => speech.setRate(p)}>{formatRate(p)}</button>
    {/each}
  </div>
  {#if faster || slower}
    <div class="keys">
      {#if faster}<span>Faster <Kbd keys={faster} /></span>{/if}
      {#if slower}<span>Slower <Kbd keys={slower} /></span>{/if}
    </div>
  {/if}
</div>

<style>
  .speed { width: 260px; padding: var(--space-3) var(--space-4) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
  .presets { display: flex; gap: var(--space-1); }
  .preset {
    flex: 1;
    height: var(--control-sm);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .preset:hover { background: var(--hover); color: var(--text); }
  .preset:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
  .preset[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); font-weight: var(--weight-medium); }
  .keys { display: flex; flex-direction: column; gap: var(--space-1-5); padding-top: var(--space-3); border-top: 1px solid var(--border-soft); font-size: var(--text-xs); color: var(--muted); }
  .keys span { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
</style>
