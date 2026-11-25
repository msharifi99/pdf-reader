<!--
  The ribbon at the top of the page when the current page / position is bookmarked (stories 90–91).
  Click it to name the bookmark or remove it.
-->
<script lang="ts">
  import { Button, Popover } from '../ui';
  import { keyState } from '../commands';
  import { readerApi } from '../reader/slots.svelte';
  import type { Annotator } from './controller.svelte';

  let { ctl }: { ctl: Annotator } = $props();

  const bm = $derived(ctl.here);
  let open = $state(false);
  let name = $state('');
  let input: HTMLInputElement | undefined = $state();

  function save() {
    if (bm && name.trim() !== (bm.label ?? '')) ctl.store.update(bm.id, { label: name.trim() || null });
  }
</script>

{#if bm}
  <div class="ribbon-wrap" style:right="calc({readerApi.panelOpen ? (readerApi.panel?.width ?? 340) : 0}px + var(--space-8))">
    <Popover
      bind:open
      label="Bookmark"
      placement="bottom-end"
      size="sm"
      onopen={() => {
        name = bm.label ?? '';
        requestAnimationFrame(() => input?.focus());
      }}
      onclose={save}
    >
      {#snippet trigger(attrs)}
        <button {...attrs} type="button" class="ribbon" aria-label={bm.label ? `Bookmark: ${bm.label}` : 'Bookmarked page'} title={bm.label ?? 'Bookmarked'} data-testid="bookmark-ribbon"></button>
      {/snippet}
      <form
        class="form"
        onsubmit={(e) => {
          e.preventDefault();
          save();
          open = false;
        }}
      >
        <label class="lbl" for="bm-name">Bookmark name</label>
        <input id="bm-name" bind:this={input} bind:value={name} placeholder="Optional" autocomplete="off" data-testid="bookmark-name" />
        <div class="actions">
          <Button
            variant="ghost"
            size="sm"
            icon="trash"
            onclick={() => {
              open = false;
              ctl.remove(bm.id);
            }}>Remove</Button
          >
          <span class="kbd">{keyState.shortcut('annotate.bookmark') ?? ''}</span>
        </div>
      </form>
    </Popover>
  </div>
{/if}

<style>
  .ribbon-wrap {
    position: absolute;
    top: 40px;
    z-index: var(--z-content-overlay);
    transition: right var(--dur-slow) var(--ease-in-out);
  }
  .ribbon {
    display: block;
    width: 16px;
    height: 30px;
    background: var(--accent);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 76%, 0 100%);
    opacity: 0.92;
    transition: height var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
    animation: drop var(--dur-slow) var(--ease-out);
  }
  .ribbon:hover { height: 36px; opacity: 1; }
  .ribbon:focus-visible { outline-offset: 3px; }
  @keyframes drop {
    from { height: 0; }
  }
  .form { display: flex; flex-direction: column; gap: var(--space-2); }
  .lbl { font-size: var(--text-xs); color: var(--muted); }
  input {
    height: var(--control-md);
    padding: 0 var(--space-2-5);
    font: inherit;
    font-size: var(--text-md);
    color: var(--text);
    background: var(--surface-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    outline: none;
  }
  input:focus { box-shadow: inset 0 -2px 0 var(--accent); }
  input::placeholder { color: var(--faint); }
  .actions { display: flex; align-items: center; justify-content: space-between; margin-left: calc(var(--space-2) * -1); }
  .kbd { font-size: var(--text-2xs); color: var(--muted); }
  @media (forced-colors: active) {
    .ribbon { forced-color-adjust: none; background: Highlight; }
  }
</style>
