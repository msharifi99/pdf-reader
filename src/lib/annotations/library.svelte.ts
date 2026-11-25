/**
 * Library-wide highlights (story 99): a full view inside the library, reachable from its
 * "Highlights" button and from the palette ("All highlights and notes").
 *
 *   import { allHighlights } from '../annotations/library.svelte';
 *   allHighlights.open  // LibraryView shows <HighlightsView /> instead of the shelves
 */
import { commands, type Command } from '../commands';
import { app, closeBook } from '../stores/app.svelte';
import { registerOverlay } from '../shell/overlays.svelte';

let unregister: (() => void) | null = null;

class AllHighlights {
  open = $state(false);
  show(): void {
    if (app.view !== 'library') closeBook();
    if (this.open) return;
    this.open = true;
    unregister = registerOverlay('highlights', () => this.hide()); // Esc goes back to the shelves
  }
  hide(): void {
    if (!this.open) return;
    this.open = false;
    unregister?.();
    unregister = null;
  }
}
export const allHighlights = new AllHighlights();

const cmd: Command = {
  id: 'annotate.allHighlights',
  title: 'All highlights and notes',
  category: 'Annotations',
  contexts: [],
  keywords: ['library', 'notes', 'quotes', 'search'],
  run: () => allHighlights.show(),
};
commands.register(cmd);
