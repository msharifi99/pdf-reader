import { contextStack, commands } from './instances';
import { defineCommand } from './commandIds';

/**
 * Ctrl+Z / Ctrl+Y are global. Each screen registers its own undo history here (the reader: annotations; the
 * library: removing a book) and the two commands act on whichever screen is showing.
 */
export interface UndoSource {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): unknown;
  redo(): unknown;
}
export type UndoScope = 'library' | 'reader';

const sources = new Map<UndoScope, UndoSource>();

export function registerUndoSource(scope: UndoScope, source: UndoSource): () => void {
  sources.set(scope, source);
  return () => {
    if (sources.get(scope) === source) sources.delete(scope);
  };
}

const active = (): UndoSource | undefined => sources.get(contextStack.stack[0] === 'library' ? 'library' : 'reader');

commands.register([
  defineCommand('app.undo', () => active()?.undo(), () => !!active()?.canUndo()),
  defineCommand('app.redo', () => active()?.redo(), () => !!active()?.canRedo()),
]);
