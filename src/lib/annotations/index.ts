/**
 * Highlights, notes and bookmarks (T11). Importing this module once (src/main.ts) installs them:
 * the per-book reader overlay (store, commands, panel, floating menu, popover, ribbon, palette
 * picker) and the library-wide "All highlights and notes" command.
 *
 * For other features:
 *   addSelectionAction({ id, label, icon, run })   // a button in the selection menu (selection.svelte.ts)
 *   allHighlights.show() / .hide() / .open          // the library-wide view (LibraryView renders HighlightsView)
 *   globalThis.__QUIRE_ANNOTATIONS__                // fake mode: the open book's Annotator, for tests
 */
import { addReaderOverlay } from '../reader/slots.svelte';
import { annotationsOverlay } from './Mount.svelte';

addReaderOverlay(annotationsOverlay);

export { addSelectionAction, selectionActions, type SelectionAction } from './selection.svelte';
export { allHighlights } from './library.svelte';
export { default as HighlightsView } from './HighlightsView.svelte';
