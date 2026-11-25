<script lang="ts">
  import { parseShortcut } from './kbd';

  interface Props {
    /** "Ctrl+K", "Ctrl+Shift+P", "g g", "?" */
    keys: string;
    /** 'chip' = boxed keycaps, 'plain' = muted inline text (inside menus) */
    variant?: 'chip' | 'plain';
  }
  let { keys, variant = 'chip' }: Props = $props();
  const steps = $derived(parseShortcut(keys));
  const spoken = $derived(steps.map((s) => s.join(' ')).join(', then '));
</script>

<span class="kbd {variant}" aria-label={spoken}>
  {#each steps as step, i (i)}
    {#if i > 0}<span class="then" aria-hidden="true"></span>{/if}
    <span class="step" aria-hidden="true">
      {#each step as key, j (j)}
        <kbd>{key}</kbd>
      {/each}
    </span>
  {/each}
</span>

<style>
  .kbd {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--muted);
  }
  .step { display: inline-flex; gap: 3px; }
  .then { width: 3px; }
  kbd {
    font: inherit;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    display: inline-grid;
    place-items: center;
    border-radius: var(--radius-xs);
  }
  .chip kbd {
    background: color-mix(in oklab, var(--text) 7%, transparent);
    box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--text) 10%, transparent);
    color: var(--text);
  }
  .plain kbd { display: inline; min-width: 0; padding: 0 1px; height: auto; }
  .plain .step { gap: 1px; }
  .plain kbd + kbd::before { content: '+'; opacity: 0.6; margin-right: 1px; }
</style>
