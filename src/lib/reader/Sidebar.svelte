<script lang="ts">
  // Left sidebar beside the page (the page gives up its width): Contents and (fixed layouts) Pages.
  // Resizable; width remembered.
  import { IconButton, Tabs } from '../ui';
  import { slide } from '../design/motion';
  import type { BookHandle } from '../engines/types';
  import type { ReaderSession } from './session.svelte';
  import type { ReaderUi, SidebarTab } from './ui.svelte';
  import TocTree from './TocTree.svelte';
  import Thumbnails from './Thumbnails.svelte';

  interface Props {
    session: ReaderSession;
    ui: ReaderUi;
    handle: BookHandle;
  }
  let { session, ui, handle }: Props = $props();

  const tabs = $derived<{ id: SidebarTab; label: string }[]>(
    handle.capabilities.thumbnails ? [{ id: 'toc', label: 'Contents' }, { id: 'pages', label: 'Pages' }] : [{ id: 'toc', label: 'Contents' }],
  );
  let tab = $derived<SidebarTab>(ui.sidebar ?? 'toc');

  let drag: { x: number; w: number } | null = null;
  function down(e: PointerEvent) {
    drag = { x: e.clientX, w: ui.sidebarWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (drag) ui.setSidebarWidth(drag.w + e.clientX - drag.x);
  }
  function key(e: KeyboardEvent) {
    const d = { ArrowLeft: -16, ArrowRight: 16 }[e.key];
    if (!d) return;
    e.preventDefault();
    ui.setSidebarWidth(ui.sidebarWidth + d);
  }
</script>

<aside class="sidebar" style:width="{ui.sidebarWidth}px" aria-label="Contents and pages" data-testid="reader-sidebar" data-keynav transition:slide={{ side: 'left' }}>
  <header>
    {#if tabs.length > 1}
      <Tabs {tabs} label="Sidebar" bind:value={tab} onchange={(v) => (ui.sidebar = v)} />
    {:else}
      <h2>Contents</h2>
    {/if}
    <IconButton icon="close" label="Close sidebar" size="sm" tooltip={false} onclick={() => (ui.sidebar = null)} />
  </header>
  <div class="content">
    {#if tab === 'pages'}
      <Thumbnails {session} {handle} focusRev={ui.sidebarFocusRev} />
    {:else}
      <TocTree {session} focusRev={ui.sidebarFocusRev} />
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (a focusable splitter) -->
  <div
    class="grip"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuenow={ui.sidebarWidth}
    aria-valuemin={220}
    aria-valuemax={520}
    tabindex="0"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (drag = null)}
    onkeydown={key}
  ></div>
</aside>

<style>
  .sidebar {
    position: absolute;
    top: var(--titlebar-h);
    left: 0;
    bottom: 0;
    z-index: var(--z-sidebar);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-right: 1px solid var(--border);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0 var(--space-4);
  }
  header :global(.tabs) {
    flex: 1;
  }
  header :global(.tabs .list) {
    border-bottom: 0;
  }
  h2 {
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    height: 36px;
    display: flex;
    align-items: center;
  }
  .content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-soft);
  }
  .grip {
    position: absolute;
    top: 0;
    right: -4px;
    bottom: 0;
    width: 7px;
    cursor: col-resize;
  }
  .grip:hover,
  .grip:focus-visible {
    background: linear-gradient(to right, transparent 3px, var(--accent) 3px, var(--accent) 4px, transparent 4px);
    outline: none;
  }
</style>
