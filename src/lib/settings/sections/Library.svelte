<script lang="ts">
  // TODO(T7): wire watched folders to the core (list/add/remove watched folders, rescan). The visual
  // design is final; replace `folders` with the core's list and the buttons' handlers.
  import { Button, Icon } from '../../ui';
  import { commands } from '../../commands';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  const folders: { path: string; books: number }[] = [];
</script>

<SettingGroup title="Watched folders">
  <SettingRow label="Folders" description="Quire adds new books from these folders automatically and notices when files move." keywords="watch scan import directory" stacked>
    <div class="folders" data-todo="T7">
      {#each folders as f (f.path)}
        <div class="folder">
          <Icon name="folder" size={16} />
          <span class="path">{f.path}</span>
          <span class="count">{f.books} books</span>
          <Button variant="ghost" size="sm">Remove</Button>
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
      <div class="actions">
        <Button variant="secondary" icon="plus" onclick={() => commands.execute('library.addFolder')}>Add folder…</Button>
      </div>
    </div>
  </SettingRow>
</SettingGroup>

<style>
  .folders { display: flex; flex-direction: column; gap: var(--space-2); }
  .folder { display: flex; align-items: center; gap: var(--space-3); min-height: 44px; padding: 0 var(--space-3); border-radius: var(--radius-sm); background: var(--surface); }
  .path { flex: 1; font-size: var(--text-sm); }
  .count { font-size: var(--text-xs); color: var(--muted); }
  .none { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-5); border-radius: var(--radius-md); border: 1px dashed var(--border-strong); color: var(--muted); }
  .none .t { color: var(--text); font-size: var(--text-sm); font-weight: var(--weight-medium); }
  .none .d { font-size: var(--text-xs); }
  .actions { padding-top: var(--space-2); }
</style>
