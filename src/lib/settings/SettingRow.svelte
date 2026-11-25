<script lang="ts">
  // One settings row: label + description on the left, control on the right (48px min).
  // `stacked` puts the control under the label (theme grids, editors).
  import type { Snippet } from 'svelte';
  import { useSearch } from './search.svelte';

  interface Props {
    label: string;
    description?: string;
    /** extra search terms */
    keywords?: string;
    stacked?: boolean;
    /** id of the control, so the label is clickable */
    for?: string;
    children: Snippet;
  }
  let { label, description, keywords, stacked = false, for: htmlFor, children }: Props = $props();
  const search = useSearch();
  const visible = $derived(search.matches(label, description, keywords));
</script>

<div class="row" class:stacked hidden={!visible} data-setting={label}>
  <div class="text">
    {#if htmlFor}<label class="label" for={htmlFor}>{label}</label>{:else}<span class="label">{label}</span>{/if}
    {#if description}<span class="desc">{description}</span>{/if}
  </div>
  <div class="control">{@render children()}</div>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    min-height: 56px;
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border-soft);
  }
  .row[hidden] { display: none; }
  .row.stacked { flex-direction: column; align-items: stretch; gap: var(--space-3); padding: var(--space-4) 0 var(--space-5); }
  .text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .label { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
  .desc { font-size: var(--text-xs); color: var(--muted); max-width: 52ch; }
  .control { flex: none; display: flex; align-items: center; gap: var(--space-2); }
  .stacked .control { flex: auto; display: block; }
</style>
