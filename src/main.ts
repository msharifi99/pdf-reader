// Boot: theme first (no flash), then core, settings and keymap, then the UI.
import { mount } from 'svelte';
import './lib/design/tokens.css';
import { applyBootTheme } from './lib/shell/theme.svelte';
import { initCore } from './lib/core/core';
import { installKeyboard } from './lib/commands';
import { bindKeymapToSettings } from './lib/stores/keymapSync';
import { installFlushOnClose } from './lib/core/flush';
import { settings } from './lib/stores/settings.svelte';
import { installKeyCaptureHook } from './lib/shell/keyCapture';
import './lib/annotations'; // highlights, notes, bookmarks (T11): reader overlay + library view

applyBootTheme();
await initCore();
const target = document.getElementById('app')!;

if (new URLSearchParams(location.search).has('gallery')) {
  const { default: Gallery } = await import('./lib/ui/Gallery.svelte');
  mount(Gallery, { target });
} else {
  await settings.init();
  bindKeymapToSettings();
  installFlushOnClose();
  installKeyCaptureHook(); // before the dispatcher: the shortcuts editor must see keys first
  installKeyboard();
  (await import('./lib/speech/ui/install')).installReadAloudAndLookup();
  const { default: App } = await import('./App.svelte');
  mount(App, { target });
}
