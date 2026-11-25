import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChain, ContextStack } from './contexts';
import { Keymap, type DefaultBinding } from './keymap';

const defs: DefaultBinding[] = [
  { context: 'global', keys: 'Ctrl+K', command: 'palette', allowInInput: true, inDialog: true },
  { context: 'global', keys: 'Escape', command: 'back', inDialog: true },
  { context: 'global', keys: 'x', command: 'global.x' },
  { context: 'reader', keys: ['Right', 'j'], command: 'next' },
  { context: 'reader', keys: ['Home', 'g g'], command: 'start' },
  { context: 'reader', keys: 'G', command: 'end' },
  { context: 'reader', keys: 'g', command: 'lone-g' }, // ambiguous prefix with `g g`
  { context: 'reader', keys: 'x', command: 'reader.x' },
  { context: 'reader.fixed', keys: 'Ctrl+Plus', command: 'zoomIn' },
  { context: 'reader.reflow', keys: 'Ctrl+Plus', command: 'textBigger' },
  { context: 'comic', keys: 'Right', command: 'comic.right' },
  { context: 'library', keys: 'Right', command: 'lib.right' },
  { context: 'library', keys: 'q', command: 'q' },
  { context: 'library', keys: 'z z', command: 'zz' },
  { context: 'find', keys: 'Enter', command: 'findNext', allowInInput: true },
  { context: 'dialog', keys: 'Enter', command: 'confirm' }
];
const chain = (...stack: Parameters<typeof buildChain>[0]) => buildChain(stack);

