<script lang="ts">
  interface Props {
    checked?: boolean;
    indeterminate?: boolean;
    label: string;
    description?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(false), indeterminate = false, label, description, disabled = false, onchange }: Props = $props();
</script>

<label class="cb" class:disabled>
  <input type="checkbox" bind:checked {indeterminate} {disabled} onchange={() => onchange?.(checked)} />
  <span class="text">
    <span>{label}</span>
    {#if description}<span class="desc">{description}</span>{/if}
  </span>
</label>

<style>
  .cb { display: inline-flex; align-items: flex-start; gap: var(--space-2-5); min-height: 24px; font-size: var(--text-sm); }
  .disabled { opacity: 0.45; }
  .text { display: flex; flex-direction: column; gap: 1px; padding-top: 2px; }
  .desc { font-size: var(--text-xs); color: var(--muted); }
  input {
    appearance: none;
    flex: none;
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    border-radius: var(--radius-xs);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    display: grid;
    place-items: center;
    transition: background-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
  }
  input:hover:not(:disabled) { background: var(--hover); }
  input::before {
    content: '';
    width: 12px;
    height: 12px;
    background: var(--on-accent);
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='black' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m2.5 6.25 2.25 2.25 4.75-5'/%3E%3C/svg%3E") center / contain no-repeat;
    scale: 0.6;
    opacity: 0;
    transition: scale var(--dur-base) var(--ease-spring), opacity var(--dur-fast) var(--ease-out);
  }
  input:checked, input:indeterminate { background: var(--accent); box-shadow: none; }
  input:checked:hover:not(:disabled) { background: var(--accent-hover); }
  input:checked::before { scale: 1; opacity: 1; }
  input:indeterminate::before { mask: none; height: 1.75px; width: 9px; border-radius: 1px; scale: 1; opacity: 1; }
  @media (forced-colors: active) {
    input { border: 1px solid CanvasText; }
    input::before { background: CanvasText; }
  }
</style>
