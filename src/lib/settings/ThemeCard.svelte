<script lang="ts">
  // A theme tile with a live miniature of a reading page in that theme.
  import type { AppTheme } from '../design/themes';
  import { themeStyle } from '../design/themes';
  import { Icon } from '../ui';

  interface Props {
    theme: AppTheme;
    selected?: boolean;
    /** small tag in the corner: "Light" / "Dark" slot when following Windows */
    tag?: string;
    onselect: () => void;
    onedit?: () => void;
  }
  let { theme, selected = false, tag, onselect, onedit }: Props = $props();
</script>

<div class="card" class:selected>
  <button class="tile" role="radio" aria-checked={selected} aria-label={theme.name} onclick={onselect} data-theme-card={theme.id}>
    <span class="mini" style={themeStyle(theme)} aria-hidden="true">
      <span class="bar"><i></i><i></i><i></i></span>
      <span class="page">
        <span class="h"></span>
        <span class="l" style="width: 92%"></span>
        <span class="l" style="width: 84%"></span>
        <span class="l hl" style="width: 64%"></span>
        <span class="l" style="width: 88%"></span>
        <span class="l short"><b></b></span>
      </span>
    </span>
    <span class="name">
      {theme.name}
      {#if tag}<span class="tag">{tag}</span>{/if}
    </span>
  </button>
  {#if onedit}
    <button class="edit" aria-label="Edit {theme.name}" onclick={onedit}><Icon name="edit" size={16} /></button>
  {/if}
</div>

<style>
  .card { position: relative; }
  .tile { display: flex; flex-direction: column; gap: var(--space-2); width: 100%; text-align: left; border-radius: var(--radius-md); }
  .tile:focus-visible { outline-offset: 3px; }
  .mini {
    position: relative;
    display: flex;
    flex-direction: column;
    aspect-ratio: 3 / 2;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--text) 14%, transparent);
    /* a theme preview is a picture of colours: keep them in Windows high contrast */
    forced-color-adjust: none;
    transition: box-shadow var(--dur-fast) var(--ease-out), translate var(--dur-slow) var(--ease-out);
  }
  .tile:hover .mini { translate: 0 -2px; box-shadow: 0 0 0 1px color-mix(in oklab, var(--text) 22%, transparent), var(--shadow-2); }
  /* the ring is drawn in the APP's accent (outside the mini, which uses the previewed theme's vars) */
  .selected .mini { box-shadow: 0 0 0 2px var(--ring), 0 0 0 4px color-mix(in oklab, var(--ring) 22%, transparent); }
  .card { --ring: var(--accent); }
  .bar {
    display: flex;
    gap: 3px;
    align-items: center;
    height: 14%;
    padding: 0 8%;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .bar i { width: 4px; height: 4px; border-radius: 50%; background: var(--muted); opacity: 0.6; }
  .bar i:first-child { background: var(--accent); opacity: 1; }
  .page { display: flex; flex-direction: column; gap: 5px; padding: 10% 14% 0; }
  .h { width: 46%; height: 6px; margin-bottom: 3px; border-radius: 2px; background: var(--text); }
  .l { height: 3px; border-radius: 2px; background: color-mix(in oklab, var(--text) 52%, var(--bg)); }
  .l.hl { background: var(--hl-yellow); box-shadow: inset 0 0 0 4px color-mix(in oklab, var(--text) 30%, transparent); background-clip: padding-box; }
  .l.short { width: 40%; position: relative; }
  .l.short b { position: absolute; right: -36%; top: -1px; width: 28%; height: 5px; border-radius: 2px; background: var(--link); }
  .name { display: flex; align-items: center; gap: var(--space-1-5); font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--text); }
  .selected .name { color: var(--text); }
  .tag {
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    background: var(--accent-soft);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .edit {
    position: absolute;
    top: 6px;
    right: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--surface-2) 92%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .card:hover .edit, .edit:focus-visible { opacity: 1; }
  .edit:hover { color: var(--text); }
</style>
