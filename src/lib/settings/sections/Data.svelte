<script lang="ts">
  // TODO(T4/T7): wire backup/restore to the core's backup commands (save dialog → backup file;
  // open dialog → restore + reload). The visual design is final.
  import { Button } from '../../ui';
  import { settings } from '../../stores/settings.svelte';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  const where = $derived(settings.adapterKind === 'core' ? 'in Quire’s library database' : 'in this browser (development mode)');
</script>

<SettingGroup title="Backup">
  <SettingRow label="Back up everything" description="One file with your library, progress, highlights, notes and settings. Your books themselves stay where they are." keywords="export save backup" >
    <Button variant="secondary" icon="export" data-todo="T4">Back up…</Button>
  </SettingRow>
  <SettingRow label="Restore from a backup" description="Replaces what is here with the backup’s contents. Quire asks before it changes anything." keywords="import restore">
    <Button variant="secondary" icon="import" data-todo="T4">Restore…</Button>
  </SettingRow>
</SettingGroup>

<SettingGroup title="Storage">
  <SettingRow label="Saved automatically" description="Every change is saved the moment you make it, {where}." keywords="persist settings database">
    <span class="ok">Up to date</span>
  </SettingRow>
</SettingGroup>

<style>
  .ok { font-size: var(--text-xs); color: var(--muted); }
</style>