describe('Keymap matching', () => {
  let km: Keymap;
  beforeEach(() => {
    vi.useFakeTimers();
    km = new Keymap(defs);
  });
  afterEach(() => vi.useRealTimers());

  it('runs single keys and prefers the most specific context', () => {
    const r = km.handle('Right', { chain: chain('reader.fixed') });
    expect(r).toMatchObject({ type: 'run', command: 'next' });
    expect(km.handle('Right', { chain: chain('comic') })).toMatchObject({ type: 'run', command: 'comic.right' });
    expect(km.handle('Right', { chain: chain('library') })).toMatchObject({ type: 'run', command: 'lib.right' });
    expect(km.handle('x', { chain: chain('reader') })).toMatchObject({ command: 'reader.x' });
    expect(km.handle('x', { chain: chain('library') })).toMatchObject({ command: 'global.x' });
  });

  it('inherits: comic -> reader.fixed -> reader -> global', () => {
    expect(km.handle('Ctrl+Plus', { chain: chain('comic') })).toMatchObject({ command: 'zoomIn' });
    expect(km.handle('Ctrl+Plus', { chain: chain('reader.reflow') })).toMatchObject({ command: 'textBigger' });
    expect(km.handle('Ctrl+Plus', { chain: chain('library') })).toMatchObject({ type: 'none' });
    expect(km.handle('Ctrl+K', { chain: chain('comic') })).toMatchObject({ command: 'palette' });
  });

  it('G (Shift+G) runs immediately and is distinct from g', () => {
    expect(km.handle('Shift+G', { chain: chain('reader') })).toMatchObject({ type: 'run', command: 'end' });
  });

  it('sequence z z: pending then run; timeout clears and shows pending prefix', () => {
    const seen: string[][] = [];
    km.onPending((p) => seen.push(p));
    expect(km.handle('z', { chain: chain('library') })).toEqual({ type: 'pending', steps: ['z'] });
    expect(km.pending).toEqual(['z']);
    expect(km.pendingLabel).toBe('z …');
    expect(km.handle('z', { chain: chain('library') })).toMatchObject({ type: 'run', command: 'zz' });
    expect(km.pending).toEqual([]);

    km.handle('z', { chain: chain('library') });
    vi.advanceTimersByTime(1001);
    expect(km.pending).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
    // after timeout `z z` needs two fresh presses
    expect(km.handle('z', { chain: chain('library') })).toMatchObject({ type: 'pending' });
  });

  it('ambiguous prefix (g and g g): double press runs g g; timeout fires lone g', () => {
    const fired: string[] = [];
    km.onFire((b) => fired.push(b.command));
    const c = chain('reader');
    expect(km.handle('g', { chain: c }).type).toBe('pending');
    expect(km.handle('g', { chain: c })).toMatchObject({ type: 'run', command: 'start' });
    expect(fired).toEqual([]);

    km.handle('g', { chain: c });
    vi.advanceTimersByTime(999);
    expect(fired).toEqual([]);
    vi.advanceTimersByTime(2);
    expect(fired).toEqual(['lone-g']);
    expect(km.pending).toEqual([]);
  });

  it('ambiguous prefix + non-continuing key fires fallback first, then handles the key', () => {
    const c = chain('reader');
    km.handle('g', { chain: c });
    const r = km.handle('Right', { chain: c });
    expect(r).toMatchObject({ type: 'run', command: 'next', before: { command: 'lone-g' } });
  });

  it('broken prefix without fallback is discarded and the key re-processed', () => {
    const c = chain('library');
    km.handle('z', { chain: c });
    expect(km.handle('q', { chain: c })).toMatchObject({ type: 'run', command: 'q' });
    km.handle('z', { chain: c });
    expect(km.handle('y', { chain: c })).toEqual({ type: 'none' });
    expect(km.pending).toEqual([]);
  });

  it('Escape cancels a pending prefix without running anything', () => {
    const c = chain('library');
    km.handle('z', { chain: c });
    expect(km.handle('Escape', { chain: c })).toEqual({ type: 'cancel' });
    expect(km.pending).toEqual([]);
  });

  it('a more specific exact binding is not swallowed by a longer prefix in a parent context', () => {
    const k = new Keymap([
      { context: 'global', keys: 'g g', command: 'ggGlobal' },
      { context: 'library', keys: 'g', command: 'gLib' }
    ]);
    expect(k.handle('g', { chain: chain('library') })).toMatchObject({ type: 'run', command: 'gLib' });
    expect(k.handle('g', { chain: chain('reader') }).type).toBe('pending');
  });

  it('disabled/unrunnable commands fall through to less specific ones, and do not start prefixes', () => {
    const isRunnable = (id: string) => id !== 'reader.x' && id !== 'start';
    expect(km.handle('x', { chain: chain('reader'), isRunnable })).toMatchObject({ command: 'global.x' });
    // `g g` not runnable -> only lone g, which runs at once
    expect(km.handle('g', { chain: chain('reader'), isRunnable })).toMatchObject({ type: 'run', command: 'lone-g' });
    expect(km.handle('x', { chain: chain('reader'), isRunnable: () => false })).toEqual({ type: 'none' });
  });

  it('input fields: only allowInInput bindings fire', () => {
    expect(km.handle('j', { chain: chain('reader'), inInput: true })).toEqual({ type: 'none' });
    expect(km.handle('Ctrl+K', { chain: chain('reader'), inInput: true })).toMatchObject({ command: 'palette' });
    expect(km.handle('Escape', { chain: chain('reader'), inInput: true })).toMatchObject({ command: 'back' }); // inferred
    expect(km.handle('Enter', { chain: chain('reader', 'find'), inInput: true })).toMatchObject({ command: 'findNext' });
  });

  it('dialog shadows everything except inDialog globals', () => {
    const c = chain('reader.fixed', 'dialog');
    expect(c.restrictGlobal).toBe(true);
    expect(c.contexts).toEqual(['dialog', 'global']);
    expect(km.handle('j', { chain: c })).toEqual({ type: 'none' });
    expect(km.handle('x', { chain: c })).toEqual({ type: 'none' });
    expect(km.handle('Ctrl+K', { chain: c })).toMatchObject({ command: 'palette' });
    expect(km.handle('Enter', { chain: c })).toMatchObject({ command: 'confirm' });
  });

  it('find on top of reader keeps reader keys and adds find keys', () => {
    const c = chain('reader.reflow', 'find');
    expect(c.contexts).toEqual(['find', 'reader.reflow', 'reader', 'global']);
    expect(km.handle('Enter', { chain: c })).toMatchObject({ command: 'findNext' });
    expect(km.handle('Right', { chain: c })).toMatchObject({ command: 'next' });
  });

  it('multiple commands on one sequence are returned in order, first runnable wins', () => {
    const k = new Keymap([
      { context: 'reader', keys: '1', command: 'hl.yellow' },
      { context: 'reader', keys: '1', command: 'other' }
    ]);
    expect(k.handle('1', { chain: chain('reader'), isRunnable: (id) => id === 'other' })).toMatchObject({ command: 'other' });
  });
});

