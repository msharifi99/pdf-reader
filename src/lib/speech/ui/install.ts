/**
 * Boot hook for read-aloud and lookup (T13). Call once from main.ts after the core is up:
 * loads the saved voice/rate, mounts the per-book UI into the reader's overlay and bottom-bar slots,
 * and makes sure nothing keeps talking once the window goes away.
 */
import { createRawSnippet, mount, unmount, type Component } from 'svelte';
import { addBottomBarItem, addReaderOverlay } from '../../reader/slots.svelte';
import { speech } from '..';
import ReaderAddons from './ReaderAddons.svelte';
import ReadAloudButton from './ReadAloudButton.svelte';

const slot = (C: Component) =>
  createRawSnippet(() => ({
    render: () => '<span style="display:contents"></span>',
    setup(el: Element) {
      const c = mount(C, { target: el });
      return () => void unmount(c);
    },
  }));

export function installReadAloudAndLookup(): void {
  void speech.init();
  addReaderOverlay(slot(ReaderAddons));
  addBottomBarItem(slot(ReadAloudButton));
  window.addEventListener('pagehide', () => speech.stop());
}
