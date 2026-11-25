import { keymap } from '../commands';
import { settings } from './settings.svelte';

/** Keep the live Keymap and the `keymap` setting in step, both ways (another window, a backup restore). */
export function bindKeymapToSettings(): () => void {
  let applying = false;
  keymap.load(settings.value.keymap);
  const offChange = keymap.onChange(() => {
    if (!applying) settings.set('keymap', keymap.serialize());
  });
  const offRemote = settings.onRemote((key) => {
    if (key !== null && key !== 'keymap') return;
    applying = true;
    try {
      keymap.load(settings.value.keymap);
    } finally {
      applying = false;
    }
  });
  return () => (offChange?.(), offRemote());
}
