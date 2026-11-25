<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';
  import { uid } from './anchor';

  interface Props {
    open?: boolean;
    title: string;
    description?: string;
    size?: 'sm' | 'md' | 'lg';
    /** Esc / backdrop click / close button allowed (default true) */
    dismissible?: boolean;
    children?: Snippet;
    /** right-aligned action row; primary action last */
    footer?: Snippet;
    onclose?: () => void;
  }
  let {
    open = $bindable(false),
    title,
    description,
    size = 'md',
    dismissible = true,
    children,
    footer,
    onclose,
  }: Props = $props();

  const id = uid('dlg');
  let dialog: HTMLDialogElement | undefined = $state();
  let returnTo: HTMLElement | null = null;

  // Native <dialog>.showModal(): top layer, inert background (focus trap), Esc via `cancel`.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  });

  function handleClose() {
    open = false;
    returnTo?.focus();
    onclose?.();
  }
</script>

<dialog
  bind:this={dialog}
  class="dialog {size}"
  aria-labelledby="{id}-t"
  aria-describedby={description ? `${id}-d` : undefined}
  oncancel={(e) => { if (!dismissible) e.preventDefault(); }}
  onclose={handleClose}
  onclick={(e) => { if (dismissible && e.target === dialog) open = false; }}
>
  <div class="inner">
    <header>
      <div>
        <h2 id="{id}-t">{title}</h2>
        {#if description}<p id="{id}-d" class="desc">{description}</p>{/if}
      </div>
      {#if dismissible}
        <IconButton icon="close" label="Close" size="sm" tooltip={false} onclick={() => (open = false)} />
      {/if}
    </header>
    {#if children}<div class="body">{@render children()}</div>{/if}
    {#if footer}<footer>{@render footer()}</footer>{/if}
  </div>
</dialog>

<style>
  .dialog {
    margin: auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-4);
    width: min(var(--w), calc(100vw - 32px));
    max-height: calc(100vh - 64px);
    opacity: 0;
    scale: 0.97;
    translate: 0 6px;
    transition: opacity var(--dur-slow) var(--ease-out), scale var(--dur-slow) var(--ease-out),
      translate var(--dur-slow) var(--ease-out), display var(--dur-slow) allow-discrete,
      overlay var(--dur-slow) allow-discrete;
  }
  .sm { --w: 380px; }
  .md { --w: 520px; }
  .lg { --w: 760px; }
  .dialog[open] { opacity: 1; scale: 1; translate: 0 0; }
  @starting-style {
    .dialog[open] { opacity: 0; scale: 0.97; translate: 0 6px; }
  }
  .dialog::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out), display var(--dur-slow) allow-discrete,
      overlay var(--dur-slow) allow-discrete;
  }
  .dialog[open]::backdrop { opacity: 1; }
  @starting-style {
    .dialog[open]::backdrop { opacity: 0; }
  }
  .inner { display: flex; flex-direction: column; max-height: inherit; }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-5) var(--space-3) var(--space-6);
  }
  h2 { font-size: var(--text-lg); font-weight: var(--weight-semibold); padding-top: 3px; }
  .desc { margin-top: var(--space-1); color: var(--muted); font-size: var(--text-sm); }
  .body { padding: var(--space-2) var(--space-6) var(--space-5); overflow: auto; }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-top: 1px solid var(--border-soft);
    background: color-mix(in oklab, var(--surface), var(--bg));
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  }
</style>
