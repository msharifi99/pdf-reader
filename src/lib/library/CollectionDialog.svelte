<!-- New collection (optionally for a book) or rename one. -->
<script lang="ts">
  import type { Collection } from '../core/bindings';
  import { core } from '../core/core';
  import { Button, Dialog, TextField } from '../ui';
  import { lib, reload } from './library.svelte';

  let { bookId, rename }: { bookId?: string; rename?: Collection } = $props();
  let open = $state(true);
  // svelte-ignore state_referenced_locally
  let name = $state(rename?.name ?? '');
  let error: string | undefined = $state();
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    try {
      if (rename) await core.renameCollection(rename.id, name.trim());
      else {
        const c = await core.createCollection(name.trim());
        if (bookId) await core.addToCollection(bookId, c.id);
      }
      await reload();
      open = false;
    } catch (err) {
      error = String((err as { message?: unknown })?.message ?? 'That name didn’t work.');
    } finally {
      busy = false;
    }
  }
</script>

<Dialog bind:open size="sm" title={rename ? 'Rename collection' : 'New collection'} onclose={() => (lib.collectionDialog = null)}>
  <form id="collection-form" onsubmit={submit} data-testid="collection-dialog">
    <!-- svelte-ignore a11y_autofocus -->
    <TextField label="Name" bind:value={name} {error} placeholder="Summer reading" autofocus oninput={() => (error = undefined)} />
  </form>
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="collection-form" loading={busy} disabled={!name.trim()}>{rename ? 'Rename' : 'Create'}</Button>
  {/snippet}
</Dialog>
