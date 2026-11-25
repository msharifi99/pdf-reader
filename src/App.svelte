<script lang="ts">
  // Placeholder shell (T5 replaces it): proves core + window plumbing end to end.
  import { onMount } from 'svelte';
  import { core, coreEvents, coreMode } from './lib/core/core';
  import { app } from './lib/stores/app.svelte';

  let maxBtn: HTMLButtonElement;
  let maxHover = $state(false);
  let opaque = $state(true);

  function dragStart(e: MouseEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    if (e.detail === 2) void core.windowToggleMaximize();
    else void core.windowStartDrag();
  }

  function reportMaxRect() {
    const r = maxBtn.getBoundingClientRect();
    void core.windowSetMaxbtnRect(Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height));
  }

  onMount(() => {
    void core.appVersion().then((v) => (app.version = v));
    void core.windowBackdrop().then((b) => (opaque = b !== 'mica'));
    reportMaxRect();
    const ro = new ResizeObserver(reportMaxRect);
    ro.observe(maxBtn);
    window.addEventListener('resize', reportMaxRect);
    const un = coreEvents.onMaxButtonHover((h) => (maxHover = h));
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', reportMaxRect);
      void un.then((f) => f());
    };
  });
</script>

<div class="frame" class:opaque>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="titlebar" onmousedown={dragStart}>
    <span class="brand">Quire</span>
    <span class="spacer"></span>
    <button aria-label="Minimize" onclick={() => core.windowMinimize()}>&#8211;</button>
    <button
      bind:this={maxBtn}
      class:hover={maxHover}
      aria-label="Maximize"
      onclick={() => core.windowToggleMaximize()}>&#9633;</button>
    <button class="close" aria-label="Close" onclick={() => core.windowClose()}>&#10005;</button>
  </header>
  <main>
    <h1 data-testid="app-version">Quire {app.version}</h1>
    <p>{coreMode()} core</p>
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: transparent;
    font-family: system-ui, sans-serif;
    color: #e8e6e3;
  }
  .frame {
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .frame.opaque {
    background: #1b1b1f;
  }
  .titlebar {
    display: flex;
    align-items: center;
    height: 32px;
    padding-left: 12px;
    user-select: none;
  }
  .spacer {
    flex: 1;
  }
  button {
    width: 46px;
    height: 32px;
    border: 0;
    background: transparent;
    color: inherit;
    font-size: 12px;
  }
  button:hover,
  button.hover {
    background: rgb(255 255 255 / 0.1);
  }
  button.close:hover {
    background: #c42b1c;
  }
  main {
    padding: 24px;
  }
</style>
