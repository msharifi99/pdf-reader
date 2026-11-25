// Boot: theme first (no flash), then core, settings and keymap, then the UI.
import { mount } from 'svelte';
import './lib/design/tokens.css';
import { applyBootTheme } from './lib/shell/theme.svelte';
import { initCore } from './lib/core/core';
import { perfMark } from './lib/core/perf';
import { installKeyboard } from './lib/commands';
import { bindKeymapToSettings } from './lib/stores/keymapSync';
import { installFlushOnClose } from './lib/core/flush';
import { settings } from './lib/stores/settings.svelte';
import { installKeyCaptureHook } from './lib/shell/keyCapture';

applyBootTheme();
await initCore();
perfMark('main-script');
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
  const { default: App } = await import('./App.svelte');
  mount(App, { target });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => perfMark('webview-dcl'), { once: true });
  else perfMark('webview-dcl');
}
