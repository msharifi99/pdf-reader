<script lang="ts">
  interface Props {
    checked?: boolean;
    label: string;
    /** secondary line under the label */
    description?: string;
    disabled?: boolean;
    /** hide the visible label (still announced) */
    hideLabel?: boolean;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(false), label, description, disabled = false, hideLabel = false, onchange }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<label class="row" class:disabled>
  {#if !hideLabel}
    <span class="text">
      <span class="label">{label}</span>
      {#if description}<span class="desc">{description}</span>{/if}
    </span>
  {/if}
  <button
    type="button"
    role="switch"
    class="switch"
    aria-checked={checked}
    aria-label={hideLabel ? label : undefined}
    {disabled}
    onclick={toggle}
  >
    <span class="thumb"></span>
  </button>
</label>

<style>
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); min-height: 32px; }
  .disabled { opacity: 0.45; }
  .text { display: flex; flex-direction: column; gap: 1px; }
  .label { font-size: var(--text-sm); color: var(--text); }
  .desc { font-size: var(--text-xs); color: var(--muted); }
  .switch {
    flex: none;
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: var(--radius-full);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border-strong);
    transition: background-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
  }
  .switch:hover:not(:disabled) { background: var(--hover); }
  .thumb {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: var(--muted);
    transition: translate var(--dur-base) var(--ease-spring), background-color var(--dur-base) var(--ease-out),
      scale var(--dur-fast) var(--ease-out);
  }
  .switch:hover:not(:disabled) .thumb { scale: 1.1; }
  .switch[aria-checked='true'] { background: var(--accent); box-shadow: none; }
  .switch[aria-checked='true'] .thumb { translate: 16px 0; background: var(--on-accent); }
  .switch[aria-checked='true']:hover:not(:disabled) { background: var(--accent-hover); }
  @media (forced-colors: active) {
    .switch { border: 1px solid ButtonText; }
    .thumb { background: ButtonText; }
    .switch[aria-checked='true'] .thumb { background: HighlightText; }
  }
</style>
