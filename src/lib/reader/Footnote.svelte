<script lang="ts">
  // Footnote popup (story 48): anchored at the note reference, scrollable, Esc / outside click closes.
  // The engine hands over sanitised HTML (text and a few inline tags, no attributes or links).
  import { onMount, tick } from 'svelte';
  import { Button, IconButton } from '../ui';
  import type { ReaderSession } from './session.svelte';
  import type { ReaderUi } from './ui.svelte';

  interface Props {
    ui: ReaderUi;
    session: ReaderSession;
  }
  let { ui, session }: Props = $props();

  const note = $derived(ui.footnote!);
  let el: HTMLElement | undefined = $state();
  let pos = $state({ left: 0, top: 0, above: false });

  $effect(() => {
    const r = note.rect;
    void tick().then(() => {
      const host = el?.offsetParent as HTMLElement | null;
      if (!el || !host) return;
      const W = host.clientWidth;
      const H = host.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = Math.max(16, Math.min(W - w - 16, r.x + r.width / 2 - w / 2));
      const below = r.y + r.height + 8;
      const above = below + h > H - 40 && r.y - h - 8 > 48;
      pos = { left, top: above ? r.y - h - 8 : Math.min(below, H - h - 40), above };
    });
  });

  onMount(() => {
    const outside = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) ui.footnote = null;
    };
    // clicks inside the book's iframes never reach this document: the engine's pointer event closes it there
    const t = setTimeout(() => document.addEventListener('pointerdown', outside, true));
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', outside, true);
    };
  });

  async function goToNote() {
    const target = note.target;
    ui.footnote = null;
    if (target) await session.jump(target);
  }
</script>

<div
  class="note"
  class:above={pos.above}
  bind:this={el}
  role="dialog"
  aria-label="Footnote"
  data-testid="footnote"
  data-keynav
  style:left="{pos.left}px"
  style:top="{pos.top}px"
>
  <div class="body">{@html note.html}</div>
  <footer>
    {#if note.target}<Button variant="ghost" size="sm" iconEnd="chevron-right" onclick={goToNote}>Go to note</Button>{/if}
    <IconButton icon="close" label="Close footnote" size="sm" tooltip={false} onclick={() => (ui.footnote = null)} />
  </footer>
</div>

<style>
  .note {
    position: absolute;
    z-index: var(--z-popover);
    width: min(420px, calc(100% - 32px));
    max-height: min(320px, 45vh);
    display: flex;
    flex-direction: column;
    background: var(--flyout-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    animation: in var(--dur-base) var(--ease-out);
  }
  .note.above {
    animation-name: in-up;
  }
  @keyframes in {
    from { opacity: 0; translate: 0 -4px; scale: 0.98; }
  }
  @keyframes in-up {
    from { opacity: 0; translate: 0 4px; scale: 0.98; }
  }
  .body {
    overflow: auto;
    padding: var(--space-4) var(--space-5) var(--space-2);
    font-family: var(--font-reading, var(--font-display));
    font-size: 15px;
    line-height: 1.55;
  }
  .body :global(p) {
    margin: 0 0 0.5em;
  }
  .body :global(p:last-child) {
    margin-bottom: 0;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2) var(--space-2);
  }
</style>
