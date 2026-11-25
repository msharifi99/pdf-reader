<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import { uid } from './anchor';
  import type { IconName } from './icons';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    value?: string;
    label: string;
    hideLabel?: boolean;
    hint?: string;
    error?: string;
    icon?: IconName;
    /** trailing content inside the field (clear button, unit, kbd) */
    trailing?: Snippet;
    multiline?: boolean;
    input?: HTMLInputElement | HTMLTextAreaElement;
  }
  let {
    value = $bindable(''),
    label,
    hideLabel = false,
    hint,
    error,
    icon,
    trailing,
    multiline = false,
    input = $bindable(),
    id = uid('tf'),
    class: cls = '',
    ...rest
  }: Props = $props();
  const describedBy = $derived([error && `${id}-e`, hint && `${id}-h`].filter(Boolean).join(' ') || undefined);
</script>

<div class="field {cls}" class:invalid={!!error}>
  <label for={id} class:sr-only={hideLabel}>{label}</label>
  <div class="box" class:multiline>
    {#if icon}<span class="lead"><Icon name={icon} size={16} /></span>{/if}
    {#if multiline}
      <textarea {id} bind:value bind:this={input} aria-invalid={!!error} aria-describedby={describedBy} {...rest as Record<string, unknown>}></textarea>
    {:else}
      <input {id} bind:value bind:this={input} aria-invalid={!!error} aria-describedby={describedBy} {...rest} />
    {/if}
    {#if trailing}<span class="trail">{@render trailing()}</span>{/if}
  </div>
  {#if error}<p id="{id}-e" class="msg error">{error}</p>{:else if hint}<p id="{id}-h" class="msg">{hint}</p>{/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: var(--space-1-5); }
  label { font-size: var(--text-sm); color: var(--text); }
  .box {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--control-md);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-soft);
    transition: box-shadow var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .box.multiline { height: auto; align-items: stretch; }
  .box:hover { background: color-mix(in oklab, var(--surface-2), var(--text) 3%); }
  /* Fluent-style focus: accent underline-weight ring, no glow */
  .box:focus-within { background: var(--surface); box-shadow: inset 0 0 0 1px var(--border-strong), inset 0 -2px 0 var(--accent); }
  .invalid .box { box-shadow: inset 0 0 0 1px var(--danger); }
  input, textarea {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
    border: 0;
    background: none;
    font-size: var(--text-sm);
    outline: none;
  }
  textarea { padding: var(--space-2) var(--space-3); min-height: 88px; resize: vertical; line-height: var(--leading-normal); }
  input::placeholder, textarea::placeholder { color: var(--faint); }
  .lead { display: flex; padding-left: var(--space-2-5); color: var(--muted); }
  .lead + input { padding-left: var(--space-2); }
  .trail { display: flex; align-items: center; gap: var(--space-1); padding-right: var(--space-1); }
  .msg { font-size: var(--text-xs); color: var(--muted); }
  .msg.error { color: var(--danger); }
  input[type='search']::-webkit-search-cancel-button { display: none; }
  @media (forced-colors: active) { .box { border: 1px solid CanvasText; } }
</style>
