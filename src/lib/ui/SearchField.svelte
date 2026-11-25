<script lang="ts">
  import TextField from './TextField.svelte';
  import Kbd from './Kbd.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    value?: string;
    label?: string;
    placeholder?: string;
    /** shown as a hint chip while empty, e.g. "Ctrl+F" */
    shortcut?: string;
    autofocus?: boolean;
    input?: HTMLInputElement;
    onsubmit?: (v: string) => void;
    /** Esc on an empty field */
    onescape?: () => void;
  }
  let {
    value = $bindable(''),
    label = 'Search',
    placeholder = 'Search',
    shortcut,
    autofocus = false,
    input = $bindable(),
    onsubmit,
    onescape,
  }: Props = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') onsubmit?.(value);
    if (e.key === 'Escape') {
      if (value) {
        e.preventDefault();
        e.stopPropagation();
        value = '';
      } else onescape?.();
    }
  }
</script>

<TextField
  bind:value
  bind:input={input as HTMLInputElement | HTMLTextAreaElement | undefined}
  type="search"
  icon="search"
  {label}
  hideLabel
  {placeholder}
  {autofocus}
  autocomplete="off"
  spellcheck="false"
  {onkeydown}
>
  {#snippet trailing()}
    {#if value}
      <button class="clear" aria-label="Clear search" onclick={() => { value = ''; input?.focus(); }}>
        <Icon name="close" size={14} />
      </button>
    {:else if shortcut}
      <span class="hint"><Kbd keys={shortcut} /></span>
    {/if}
  {/snippet}
</TextField>

<style>
  .clear {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-xs);
    color: var(--muted);
  }
  .clear:hover { background: var(--hover); color: var(--text); }
  .hint { padding-right: var(--space-1); }
</style>
