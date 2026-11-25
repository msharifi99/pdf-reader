<script lang="ts">
  // App shell: title bar, library <-> reader routing, overlays, global commands, chrome auto-hide.
  import { onMount, untrack } from 'svelte';
  import { core, coreMode } from './lib/core/core';
  import { commands, contextStack, keymap } from './lib/commands';
  import { engineKindFor } from './lib/engines/sniff';
  import { Button, EmptyState, ToastHost } from './lib/ui';
  import { app, closeBook, openDocument } from './lib/stores/app.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import TitleBar from './lib/shell/TitleBar.svelte';
  import Palette from './lib/shell/palette/Palette.svelte';
  import CheatSheet from './lib/shell/CheatSheet.svelte';
  import DropOverlay from './lib/shell/DropOverlay.svelte';
  import ErrorDialog from './lib/shell/ErrorDialog.svelte';
  import SettingsSheet from './lib/settings/SettingsSheet.svelte';
  import LibraryView from './lib/library/LibraryView.svelte';
  import ReaderView from './lib/reader/ReaderView.svelte';
  import { chrome } from './lib/shell/chrome.svelte';
  import { overlays, shellOverlays } from './lib/shell/overlays.svelte';
  import { installThemeManager } from './lib/shell/theme.svelte';
  import { registerGlobalCommands, registerThemeCommands } from './lib/shell/globalCommands';
  import { installDragDrop, installWindowState, setFileInput, SUPPORTED_EXTENSIONS } from './lib/shell/window.svelte';
  import { reportError } from './lib/shell/errors.svelte';
  import { openPalette, registerPaletteProvider } from './lib/shell/palette/providers.svelte';
  import { fade } from './lib/design/motion';
  import type { TransitionConfig } from 'svelte/transition';
  import { reducedMotion } from './lib/design/motion';

  let fileInput: HTMLInputElement | undefined = $state();

  const reading = $derived(app.view === 'reader');
  const settingsOpen = $derived(shellOverlays.settings);
  const viewKey = $derived(reading ? `reader:${app.book?.id}` : 'library');

  // key context follows the view; overlays push 'dialog' on top themselves
  $effect(() => {
    const f = app.book?.format;
    if (!reading || !f) return contextStack.setBase('library');
    const kind = engineKindFor(f);
    contextStack.setBase(kind === 'pdf' ? 'reader.fixed' : kind === 'comic' ? 'comic' : 'reader.reflow');
  });

  // chrome auto-hides in the reader only, never under an overlay
  $effect(() => {
    void reading;
    void overlays.any;
    void settings.value.chromeHideDelay;
    chrome.refresh();
  });

  // theme.set:<id> for every theme, re-registered as custom themes change
  $effect(() => {
    void settings.value.customThemes;
    return untrack(registerThemeCommands);
  });

  $effect(() => setFileInput(fileInput ?? null));

  onMount(() => {
    const offs: (() => void)[] = [];
    void core.appVersion().then((v) => (app.version = v));
    void core.windowBackdrop().then((b) => {
      if (b === 'mica') document.documentElement.dataset.mica = '';
      else delete document.documentElement.dataset.mica;
    });
    offs.push(installThemeManager());
    offs.push(registerGlobalCommands());
    offs.push(installWindowState());
    offs.push(installDragDrop());
    offs.push(
      chrome.install({
        enabled: () => app.view === 'reader' && !overlays.any,
        delay: () => settings.value.chromeHideDelay,
        blocked: () => overlays.any,
      }),
    );
    offs.push(commands.onError((err, cmd) => reportError(err, cmd ? `Couldn’t ${cmd.title.toLowerCase()}.` : undefined)));

    // ResizeObserver loop notices are benign browser warnings (layout settles next frame), not failures
    const onError = (e: ErrorEvent) => void (/ResizeObserver loop/.test(e.message) || reportError(e.error ?? e.message));
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    offs.push(() => window.removeEventListener('error', onError), () => window.removeEventListener('unhandledrejection', onRejection));

    const flush = () => void settings.flush();
    window.addEventListener('pagehide', flush);
    offs.push(() => window.removeEventListener('pagehide', flush));

    // files Quire was launched with (Explorer "Open with", file association)
    void core.takeLaunchFiles().then((paths) => {
      if (paths[0]) void openDocument(paths[0]);
    });

    if (coreMode() === 'fake') {
      (globalThis as Record<string, unknown>).__QUIRE__ = { commands, keymap, settings, app, contextStack, openDocument, closeBook, registerPaletteProvider, openPalette };
    }
    return () => offs.forEach((f) => f());
  });

  function viewIn(_n: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return { duration: 200, delay: 40, css: (t) => `opacity:${t};transform:translateY(${(1 - t) * 4}px)` };
  }

  function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void openDocument(f);
    input.value = '';
  }

  const accept = SUPPORTED_EXTENSIONS.map((x) => `.${x}`).join(',');
</script>

<div class="frame" class:reading>
  <TitleBar floating={reading && !settingsOpen} />

  <main class="views" inert={settingsOpen} aria-hidden={settingsOpen || undefined}>
    <svelte:boundary onerror={(err) => console.error('[quire] view crashed', err)}>
      {#key viewKey}
        <div class="view" in:viewIn out:fade={{ duration: 120 }}>
          {#if reading && app.book}
            <ReaderView bookId={app.book.id} />
          {:else}
            <LibraryView />
          {/if}
        </div>
      {/key}
      {#snippet failed(_error, reset)}
        <div class="crashed">
          <EmptyState
            icon="warning"
            size="page"
            title="This view ran into a problem"
            description="Nothing you saved is lost. Reload the view, or go back to your library."
          >
            {#snippet actions()}
              <Button variant="primary" onclick={reset}>Reload view</Button>
              {#if reading}<Button variant="subtle" onclick={() => { closeBook(); reset(); }}>Back to library</Button>{/if}
            {/snippet}
          </EmptyState>
        </div>
      {/snippet}
    </svelte:boundary>
  </main>

  {#if settingsOpen}<SettingsSheet />{/if}
</div>

<Palette />
<CheatSheet />
<DropOverlay />
<ErrorDialog />
<ToastHost />
<input bind:this={fileInput} class="sr-only" type="file" {accept} tabindex="-1" aria-hidden="true" data-testid="open-file-input" onchange={pickFile} />

<style>
  .frame {
    position: relative;
    height: 100vh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
  }
  .views { grid-row: 2; position: relative; display: grid; min-height: 0; background: var(--bg); }
  .reading .views { grid-row: 1 / -1; }
  .view { grid-area: 1 / 1; min-width: 0; min-height: 0; overflow: hidden; }
  .crashed { display: grid; place-items: center; height: 100%; padding: var(--space-10); }
  /* while the reader chrome is hidden, nothing may show a cursor */
  :global(:root[data-chrome-hidden] *) { cursor: none !important; }
</style>
