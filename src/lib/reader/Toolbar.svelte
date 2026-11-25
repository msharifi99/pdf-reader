<script lang="ts">
  // Quiet icon buttons in the title bar's trailing slot. Every button runs a Command.
  import { commands, commandsState, keyState } from '../commands';
  import { IconButton, Popover } from '../ui';
  import type { BookHandle } from '../engines/types';
  import type { ReaderSession } from './session.svelte';
  import type { ReaderUi } from './ui.svelte';
  import type { FindState } from './find.svelte';
  import type { ReadingTools } from './tools.svelte';
  import TypographyPanel from './TypographyPanel.svelte';
  import ViewOptions from './ViewOptions.svelte';
  import { readerApi } from './slots.svelte';

  interface Props {
    session: ReaderSession;
    ui: ReaderUi;
    find: FindState;
    tools: ReadingTools;
    handle: BookHandle | null;
  }
  let { session, ui, find, tools, handle }: Props = $props();

  const caps = $derived(handle?.capabilities);
  const run = (id: string) => () => void commands.execute(id);
  const hasAnnotations = $derived(commandsState.list.some((c) => c.id === 'annotate.togglePanel'));
</script>

<div class="tools" role="toolbar" aria-label="Reader tools" data-testid="reader-toolbar">
  <IconButton icon="toc" label="Contents" size="sm" pressed={ui.sidebar === 'toc'} shortcut={keyState.shortcut('reader.toggleToc')} onclick={run('reader.toggleToc')} disabled={!handle} />
  {#if caps?.thumbnails}
    <IconButton icon="thumbnails" label="Pages" size="sm" pressed={ui.sidebar === 'pages'} shortcut={keyState.shortcut('reader.toggleThumbnails')} onclick={run('reader.toggleThumbnails')} />
  {/if}
  <IconButton icon="search" label="Find in book" size="sm" pressed={find.open} shortcut={keyState.shortcut('reader.find')} onclick={run('reader.find')} disabled={!handle} />
  <span class="sep" aria-hidden="true"></span>
  {#if caps?.typography}
    <Popover label="Text settings" bind:open={ui.typographyOpen} placement="bottom-end">
      {#snippet trigger(attrs)}
        <IconButton {...attrs} icon="text-size" label="Text settings" size="sm" pressed={ui.typographyOpen} data-testid="reader-typography-button" />
      {/snippet}
      <TypographyPanel {session} />
    </Popover>
  {/if}
  <Popover label="View options" bind:open={ui.viewOpen} placement="bottom-end">
    {#snippet trigger(attrs)}
      <IconButton {...attrs} icon="page" label="View options" size="sm" pressed={ui.viewOpen} disabled={!handle} data-testid="reader-view-button" />
    {/snippet}
    {#if handle}<ViewOptions {session} {tools} {handle} />{/if}
  </Popover>
  <IconButton icon="focus" label="Focus mode" size="sm" pressed={tools.focus} shortcut={keyState.shortcut('reader.toggleFocus')} onclick={run('reader.toggleFocus')} disabled={!handle} />
  {#if hasAnnotations}
    <IconButton icon="annotations" label="Annotations" size="sm" pressed={readerApi.panelId === 'annotations'} shortcut={keyState.shortcut('annotate.togglePanel')} onclick={run('annotate.togglePanel')} />
  {/if}
  <span class="sep" aria-hidden="true"></span>
</div>

<style>
  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 var(--space-1-5);
    background: var(--border-soft);
  }
</style>
