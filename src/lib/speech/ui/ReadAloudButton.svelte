<script lang="ts">
  // Bottom bar entry point (fades with the chrome): starts reading at the selection or the current page.
  import { commands, keyState } from '../../commands';
  import { IconButton } from '../../ui';
  import { speech } from '..';
</script>

{#if speech.state === 'idle'}
  <IconButton
    icon="speaker"
    label="Read aloud"
    size="sm"
    tooltipPlacement="top"
    shortcut={keyState.shortcut('reader.readAloud')}
    onclick={() => void commands.execute('reader.readAloud')}
    data-testid="speech-start"
  />
{/if}
