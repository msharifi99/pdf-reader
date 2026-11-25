<script lang="ts">
  // Backup and restore (T7): save dialog → core.backup(dest); open dialog → confirm → core.restore(src) → reload.
  import { Button, Dialog, Icon } from '../../ui';
  import { core } from '../../core/core';
  import { settings } from '../../stores/settings.svelte';
  import { pickPath, reload, loadFolders } from '../../library/library.svelte';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  const where = $derived(settings.adapterKind === 'core' ? 'in Quire’s library database' : 'in this browser (development mode)');

  type Note = { kind: 'ok' | 'error'; text: string } | null;
  let backupNote: Note = $state(null);
  let restoreNote: Note = $state(null);
  let backingUp = $state(false);
  let restoring = $state(false);
  let confirm: string | null = $state(null);
  let confirmOpen = $state(false);

  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
  const message = (err: unknown) => {
    const m = String((err as { message?: unknown })?.message ?? '');
    return m && m.length < 160 ? m : 'Something went wrong.';
  };

  async function backup() {
    backupNote = null;
    const dest = await pickPath('save', 'Save a Quire backup');
    if (!dest) return;
    backingUp = true;
    try {
      await core.backup(dest);
      backupNote = { kind: 'ok', text: `Saved “${fileName(dest)}”.` };
    } catch (err) {
      backupNote = { kind: 'error', text: `Couldn’t save the backup. ${message(err)}` };
    } finally {
      backingUp = false;
    }
  }

  async function chooseRestore() {
    restoreNote = null;
    const src = await pickPath('open', 'Choose a Quire backup');
    if (!src) return;
    confirm = src;
    confirmOpen = true;
  }

  async function restore() {
    const src = confirm;
    confirmOpen = false;
    if (!src) return;
    restoring = true;
    try {
      await core.restore(src);
      await settings.init(); // the backup carries its own settings
      await Promise.all([reload(), loadFolders()]);
      restoreNote = { kind: 'ok', text: `Restored from “${fileName(src)}”.` };
    } catch (err) {
      restoreNote = { kind: 'error', text: `Nothing was changed. ${message(err)}` };
    } finally {
      restoring = false;
    }
  }
</script>

<SettingGroup title="Backup">
  <SettingRow label="Back up everything" description="One file with your library, progress, highlights, notes and settings. Your books themselves stay where they are." keywords="export save backup">
    {#if backupNote}<span class="note {backupNote.kind}" role="status"><Icon name={backupNote.kind === 'ok' ? 'check' : 'warning'} size={14} />{backupNote.text}</span>{/if}
    <Button variant="secondary" icon="export" loading={backingUp} onclick={backup}>Back up…</Button>
  </SettingRow>
  <SettingRow label="Restore from a backup" description="Replaces what is here with the backup’s contents. Quire asks before it changes anything." keywords="import restore">
    {#if restoreNote}<span class="note {restoreNote.kind}" role="status"><Icon name={restoreNote.kind === 'ok' ? 'check' : 'warning'} size={14} />{restoreNote.text}</span>{/if}
    <Button variant="secondary" icon="import" loading={restoring} onclick={chooseRestore}>Restore…</Button>
  </SettingRow>
</SettingGroup>

<SettingGroup title="Storage">
  <SettingRow label="Saved automatically" description="Every change is saved the moment you make it, {where}." keywords="persist settings database">
    <span class="ok">Up to date</span>
  </SettingRow>
</SettingGroup>

<Dialog bind:open={confirmOpen} size="sm" title="Restore this backup?" description="Your current library, progress, highlights and settings will be replaced by the ones in “{confirm ? fileName(confirm) : ''}”. Your book files are not touched.">
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (confirmOpen = false)}>Cancel</Button>
    <Button variant="primary" onclick={restore}>Restore</Button>
  {/snippet}
</Dialog>

<style>
  .ok { font-size: var(--text-xs); color: var(--muted); }
  .note { display: inline-flex; align-items: center; gap: var(--space-1-5); max-width: 280px; margin-right: var(--space-2); font-size: var(--text-xs); color: var(--muted); }
  .note.ok :global(svg) { color: var(--success); }
  .note.error { color: var(--text); }
  .note.error :global(svg) { color: var(--danger); }
</style>
