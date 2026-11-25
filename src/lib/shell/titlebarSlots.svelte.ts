/**
 * Title bar slots for the current view. The reader (T8) puts its toolbar here:
 *
 *   import { setTitleBar } from '../shell/titlebarSlots.svelte';
 *   $effect(() => setTitleBar({ title: book.title, subtitle: chapter, trailing: toolbar }));  // returns its own reset
 *
 * `trailing` renders left of the caption buttons, `leading` after the back button.
 */
import type { Snippet } from 'svelte';

export interface TitleBarParts {
  title?: string;
  subtitle?: string;
  leading?: Snippet;
  trailing?: Snippet;
}

class TitleBarState {
  parts = $state.raw<TitleBarParts>({});
}

export const titleBar = new TitleBarState();

export function setTitleBar(parts: TitleBarParts): () => void {
  titleBar.parts = parts;
  return () => {
    if (titleBar.parts === parts) titleBar.parts = {};
  };
}
