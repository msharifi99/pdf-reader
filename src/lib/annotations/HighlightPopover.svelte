<!--
  Clicking a highlight: recolour, add or edit its note, copy as quote, delete.
  Lives in the top layer (manual popover) and registers as an overlay so Esc closes it first.
  Keys while it has focus: 1–4 recolour, N edit the note, Delete removes.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { IconButton, Tooltip } from '../ui';
  import { registerOverlay } from '../shell/overlays.svelte';
  import type { Annotator } from './controller.svelte';
  import { COLOR_LABEL, highlightColors, type HighlightColor } from './model';
  import NoteEditor from './NoteEditor.svelte';

  let { ctl }: { ctl: Annotator } = $props();

  const p = $derived(ctl.popover!);
  const a = $derived(ctl.store.get(p.id));
  let el: HTMLElement | undefined = $state();
  let w = $state(300);
  let h = $state(0);

  const pos = $derived.by(() => {
    const r = p.rect;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.x + r.width / 2 - w / 2));
    const below = r.y + r.height + 8;
    const top = below + h <= innerHeight - 8 ? below : Math.max(48, r.y - h - 8);
    return { left, top };
  });

  const close = () => (ctl.popover = null);

  onMount(() => {
    el?.showPopover();
    if (!p.editing) el?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    const off = registerOverlay('annotation-popover', close);
    const outside = (e: PointerEvent) => {
      if (el && !e.composedPath().includes(el)) close();
    };
    const offs = [ctl.session.engine?.on('pointer', close), ctl.session.engine?.on('relocated', (ev) => ev.reason !== 'presentation' && close())];
    window.addEventListener('pointerdown', outside, true);
    return () => {
      off();
      offs.forEach((f) => f?.());
      window.removeEventListener('pointerdown', outside, true);
    };
  });

  // the highlight went away (undo, delete elsewhere)
  $effect(() => {
    if (!a) close();
  });

  function edit(on: boolean) {
    if (ctl.popover) ctl.popover = { ...ctl.popover, editing: on };
  }

  function onkeydown(e: KeyboardEvent) {
    if (!a || p.editing || e.ctrlKey || e.altKey || e.metaKey) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) ctl.recolor(a.id, highlightColors[i] as HighlightColor);
    else if (e.key === 'n' || e.key === 'N' || e.key === 'Enter' && (e.target as HTMLElement).classList.contains('note-text')) edit(true);
    else if (e.key === 'Delete') ctl.remove(a.id);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div
  bind:this={el}
  popover="manual"
  class="hl-pop"
  role="dialog"
  tabindex="-1"
  aria-label="Highlight"
  data-testid="highlight-popover"
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  bind:clientWidth={w}
  bind:clientHeight={h}
  {onkeydown}
>
  {#if a}
    <div class="row">
      <div class="dots" role="radiogroup" aria-label="Colour">
        {#each highlightColors as c, i (c)}
          <Tooltip text={COLOR_LABEL[c]} shortcut={String(i + 1)} placement="top">
            <button type="button" role="radio" class="dot" style:--c="var(--hl-{c})" aria-label={COLOR_LABEL[c]} aria-checked={a.color === c} data-color={c} onclick={() => ctl.recolor(a.id, c)}></button>
          </Tooltip>
        {/each}
      </div>
      <span class="grow"></span>
      <IconButton icon="note" label={a.note ? 'Edit note' : 'Add note'} size="sm" shortcut="N" pressed={p.editing} onclick={() => edit(!p.editing)} />
      <IconButton icon="quote" label="Copy as quote" size="sm" onclick={() => ctl.copyQuote(a.id)} />
      <IconButton icon="trash" label="Delete" size="sm" shortcut="Delete" onclick={() => ctl.remove(a.id)} />
    </div>
    {#if p.editing}
      <div class="note">
        <NoteEditor
          value={a.note ?? ''}
          onsave={(t) => {
            ctl.setNote(a.id, t);
            edit(false);
          }}
          oncancel={() => edit(false)}
        />
      </div>
    {:else if a.note}
      <button type="button" class="note note-text" onclick={() => edit(true)} title="Edit note">{a.note}</button>
    {/if}
  {/if}
</div>

<style>
  .hl-pop {
    position: fixed;
    inset: auto;
    margin: 0;
    width: 300px;
    padding: var(--space-1-5);
    color: var(--text);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    overflow: visible;
    animation: drift var(--dur-base) var(--ease-out);
  }
  @keyframes drift {
    from { opacity: 0; translate: 0 -4px; scale: 0.98; }
  }
  .row { display: flex; align-items: center; gap: 2px; }
  .grow { flex: 1; }
  .dots { display: flex; gap: 2px; }
  .dot { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); }
  .dot::before {
    content: '';
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--c), var(--text) 18%);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
  }
  .dot:hover { background: var(--hover); }
  .dot[aria-checked='true']::before { box-shadow: 0 0 0 2px var(--flyout-bg), 0 0 0 3.5px var(--text); }
  .dot:focus-visible { outline-offset: -2px; }
  .note {
    display: block;
    width: 100%;
    margin-top: var(--space-1-5);
    padding: var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-soft);
    text-align: left;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 40vh;
    overflow: auto;
  }
  button.note { border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
  button.note:hover { background: var(--hover); }
  button.note:focus-visible { outline-offset: -2px; }
  @media (forced-colors: active) {
    .dot::before { forced-color-adjust: none; border: 1px solid CanvasText; }
  }
</style>
