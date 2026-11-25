<script lang="ts">
  // Watched folders (T7): list, add (folder picker), remove and rescan through the core.
  import { onMount } from 'svelte';
  import { Button, Icon, ProgressBar } from '../../ui';
  import { commands } from '../../commands';
  import { core } from '../../core/core';
  import { reportError } from '../../shell/errors.svelte';
  import { lib, loadFolders } from '../../library/library.svelte';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  let counts: Record<string, number> = $state({});
  let rescanning = $state(false);

  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() + '\\';
  async function count() {
    const books = await core.listBooks({});
    const next: Record<string, number> = {};
    for (const f of lib.folders) next[f] = books.filter((b) => b.path && b.path.replace(/\//g, '\\').toLowerCase().startsWith(norm(f))).length;
    counts = next;
  }
  onMount(() => {
    void loadFolders().then(count);
  });
  $effect(() => {
    void lib.folders.length;
    void lib.ingest;
    void count();
  });

  async function remove(path: string) {
    try {
      await core.removeWatchedFolder(path);
      await loadFolders();
    } catch (err) {
      reportError(err, 'Couldn’t stop watching that folder.');
    }
  }
  async function rescan() {
    rescanning = true;
    try {
      await core.rescanWatchedFolders();
    } catch (err) {
      reportError(err, 'Couldn’t scan your folders.');
    } finally {
      rescanning = false;
    }
  }
</script>

<SettingGroup title="Watched folders">
  <SettingRow label="Folders" description="Quire adds new books from these folders automatically and notices when files move." keywords="watch scan import directory" stacked>
    <div class="folders" data-testid="watched-folders">
      {#each lib.folders as f (f)}
        <div class="folder">
          <Icon name="folder" size={16} />
          <span class="path" title={f}>{f}</span>
          {#if counts[f] !== undefined}<span class="count tabular">{counts[f]} {counts[f] === 1 ? 'book' : 'books'}</span>{/if}
          <Button variant="ghost" size="sm" aria-label="Stop watching {f}" onclick={() => remove(f)}>Remove</Button>
        </div>
      {:else}
        <div class="none">
          <Icon name="folder" size={20} />
          <div>
            <p class="t">No watched folders yet</p>
            <p class="d">Add the folder where you keep your books, such as Documents\Books.</p>
          </div>
        </div>
      {/each}
      {#if lib.ingest}
        <div class="scan" role="status">
          <span>Adding books · <span class="tabular">{lib.ingest.done} of {lib.ingest.total}</span></span>
          <div class="scan-bar"><ProgressBar value={lib.ingest.total ? lib.ingest.done / lib.ingest.total : undefined} label="Scanning folders" /></div>
        </div>
      {/if}
      <div class="actions">
        <Button variant="secondary" icon="plus" onclick={() => commands.execute('library.addFolder')}>Add folder…</Button>
        {#if lib.folders.length}
          <Button variant="ghost" icon="history" loading={rescanning} onclick={rescan}>Scan now</Button>
        {/if}
      </div>
    </div>
  </SettingRow>
</SettingGroup>

<style>
  .folders { display: flex; flex-direction: column; gap: var(--space-2); }
  .folder { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; padding: 0 var(--space-1) 0 var(--space-3); border-radius: var(--radius-sm); background: var(--surface); color: var(--muted); }
  .path { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: var(--text-xs); color: var(--muted); }
  .none { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-5); border-radius: var(--radius-md); border: 1px dashed var(--border-strong); color: var(--muted); }
  .none .t { color: var(--text); font-size: var(--text-sm); font-weight: var(--weight-medium); }
  .none .d { font-size: var(--text-xs); }
  .scan { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-1) var(--space-3); font-size: var(--text-xs); color: var(--muted); }
  .scan-bar { flex: 1; max-width: 200px; }
  .actions { display: flex; gap: var(--space-2); padding-top: var(--space-2); }
</style>
