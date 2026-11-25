<script lang="ts">
  // Custom Windows 11 title bar: drag region, app mark / back, palette field, caption buttons.
  // The native layer owns clicks on maximize (snap layouts); we only draw its hover from the event.
  import { onMount } from 'svelte';
  import { core, coreEvents } from '../core/core';
  import { commands, keyState } from '../commands';
  import { Icon, IconButton, Kbd } from '../ui';
  import { app } from '../stores/app.svelte';
  import { titleBar } from './titlebarSlots.svelte';
  import { win } from './window.svelte';
  import { shellOverlays } from './overlays.svelte';

  interface Props {
    /** overlay mode (reader): floats over the page and fades with the chrome */
    floating?: boolean;
  }
  let { floating = false }: Props = $props();

  let maxBtn: HTMLButtonElement | undefined = $state();
  let maxHover = $state(false);

  const parts = $derived(titleBar.parts);
  const inSettings = $derived(shellOverlays.settings);
  const paletteKeys = $derived(keyState.shortcut('app.openPalette') ?? 'Ctrl+K');

  function dragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, [role=button], [data-no-drag]')) return;
    if (e.detail === 2) void core.windowToggleMaximize();
    else void core.windowStartDrag();
  }

  function reportMaxRect() {
    if (!maxBtn) return;
    if (win.fullscreen) return void core.windowSetMaxbtnRect(0, 0, 0, 0);
    const r = maxBtn.getBoundingClientRect();
    void core.windowSetMaxbtnRect(Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height));
  }

  $effect(() => {
    void win.fullscreen;
    void floating;
    reportMaxRect();
  });

  onMount(() => {
    const ro = new ResizeObserver(reportMaxRect);
    if (maxBtn) ro.observe(maxBtn);
    window.addEventListener('resize', reportMaxRect);
    const un = coreEvents.onMaxButtonHover((h) => (maxHover = h));
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', reportMaxRect);
      void un.then((f) => f());
    };
  });

  const run = (id: string) => () => void commands.execute(id);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<header
  class="titlebar"
  class:floating
  class:inactive={!win.focused}
  data-chrome={floating ? 'top' : undefined}
  onmousedown={dragStart}