describe('ContextStack', () => {
  it('push/pop, out-of-order pop and base switching', () => {
    const s = new ContextStack('library');
    const fn = vi.fn();
    s.subscribe(fn);
    s.setBase('reader.reflow');
    const popFind = s.push('find');
    const popDlg = s.push('dialog');
    expect(s.stack).toEqual(['reader.reflow', 'find', 'dialog']);
    expect(s.top).toBe('dialog');
    popFind();
    expect(s.stack).toEqual(['reader.reflow', 'dialog']);
    popDlg();
    popDlg(); // idempotent
    s.pop();
    expect(s.stack).toEqual(['reader.reflow']);
    expect(fn).toHaveBeenCalled();
  });
});

describe('user overrides (diff)', () => {
  it('bind / unbind / multiple bindings and bindingsFor', () => {
    const km = new Keymap(defs);
    expect(km.bindingsFor('next').map((b) => b.sequence)).toEqual(['Right', 'j']);
    km.bind('reader', 'Ctrl+N', 'next');
    km.unbind('reader', 'j', 'next');
    expect(km.bindingsFor('next').map((b) => b.sequence)).toEqual(['Right', 'Ctrl+N']);
    expect(km.isModified('next')).toBe(true);
    expect(km.shortcutFor('next', chain('reader'))).toBe('→');
    expect(km.shortcutFor('missing')).toBeUndefined();
  });

  it('serialises as a diff and round-trips; defaults are not stored', () => {
    const a = new Keymap(defs);
    a.bind('reader', 'Ctrl+N', 'next');
    a.unbind('reader', 'j', 'next');
    const diff = a.serialize();
    expect(diff.added).toEqual([{ context: 'reader', keys: 'Ctrl+N', command: 'next' }]);
    expect(diff.removed).toEqual([{ context: 'reader', keys: 'j', command: 'next' }]);
    const b = new Keymap(defs);
    b.load(JSON.parse(JSON.stringify(diff)));
    expect(b.bindings.map((x) => `${x.context}|${x.sequence}|${x.command}`)).toEqual(a.bindings.map((x) => `${x.context}|${x.sequence}|${x.command}`));
  });

  it('new defaults appear after an update, removed defaults stay removed', () => {
    const v1 = new Keymap(defs);
    v1.unbind('reader', 'j', 'next');
    const saved = JSON.stringify(v1.serialize());
    const v2 = new Keymap([...defs, { context: 'reader', keys: 'Ctrl+J', command: 'newFeature' }]);
    v2.load(JSON.parse(saved));
    expect(v2.bindingsFor('newFeature')).toHaveLength(1);
    expect(v2.bindingsFor('next').map((b) => b.sequence)).toEqual(['Right']);
  });

  it('re-binding a removed default drops it from the diff; resetCommand/resetAll restore defaults', () => {
    const km = new Keymap(defs);
    km.unbind('reader', 'j', 'next');
    km.bind('reader', 'j', 'next');
    expect(km.serialize().removed).toEqual([]);
    km.unbind('reader', 'Right', 'next');
    km.bind('reader', 'Ctrl+N', 'next');
    km.bind('library', 'F9', 'q');
    km.resetCommand('next');
    expect(km.bindingsFor('next').map((b) => b.sequence)).toEqual(['Right', 'j']);
    expect(km.bindingsFor('q')).toHaveLength(2);
    km.resetAll();
    expect(km.serialize()).toEqual({ version: 1, added: [], removed: [] });
  });

  it('load tolerates garbage', () => {
    const km = new Keymap(defs);
    const n = km.bindings.length;
    km.load(null);
    km.load({ added: [{ context: 'nope', keys: 'a', command: 'x' }, { context: 'reader', keys: 'Bogus+', command: 'x' }, 7], removed: 'x' });
    expect(km.bindings).toHaveLength(n);
  });

  it('binding in input fields: inferred allowInInput, explicit override persisted', () => {
    const km = new Keymap(defs);
    km.bind('reader', 'Ctrl+N', 'a');
    km.bind('reader', 'm', 'b');
    km.bind('reader', 'F7', 'c');
    km.bind('reader', 'p', 'd', { allowInInput: true });
    const by = (id: string) => km.bindingsFor(id)[0]!.allowInInput;
    expect([by('a'), by('b'), by('c'), by('d')]).toEqual([true, false, true, true]);
    expect(km.serialize().added.find((x) => x.command === 'd')).toMatchObject({ allowInInput: true });
  });

  it('invalid sequences throw from bind', () => {
    expect(() => new Keymap(defs).bind('reader', 'Bogus+x', 'a')).toThrow();
  });
});

