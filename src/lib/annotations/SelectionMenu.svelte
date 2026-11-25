<!--
  The small floating menu above a text selection (story 88): four colour dots, note, copy, copy as
  quote, then actions other features add with `addSelectionAction` (see selection.svelte.ts).
  Pointer-down never steals the selection; keys 1–4 / N work without touching it.
-->
<script lang="ts">
  import { IconButton, Tooltip } from '../ui';
  import { keyState } from '../commands';
  import { readerApi } from '../reader/slots.svelte';
  import { overlays } from '../shell/overlays.svelte';
  import type { Annotator } from './controller.svelte';
  import { COLOR_LABEL, highlightColors } from './model';
  import { selectionActions } from './selection.svelte';

  let { ctl }: { ctl: Annotator } = $props();

  const sel = $derived(ctl.session.selection);
  let tick = $state(0);
  $effect(() => ctl.session.engine?.on('relocated', () => tick++));
  $effect(() => ctl.session.engine?.on('layout', () => tick++));
  const rect = $derived((void tick, sel ? readerApi.selectionRect() : null));

  let w = $state(0);
  let h = $state(0);
  const pos = $derived.by(() => {
    if (!rect) return null;
    const left = Math.max(8, Math.min(innerWidth - w - 8, rect.x + rect.width / 2 - w / 2));
    const above = rect.y - h - 10;
    const top = above >= 48 ? above : Math.min(innerHeight - h - 8, rect.y + rect.height + 10);
    return { left, top };
  });
  const COLOR_CMD = ['annotate.highlightYellow', 'annotate.highlightGreen', 'annotate.highlightBlue', 'annotate.highlightPink'];

  async function runAction(a: (typeof selectionActions.list)[number]) {
    const s = ctl.session.selection;
    if (!s) return;
    const r = await a.run({ ...s, rect: readerApi.selectionRect() });
    if (r !== 'keep') ctl.session.engine?.clearSelection();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  }
</script>

<!-- one floating thing at a time: the menu steps aside while the word lookup is open -->
{#if sel && pos && !ctl.popover && !overlays.isOpen('lookup')}
  <div
    class="selmenu"
    role="toolbar"
    tabindex="-1"
    aria-label="Selection"
    data-testid="selection-menu"
    style:left="{pos.left}px"
    style:top="{pos.top}px"
    bind:clientWidth={w}
    bind:clientHeight={h}
    onpointerdown={(e) => e.preventDefault()}
    {onkeydown}
  >
    <div class="dots">
      {#each highlightColors as c, i (c)}
        <Tooltip text="Highlight {COLOR_LABEL[c].toLowerCase()}" shortcut={keyState.shortcut(COLOR_CMD[i]!)} placement="top">
          <button type="button" class="dot" style:--c="var(--hl-{c})" aria-label="Highlight {COLOR_LABEL[c].toLowerCase()}" data-color={c} onclick={() => ctl.highlight(c)}></button>
        </Tooltip>
      {/each}
    </div>
    <span class="sep" aria-hidden="true"></span>
    <IconButton icon="note" label="Add note" size="sm" tooltipPlacement="top" shortcut={keyState.shortcut('annotate.note')} onclick={() => ctl.note()} />
    <IconButton icon="copy" label="Copy" size="sm" tooltipPlacement="top" onclick={() => sel && ctl.copy(sel.text)} />
    <IconButton icon="quote" label="Copy as quote" size="sm" tooltipPlacement="top" shortcut={keyState.shortcut('annotate.copyQuote')} onclick={() => ctl.copyQuote()} />
    {#if selectionActions.list.length}
      <span class="sep" aria-hidden="true"></span>
      {#each selectionActions.list as a (a.id)}
        <IconButton icon={a.icon} label={a.label} size="sm" tooltipPlacement="top" shortcut={a.shortcut} onclick={() => runAction(a)} data-action={a.id} />
      {/each}
    {/if}
  </div>
{/if}

<style>
  .selmenu {
    position: fixed;
    z-index: var(--z-popover);
    display: flex;
    align-items: center;
    gap: 2px;
    padding: var(--space-1);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    animation: rise var(--dur-base) var(--ease-out);
    user-select: none;
  }
  @keyframes rise {
    from { opacity: 0; translate: 0 4px; scale: 0.98; }
  }
  .dots { display: flex; align-items: center; gap: 2px; padding: 0 var(--space-1); }
  .dot {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .dot::before {
    content: '';
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--c), var(--text) 18%);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
    transition: scale var(--dur-fast) var(--ease-out);
  }
  .dot:hover { background: var(--hover); }
  .dot:hover::before { scale: 1.12; }
  .dot:focus-visible { outline-offset: -2px; }
  .sep { width: 1px; height: 16px; margin: 0 var(--space-1); background: var(--border-soft); }
  @media (forced-colors: active) {
    .dot::before { forced-color-adjust: none; border: 1px solid CanvasText; }
  }
</style>
