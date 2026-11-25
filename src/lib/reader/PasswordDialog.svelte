<script lang="ts">
  // Password prompt for encrypted PDFs (story 12). Retries on a wrong password; Esc / Cancel gives up quietly.
  import { Button, Dialog, TextField } from '../ui';

  interface Props {
    retry: boolean;
    title: string;
    onsubmit: (password: string | null) => void;
  }
  let { retry, title, onsubmit }: Props = $props();

  let open = $state(true);
  let value = $state('');
  let done = false;
  function finish(v: string | null) {
    if (done) return;
    done = true;
    open = false;
    onsubmit(v);
  }
</script>

<Dialog bind:open title="This document is password-protected" description="Enter the password to open “{title}”." size="sm" onclose={() => finish(null)}>
  <form
    id="pdf-password"
    data-testid="password-dialog"
    onsubmit={(e) => {
      e.preventDefault();
      if (value) finish(value);
    }}
  >
    <TextField label="Password" type="password" bind:value autofocus autocomplete="current-password" error={retry ? 'That password didn’t work. Try again.' : undefined} />
  </form>
  {#snippet footer()}
    <Button variant="subtle" onclick={() => finish(null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="pdf-password" disabled={!value}>Open</Button>
  {/snippet}
</Dialog>
