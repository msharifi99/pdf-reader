<script lang="ts">
  import { Button, Dialog } from '../ui';
  import { errorState } from './errors.svelte';

  let open = $state(false);
  let shown = $state({ title: '', message: '' });

  $effect(() => {
    if (errorState.current) {
      shown = errorState.current;
      open = true;
    }
  });
  function done() {
    open = false;
    errorState.current = null;
  }
</script>

<Dialog bind:open title={shown.title} size="sm" onclose={done}>
  <p class="msg" data-testid="error-message">{shown.message}</p>
  {#snippet footer()}
    <Button variant="primary" autofocus onclick={done}>OK</Button>
  {/snippet}
</Dialog>

<style>
  .msg { color: var(--muted); font-size: var(--text-sm); line-height: var(--leading-normal); max-width: 52ch; }
</style>
