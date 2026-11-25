import type { Component } from 'svelte';

let loading: Promise<Component<{ bookId: string }>> | undefined;

/**
 * Everything only a book needs (reader view, annotations, read-aloud and lookup), loaded once. App.svelte calls it
 * when the library has gone idle, and again (a no-op by then) when a book opens, so the library's cold path
 * carries none of this. The overlays register before the reader view exists, as before.
 */
export function loadReader(): Promise<Component<{ bookId: string }>> {
  return (loading ??= (async () => {
    const [, install, view] = await Promise.all([import('../annotations'), import('../speech/ui/install'), import('./ReaderView.svelte')]);
    install.installReadAloudAndLookup();
    return view.default as Component<{ bookId: string }>;
  })());
}