describe('conflicts', () => {
  const km = () => new Keymap(defs);
  it('exact conflicts include the inherited global context', () => {
    expect(km().findConflicts('reader', 'x')).toEqual([
      { kind: 'exact', context: 'reader', sequence: 'x', command: 'reader.x' },
      { kind: 'exact', context: 'global', sequence: 'x', command: 'global.x' }
    ]);
    expect(km().findConflicts('library', 'Ctrl+K')).toMatchObject([{ kind: 'exact', context: 'global', command: 'palette' }]);
  });
  it('sibling contexts do not conflict, descendants inherit', () => {
    expect(km().findConflicts('reader.reflow', 'Ctrl+Plus')).toMatchObject([{ context: 'reader.reflow', command: 'textBigger' }]);
    expect(km().findConflicts('library', 'j')).toEqual([]);
    expect(km().findConflicts('comic', 'j')).toMatchObject([{ context: 'reader', command: 'next' }]);
  });
  it('ignores the same command for exact matches', () => {
    expect(km().findConflicts('reader', 'Right', { command: 'next' })).toEqual([]);
  });
  it('prefix conflicts both ways', () => {
    const k = km();
    expect(k.findConflicts('library', 'z')).toEqual([{ kind: 'prefix', context: 'library', sequence: 'z z', command: 'zz' }]);
    expect(k.findConflicts('reader', 'g')).toEqual(
      expect.arrayContaining([
        { kind: 'prefix', context: 'reader', sequence: 'g g', command: 'start' },
        { kind: 'exact', context: 'reader', sequence: 'g', command: 'lone-g' }
      ])
    );
    expect(k.findConflicts('library', 'q q')).toEqual([{ kind: 'extends', context: 'library', sequence: 'q', command: 'q' }]);
  });
  it('invalid sequence has no conflicts', () => {
    expect(km().findConflicts('reader', 'Bogus+')).toEqual([]);
  });
  it('swap exchanges sequences between two commands', () => {
    const k = km();
    // give `end` the key `x` (held by reader.x), handing reader.x end's old sequence
    k.swap('reader', 'x', 'end', 'Shift+G');
    expect(k.bindingsFor('end').filter((b) => b.context === 'reader').map((b) => b.sequence)).toEqual(['x']);
    expect(k.bindingsFor('reader.x').map((b) => b.sequence)).toEqual(['Shift+G']);
    k.resetAll();
    expect(k.bindingsFor('reader.x').map((b) => b.sequence)).toEqual(['x']);
  });
});

describe('activeBindings', () => {
  it('lists winners only (shadowed global/reader bindings omitted)', () => {
    const km = new Keymap(defs);
    const active = km.activeBindings(['library']);
    const pairs = active.map((a) => `${a.sequence}=${a.command}`);
    expect(pairs).toContain('Right=lib.right');
    expect(pairs).not.toContain('Right=next');
    expect(pairs).toContain('Ctrl+K=palette');
    const reader = km.activeBindings(['reader']).map((a) => `${a.sequence}=${a.command}`);
    expect(reader).toContain('x=reader.x');
    expect(reader).not.toContain('x=global.x');
    const dlg = km.activeBindings(['reader', 'dialog']).map((a) => a.command);
    expect(dlg).toEqual(expect.arrayContaining(['confirm', 'palette', 'back']));
    expect(dlg).not.toContain('next');
    expect(dlg).not.toContain('global.x');
  });
});
