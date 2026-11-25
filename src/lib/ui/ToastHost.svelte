<script lang="ts">
  import { flip } from 'svelte/animate';
  import Icon from './Icon.svelte';
  import { fadeScale } from '../design/motion';
  import { dismiss, hold, release, toasts } from './toast.svelte';
  import type { IconName } from './icons';

  const icon: Record<string, IconName> = { info: 'info', success: 'check-circle', warning: 'warning', error: 'error' };
</script>

<!-- Mount once in the app shell. Polite live region; errors are assertive. -->
<div class="host" aria-live="polite" aria-relevant="additions">
  {#each toasts as t (t.id)}
    <div
      class="toast {t.kind}"
      role={t.kind === 'error' ? 'alert' : 'status'}
      animate:flip={{ duration: 160 }}
      transition:fadeScale={{ from: 'bottom', start: 0.96 }}
      onpointerenter={() => hold(t.id)}
      onpointerleave={() => release(t.id)}
      onfocusin={() => hold(t.id)}
      onfocusout={() => release(t.id)}
    >
      <Icon name={icon[t.kind]!} size={18} />
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button class="action" onclick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={() => dismiss(t.id)}><Icon name="close" size={14} /></button>
    </div>
  {/each}
</div>

<style>
  .host {
    position: fixed;
    left: 50%;
    bottom: var(--space-6);
    translate: -50% 0;
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    max-width: min(480px, calc(100vw - 32px));
    padding: var(--space-1) var(--space-1) var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-3);
    font-size: var(--text-sm);
    color: var(--text);
  }
  .toast > :global(.icon) { color: var(--muted); }
  .success > :global(.icon) { color: var(--success); }
  .warning > :global(.icon) { color: var(--accent); }
  .error > :global(.icon) { color: var(--danger); }
  .msg { padding: var(--space-1) 0; }
  .action {
    margin-left: var(--space-2);
    height: 28px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-weight: var(--weight-semibold);
  }
  .action:hover { background: var(--accent-soft); }
  .x {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--muted);
  }
  .x:hover { background: var(--hover); color: var(--text); }
</style>
