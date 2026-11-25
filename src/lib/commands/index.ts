/**
 * Quire commands module: Command registry, contexts, Keymap, fuzzy palette search, keyboard dispatcher.
 *
 * REGISTER a command (ids/titles/categories come from commandIds.ts):
 *   import { commands, defineCommand } from '$lib/commands';
 *   const off = commands.register(defineCommand('reader.nextPage', () => engine.next(), () => !!engine));
 *   // dynamic: defineCommand(`theme.set:${id}`, run, undefined, { title: `Theme: ${name}`, category: 'Appearance' })
 *   // unregister with off() when the owning component/engine is destroyed.
 *
 * EXECUTE (buttons, menus, palette): `await commands.execute('reader.nextPage', args)`; never throws,
 *   resolves false when unknown/disabled/failed. Errors go to `commands.onError(fn)`.
 *
 * START KEYBOARD ONCE at boot:  `const stop = installKeyboard();`
 * CONTEXTS: `contextStack.setBase('library' | 'reader.fixed' | 'reader.reflow' | 'comic')` on navigation;
 *   `const pop = contextStack.push('dialog')` when an overlay opens (call pop() on close);
 *   push 'find' while the find bar is open.
 *
 * SHOW SHORTCUTS: `keyState.shortcut('reader.find')` (reactive, .svelte.ts) or `keymap.shortcutFor(id, contextStack.chain())`;
 *   cheat-sheet: `keymap.activeBindings(contextStack.stack)`; pending prefix: `keyState.pendingLabel` ("g …").
 *   Render key caps with `keyCaps(step)`.
 *
 * REBIND (shortcut editor): capture a step with `normalizeEvent(e)`, then
 *   `const c = keymap.findConflicts(ctx, seq, { command })`  -> if empty `keymap.bind(ctx, seq, cmd)`;
 *   else offer `keymap.swap(ctx, seq, cmd, oldSeq)` or cancel. `keymap.unbind`, `resetCommand(id)`, `resetAll()`.
 *   PERSIST the diff: `keymap.onChange(() => save(keymap.serialize()))`, restore with `keymap.load(saved)`.
 *
 * PALETTE: `parsePaletteQuery(input)` -> mode; `rankItems(commands.list(ctx), q, { fields: c => [c.title, c.category, ...(c.keywords ?? [])],
 *   recency: c => commands.recencyRank(c.id) })`.
 */
export * from './contexts';
export * from './keys';
export * from './registry';
export * from './commandIds';
export * from './keymap';
export { DEFAULT_BINDINGS } from './defaults';
export * from './fuzzy';
export * from './palette-modes';
export { installKeyboard, isEditableTarget, type DispatcherOptions } from './dispatcher';
export { commands, contextStack, keymap } from './instances';
export { registerUndoSource, type UndoSource, type UndoScope } from './undo';
export { commandsState, keyState } from './state.svelte';
