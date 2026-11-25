<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte';
  import { uid } from './anchor';

  interface Option {
    value: T;
    label: string;
    disabled?: boolean;
  }
  interface Props {
    options: Option[];
    value: T;
    label: string;
    hideLabel?: boolean;
    disabled?: boolean;
    /** stretch to the container */
    full?: boolean;
    onchange?: (v: T) => void;
  }
  let { options, value = $bindable(), label, hideLabel = false, disabled = false, full = false, onchange }: Props = $props();
  const id = uid('sel');
</script>

<!-- Native <select> keeps keyboard, typeahead and screen-reader behaviour for free.
     `appearance: base-select` (Chromium 135+) lets the picker use our tokens. -->
<div class="field" class:full>
  <label for={id} class:sr-only={hideLabel}>{label}</label>
  <div class="wrap">
    <select {id} bind:value {disabled} onchange={() => onchange?.(value)}>
      {#each options as o (o.value)}
        <option value={o.value} disabled={o.disabled}>{o.label}</option>
      {/each}
    </select>
    <span class="chev" aria-hidden="true"><Icon name="chevron-down" size={14} /></span>
  </div>
</div>

<style>
  .field { display: inline-flex; flex-direction: column; gap: var(--space-1-5); min-width: 160px; }
  .full { display: flex; width: 100%; }
  label { font-size: var(--text-sm); color: var(--text); }
  .wrap { position: relative; display: flex; }
  select {
    appearance: none;
    width: 100%;
    height: var(--control-md);
    padding: 0 var(--space-8) 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-soft);
    color: var(--text);
    font-size: var(--text-sm);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  select:hover:not(:disabled) { background: color-mix(in oklab, var(--surface-2), var(--text) 5%); }
  select:disabled { opacity: 0.45; }
  .chev { position: absolute; right: var(--space-2-5); top: 50%; translate: 0 -50%; color: var(--muted); pointer-events: none; display: flex; }

  @supports (appearance: base-select) {
    select, ::picker(select) { appearance: base-select; }
    select { display: flex; align-items: center; }
    select::picker-icon { display: none; }
    ::picker(select) {
      margin-top: 4px;
      padding: var(--space-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--flyout-bg);
      color: var(--text);
      box-shadow: var(--shadow-3);
      opacity: 0;
      transition: opacity var(--dur-base) var(--ease-out), display var(--dur-base) allow-discrete,
        overlay var(--dur-base) allow-discrete;
    }
    ::picker(select):popover-open { opacity: 1; }
    @starting-style {
      ::picker(select):popover-open { opacity: 0; }
    }
    option {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      height: 32px;
      padding: 0 var(--space-2);
      border-radius: var(--radius-sm);
      font-size: var(--text-sm);
    }
    option:hover, option:focus-visible { background: var(--hover); outline: none; }
    option:checked { font-weight: var(--weight-medium); }
    option::checkmark { order: 1; margin-left: auto; color: var(--accent); }
  }
</style>
