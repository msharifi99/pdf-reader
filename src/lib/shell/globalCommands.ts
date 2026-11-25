/** Commands the shell owns. Registered once at boot; theme.set:<id> re-registers when themes change. */
import { commands, defineCommand, type Command } from '../commands';
import { app, closeBook } from '../stores/app.svelte';
import { closeOverlay, closeTopLayer, openOverlay, shellOverlays, toggleOverlay } from './overlays.svelte';
import { openPalette } from './palette/providers.svelte';
import { allThemes, nextTheme, setTheme } from './theme.svelte';
import { pickAndOpen, toggleFullscreen } from './window.svelte';

export function registerGlobalCommands(): () => void {
  return commands.register([
    defineCommand('app.openPalette', () => {
      if (shellOverlays.palette) closeOverlay('palette');
      else openPalette();
    }),
    defineCommand('app.cheatSheet', () => toggleOverlay('cheatSheet')),
    defineCommand('app.settings', () => {
      closeOverlay('palette');
      closeOverlay('cheatSheet');
      openOverlay('settings');
    }),
    defineCommand('app.toggleFullscreen', () => toggleFullscreen()),
    defineCommand('app.openFile', () => pickAndOpen()),
    defineCommand('app.back', () => {
      if (closeTopLayer()) return;
      if (app.view === 'reader') closeBook();
    }),
    defineCommand('theme.next', () => nextTheme()),
  ]);
}

/** One `theme.set:<id>` per theme; call again (it replaces) when the custom theme list changes. */
export function registerThemeCommands(): () => void {
  const list: Command[] = allThemes().map((t) =>
    defineCommand(`theme.set:${t.id}`, () => setTheme(t.id), undefined, {
      title: `Theme: ${t.name}`,
      category: 'Appearance',
      keywords: [t.dark ? 'dark' : 'light', 'colour', 'theme'],
      icon: t.dark ? 'moon' : 'sun',
    }),
  );
  return commands.register(list);
}
