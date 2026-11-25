<script lang="ts">
  // Auto-scroll speed HUD: shows on start/stop/speed change, then a tiny pill stays while it runs.
  import { Icon, Kbd } from '../ui';
  import { keyState } from '../commands';
  import type { ReadingTools } from './tools.svelte';

  interface Props {
    tools: ReadingTools;
  }
  let { tools }: Props = $props();
  const show = $derived(tools.hudUntil > 0);
</script>

{#if show || tools.auto !== 'off'}
  <div class="hud" class:big={show} role="status" aria-live="polite" data-testid="autoscroll-hud">
    <Icon name={tools.auto === 'running' ? 'auto-scroll' : 'pause'} size={16} />
    {#if tools.auto === 'off'}
      <span>Auto-scroll off</span>
    {:else if tools.auto === 'paused'}
      <span>Paused</span>
    {:else}
      <span class="tabular">{tools.speedLabel}</span>
    {/if}
    {#if show && tools.auto !== 'off'}
      <span class="keys"><Kbd keys={keyState.shortcut('reader.autoScrollSlower') ?? '['} /> <Kbd keys={keyState.shortcut('reader.autoScrollFaster') ?? ']'} /></span>
    {/if}
  </div>
{/if}

<style>
  .hud {
    position: absolute;
    left: 50%;
    bottom: 44px;
    translate: -50% 0;
    z-index: var(--z-chrome);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    background: var(--flyout-bg);
    border: 1px solid var(--border);
    color: var(--muted);
    font-size: var(--text-xs);
    opacity: 0.55;
    transition: opacity var(--dur-slow) var(--ease-out);
  }
  .hud.big {
    opacity: 1;
    color: var(--text);
    box-shadow: var(--shadow-2);
  }
  .keys {
    display: inline-flex;
    gap: 2px;
    margin-left: var(--space-1);
  }
</style>
