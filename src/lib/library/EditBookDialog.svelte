<!-- Edit details (F2): title, author and a cover image chosen from a file. -->
<script lang="ts">
  import type { Book } from '../core/bindings';
  import { core, raw } from '../core/core';
  import { Button, Dialog, TextField } from '../ui';
  import { reportError } from '../shell/errors.svelte';
  import BookCover from './BookCover.svelte';
  import { encodeCover } from './covers';
  import { lib, reload } from './library.svelte';

  let { book }: { book: Book } = $props();

  let open = $state(true);
  // svelte-ignore state_referenced_locally (the dialog edits a snapshot of the book it was opened for)
  let title = $state(book.title);
  // svelte-ignore state_referenced_locally
  let author = $state(book.author);
  let file: File | null = $state(null);
  let preview: string | null = $state(null);
  let saving = $state(false);
  let picker: HTMLInputElement | undefined = $state();
  const error = $derived(title.trim() ? undefined : 'A book needs a title.');

  function choose(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    file = f;
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(f);
  }

  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (error || saving) return;
    saving = true;
    try {
      if (title.trim() !== book.title || author.trim() !== book.author) await core.setBookMetadata(book.id, { title: title.trim(), author: author.trim(), user: true });
      if (file) await raw.saveCover(book.id, await encodeCover(file));
      await reload();
      open = false;
    } catch (err) {
      reportError(err, 'Couldn’t save those details.');
    } finally {
      saving = false;
    }
  }

  function closed() {
    if (preview) URL.revokeObjectURL(preview);
    lib.editing = null;
  }
</script>

<Dialog bind:open title="Edit details" description="Changes stay in Quire; the file itself is never modified." onclose={closed}>
  <form class="body" id="edit-book" onsubmit={save} data-testid="edit-book">
    <div class="cover">
      <BookCover title={title || book.title} author={author} src={preview ?? book.coverUrl} />
      <Button size="sm" variant="ghost" icon="image" onclick={() => picker?.click()}>Choose image…</Button>
      <input bind:this={picker} class="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" tabindex="-1" aria-hidden="true" onchange={choose} />
    </div>
    <div class="fields">
      <!-- svelte-ignore a11y_autofocus -->
      <TextField label="Title" bind:value={title} {error} autofocus />
      <TextField label="Author" bind:value={author} hint="Separate several authors with “&”." />
    </div>
  </form>
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="edit-book" loading={saving} disabled={!!error}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .body { display: grid; grid-template-columns: 112px 1fr; gap: var(--space-6); align-items: start; }
  .cover { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
  .fields { display: flex; flex-direction: column; gap: var(--space-4); }
</style>
