/**
 * Extra buttons in the floating selection menu (T11 owns the menu; e.g. T13 adds Define).
 *
 *   import { addSelectionAction } from '../annotations/selection.svelte';
 *   const off = addSelectionAction({ id: 'lookup.define', label: 'Define', icon: 'dictionary',
 *     shortcut: 'D',                                   // optional, shown in the tooltip
 *     run: (sel) => showDefinition(sel.text, sel.rect) });
 *   // off() when your feature goes away (e.g. in the onMount cleanup of your reader overlay)
 *
 * `run` gets the current selection: `{ text, anchor, rects }` from the engine plus `rect`, the
 * selection's bounding box in viewport coordinates (for anchoring a popover). The menu hides
 * after `run` unless it returns `'keep'`. Actions appear after the built-in ones, in add order.
 */
import type { EngineSelection, Rect } from '../engines/types';
import type { IconName } from '../ui';

export interface SelectionAction {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  run(sel: EngineSelection & { rect: Rect | null }): void | 'keep' | Promise<void | 'keep'>;
}

class SelectionActions {
  list = $state.raw<SelectionAction[]>([]);
}
export const selectionActions = new SelectionActions();

export function addSelectionAction(a: SelectionAction): () => void {
  selectionActions.list = [...selectionActions.list.filter((x) => x.id !== a.id), a];
  return () => (selectionActions.list = selectionActions.list.filter((x) => x !== a));
}
