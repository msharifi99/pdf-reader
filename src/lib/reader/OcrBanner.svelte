<script lang="ts">
  // Quiet, dismissible offer for scans without text (story 100).
  import { Button, Icon, IconButton } from '../ui';

  interface Props {
    onaccept: () => void;
    ondismiss: () => void;
  }
  let { onaccept, ondismiss }: Props = $props();
</script>

<div class="banner" role="status" data-testid="ocr-banner" data-chrome="bottom">
  <Icon name="info" size={16} />
  <span>This book is scanned. Make it searchable?</span>
  <Button size="sm" variant="secondary" onclick={onaccept}>Make searchable</Button>
  <IconButton icon="close" label="Not now" size="sm" onclick={ondismiss} />
</div>

<style>
  .banner {
    position: absolute;
    left: 50%;
    bottom: 48px;
    translate: -50% 0;
    z-index: var(--z-chrome);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1-5) var(--space-1-5) var(--space-1-5) var(--space-3-5, 14px);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    font-size: var(--text-sm);
    color: var(--text);
    white-space: nowrap;
    animation: in var(--dur-slow) var(--ease-out);
  }
  .banner > :global(svg) {
    color: var(--muted);
  }
  @keyframes in {
    from { opacity: 0; translate: -50% 4px; }
  }
</style>
