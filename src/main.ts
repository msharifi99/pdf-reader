// Boot: theme first (no flash), then core, settings and keymap, then the UI.
import { mount } from 'svelte';
import './lib/design/tokens.css';
import { applyBootTheme } from './lib/shell/theme.svelte';
import { initCore } from './lib/core/core';
import { installKeyboard, keymap } from './lib/commands';
import { settings } from './lib/stores/settings.svelte';
import { installKeyCaptureHook } from './lib/shell/keyCapture';

applyBootTheme();
await initCore();
const target = document.getElementById('app')!;

if (new URLSearchParams(location.search).has('gallery')) {
  const { default: Gallery } = await import('./lib/ui/Gallery.svelte');
  mount(Gallery, { target });
} else {
  await settings.init();
  keymap.load(settings.value.keymap);
  keymap.onChange(() => settings.set('keymap', keymap.serialize()));
  installKeyCaptureHook(); // before the dispatcher: the shortcuts editor must see keys first
  installKeyboard();
  const { default: App } = await import('./App.svelte');
  mount(App, { target });
}