>
  <div class="lead">
    {#if inSettings}
      <button class="back" onclick={run('app.back')} aria-label="Close settings">
        <Icon name="back" size={16} />
        <span class="t">Settings</span>
      </button>
    {:else if app.view === 'reader'}
      <button class="back" onclick={run('app.back')} aria-label="Back to library">
        <Icon name="back" size={16} />
        <span class="t">Library</span>
      </button>
      {#if parts.leading}{@render parts.leading()}{/if}
      <span class="book" title={parts.title ?? app.book?.title}>
        <span class="book-title">{parts.title ?? app.book?.title ?? ''}</span>
        {#if parts.subtitle}<span class="sep" aria-hidden="true">·</span><span class="sub">{parts.subtitle}</span>{/if}
      </span>
    {:else}
      <span class="mark" aria-hidden="true">
        <svg viewBox="0 0 18 18" width="18" height="18"
          ><rect width="18" height="18" rx="5" fill="var(--accent)" /><path
            d="M5.25 4.75h5.1a2.4 2.4 0 0 1 2.4 2.4v6.1H7.65a2.4 2.4 0 0 1-2.4-2.4z"
            fill="none"
            stroke="var(--on-accent)"
            stroke-width="1.4"
            stroke-linejoin="round"
          /><path d="M9.6 10.4l3.15 2.85" stroke="var(--on-accent)" stroke-width="1.4" stroke-linecap="round" /></svg
        >
      </span>
      <span class="app-name">Quire</span>
      <span class="sr-only" data-testid="app-version">Quire {app.version}</span>
    {/if}
  </div>

  <div class="center">
    <button class="palette-field" onclick={run('app.openPalette')} aria-label="Search or run a command" aria-keyshortcuts="Control+K">
      <Icon name="search" size={16} />
      <span class="ph">Search or run a command</span>
      <Kbd keys={paletteKeys} />
    </button>
  </div>

  <div class="trail">
    {#if parts.trailing && app.view === 'reader' && !inSettings}{@render parts.trailing()}{/if}
    {#if !inSettings}
      <IconButton icon="theme" label="Next theme" size="sm" onclick={run('theme.next')} />
      <IconButton icon="settings" label="Settings" shortcut={keyState.shortcut('app.settings')} size="sm" onclick={run('app.settings')} />
    {/if}
    {#if !win.fullscreen}
      <div class="caption" role="group" aria-label="Window">
        <button class="cap" aria-label="Minimize" tabindex="-1" onclick={() => core.windowMinimize()}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" /></svg>
        </button>
        <button
          bind:this={maxBtn}
          class="cap"
          class:hover={maxHover}
          aria-label={win.maximized ? 'Restore' : 'Maximize'}
          tabindex="-1"
          onclick={() => core.windowToggleMaximize()}
        >
          {#if win.maximized}
            <svg viewBox="0 0 10 10" aria-hidden="true"
              ><rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg
            >
          {:else}
            <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
          {/if}
        </button>
        <button class="cap close" aria-label="Close" tabindex="-1" onclick={() => core.windowClose()}>
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
        </button>
      </div>
    {/if}
  </div>
</header>

<style>
  .titlebar {
    position: relative;
    z-index: var(--z-chrome);
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(240px, 440px) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-4);
    height: var(--titlebar-h);
    padding-left: var(--space-3);
    background: var(--chrome-bg);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    backdrop-filter: blur(20px) saturate(1.2);
    border-bottom: 1px solid var(--border-soft);
    user-select: none;
    transition: background-color var(--dur-slow) var(--ease-out), border-color var(--dur-slow) var(--ease-out);
  }
  .titlebar.floating {
    position: absolute;
    inset: 0 0 auto 0;
  }
  .lead {
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    min-width: 0;
    height: 100%;
  }
  .mark {
    display: grid;
    flex: none;
    transition: filter var(--dur-slow) var(--ease-out), opacity var(--dur-slow) var(--ease-out);
  }
  .app-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--text);
    letter-spacing: 0.01em;
    transition: color var(--dur-slow) var(--ease-out);
  }
  .back {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: 28px;
    padding: 0 var(--space-2-5) 0 var(--space-2);
    margin-left: calc(var(--space-1) * -1);
    border-radius: var(--radius-sm);
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .back:hover { background: var(--hover); color: var(--text); }
  .back:active { background: var(--pressed); }
  .book {
    display: flex;
    align-items: baseline;
    gap: var(--space-1-5);
    min-width: 0;
    font-size: var(--text-xs);
    white-space: nowrap;
  }
  .book-title { color: var(--text); font-weight: var(--weight-medium); overflow: hidden; text-overflow: ellipsis; }
  .sep, .sub { color: var(--muted); }
  .sub { overflow: hidden; text-overflow: ellipsis; }

  .center { display: flex; justify-content: center; min-width: 0; }
  .palette-field {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 28px;
    padding: 0 var(--space-1) 0 var(--space-2-5);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--text) 5%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 4%, transparent);
    color: var(--muted);
    font-size: var(--text-xs);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .palette-field:hover { background: color-mix(in oklab, var(--text) 8%, transparent); color: var(--text); }
  .palette-field:active { background: color-mix(in oklab, var(--text) 6%, transparent); }
  .palette-field .ph { flex: 1; text-align: left; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }

  .trail {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-0-5);
    height: 100%;
    min-width: 0;
  }
  .caption { display: flex; height: 100%; margin-left: var(--space-2); }
  .cap {
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--text);
    transition: background-color var(--dur-instant) linear, color var(--dur-instant) linear;
  }
  .cap svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    shape-rendering: geometricPrecision;
    overflow: visible;
  }
  /* Windows 11 caption colours: subtle fill on hover/press; close is the system red. */
  .cap:hover,
  .cap.hover { background: color-mix(in oklab, var(--text) 7%, transparent); }
  .cap:active { background: color-mix(in oklab, var(--text) 4%, transparent); }
  .cap.close:hover { background: #c42b1c; color: #fff; }
  .cap.close:active { background: color-mix(in srgb, #c42b1c 90%, transparent); color: color-mix(in srgb, #fff 70%, transparent); }

  /* Window lost focus: caption glyphs and title fade like native apps; the accent mark goes grey. */
  .inactive .app-name,
  .inactive .book-title,
  .inactive .cap:not(:hover) { color: var(--faint); }
  .inactive .mark { filter: grayscale(1); opacity: 0.55; }

  @media (forced-colors: active) {
    .cap.close:hover { background: Highlight; color: HighlightText; }
  }
</style>
