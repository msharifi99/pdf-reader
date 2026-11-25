import { describe, expect, it, vi } from 'vitest';
import { COMMAND_TABLE, defineCommand } from './commandIds';
import { DEFAULT_BINDINGS } from './defaults';
import { Keymap } from './keymap';
import { CommandRegistry, type Command } from './registry';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const cmd = (id: string, run: Command['run'] = () => {}, extra: Partial<Command> = {}): Command => ({ id, title: id, category: 'T', contexts: [], run, ...extra });

describe('CommandRegistry', () => {
  it('register / unregister / list by context', () => {
    const r = new CommandRegistry({ storage: null });
    const off = r.register([cmd('a'), cmd('b', undefined, { contexts: ['reader'] }), cmd('c', undefined, { contexts: ['library'] }), cmd('h', undefined, { hidden: true })]);
    expect(r.list().map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(r.list('reader.fixed').map((c) => c.id)).toEqual(['a', 'b']); // inherits reader
    expect(r.list('library').map((c) => c.id)).toEqual(['a', 'c']);
    expect(r.list(undefined, { includeHidden: true })).toHaveLength(4);
    off();
    expect(r.list()).toHaveLength(0);
  });
  it('unregister does not remove a replacement registered later', () => {
    const r = new CommandRegistry({ storage: null });
    const off1 = r.register(cmd('a', () => 1));
    r.register(cmd('a', () => 2));
    off1();
    expect(r.has('a')).toBe(true);
  });
  it('execute: runs, passes args, returns true; unknown/disabled are false no-ops', async () => {
    const r = new CommandRegistry({ storage: null });
    const run = vi.fn();
    let on = false;
    r.register([cmd('a', run), cmd('d', run, { enabled: () => on })]);
    expect(await r.execute('a', { x: 1 })).toBe(true);
    expect(run).toHaveBeenCalledWith({ x: 1 });
    expect(await r.execute('nope')).toBe(false);
    expect(await r.execute('d')).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    on = true;
    expect(await r.execute('d')).toBe(true);
  });
  it('enabled receives app state from the provider', async () => {
    const r = new CommandRegistry({ storage: null, getState: () => ({ sel: true }) });
    r.register(cmd('a', () => {}, { enabled: (s) => (s as { sel: boolean }).sel }));
    expect(r.isEnabled('a')).toBe(true);
    r.setStateProvider(() => ({ sel: false }));
    expect(r.isEnabled('a')).toBe(false);
  });
  it('errors (sync, async, in enabled) are caught and surfaced, never thrown', async () => {
    const r = new CommandRegistry({ storage: null });
    const errs: unknown[] = [];
    r.onError((e) => errs.push(e));
    const events: boolean[] = [];
    r.onExecute((e) => events.push(e.ok));
    r.register([
      cmd('sync', () => { throw new Error('boom'); }),
      cmd('async', async () => { throw new Error('async boom'); }),
      cmd('en', () => {}, { enabled: () => { throw new Error('enabled boom'); } })
    ]);
    expect(await r.execute('sync')).toBe(false);
    expect(await r.execute('async')).toBe(false);
    expect(await r.execute('en')).toBe(false);
    expect(errs).toHaveLength(3);
    expect(events).toEqual([false, false]);
    expect(r.recent()).toEqual([]); // failures do not count as use
  });
  it('a throwing listener cannot break execute', async () => {
    const r = new CommandRegistry({ storage: null });
    r.onExecute(() => { throw new Error('listener'); });
    r.register(cmd('a'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await r.execute('a')).toBe(true);
    spy.mockRestore();
  });
  it('MRU: ordered, de-duplicated, capped, persisted, ignores unregistered', async () => {
    const st = mem();
    const r = new CommandRegistry({ storage: st, mruMax: 3 });
    r.register(['a', 'b', 'c', 'd'].map((id) => cmd(id)));
    for (const id of ['a', 'b', 'a', 'c', 'd']) await r.execute(id);
    expect(r.recent()).toEqual(['d', 'c', 'a']);
    expect(r.recencyRank('d')).toBe(0);
    expect(r.recencyRank('b')).toBe(-1);
    const r2 = new CommandRegistry({ storage: st, mruMax: 3 });
    r2.register([cmd('a'), cmd('d')]);
    expect(r2.recent()).toEqual(['d', 'a']);
    const bad = mem();
    bad.setItem('quire.commands.mru', '{not json');
    expect(new CommandRegistry({ storage: bad }).recent()).toEqual([]);
  });
  it('subscribe fires on register and use', async () => {
    const r = new CommandRegistry({ storage: null });
    const fn = vi.fn();
    r.subscribe(fn);
    r.register(cmd('a'));
    await r.execute('a');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('command table and defaults integrity', () => {
  const ids = new Set(COMMAND_TABLE.map((c) => c.id));
  it('ids are unique and cover the spec', () => {
    expect(ids.size).toBe(COMMAND_TABLE.length);
    for (const id of [
      'reader.nextPage', 'reader.prevPage', 'reader.goToStart', 'reader.goToEnd', 'reader.goTo', 'reader.toggleToc', 'reader.toggleThumbnails',
      'reader.toggleFlow', 'reader.toggleSpread', 'reader.zoomIn', 'reader.zoomOut', 'reader.zoomReset', 'reader.fitWidth', 'reader.fitPage',
      'reader.actualSize', 'reader.rotate', 'reader.find', 'reader.findNext', 'reader.findPrev', 'reader.historyBack', 'reader.historyForward',
      'reader.textBigger', 'reader.textSmaller', 'reader.toggleFocus', 'reader.toggleRuler', 'reader.toggleAutoScroll', 'reader.autoScrollFaster',
      'reader.autoScrollSlower', 'reader.readAloud', 'reader.pageTint.smart', 'reader.pageTint.invert', 'reader.pageTint.original',
      'annotate.highlightYellow', 'annotate.highlightGreen', 'annotate.highlightBlue', 'annotate.highlightPink', 'annotate.note', 'annotate.bookmark',
      'annotate.togglePanel', 'annotate.exportMarkdown', 'annotate.copyQuote', 'app.openPalette', 'app.openFile', 'app.switchBook', 'app.settings',
      'app.toggleFullscreen', 'app.cheatSheet', 'app.back', 'app.undo', 'app.redo', 'app.newWindow', 'theme.next'
    ])
      expect(ids.has(id), id).toBe(true);
  });
  it('every default binding references a known command and parses', () => {
    for (const d of DEFAULT_BINDINGS) expect(ids.has(d.command), d.command).toBe(true);
    expect(() => new Keymap(DEFAULT_BINDINGS)).not.toThrow();
  });
  it('no unintended same-context duplicate sequences in defaults', () => {
    const km = new Keymap(DEFAULT_BINDINGS);
    const seen = new Map<string, string>();
    for (const b of km.bindings) {
      const k = `${b.context}|${b.sequence}`;
      expect(seen.has(k), `${k} bound to ${seen.get(k)} and ${b.command}`).toBe(false);
      seen.set(k, b.command);
    }
  });
  it('no default prefix ambiguity except where intended', () => {
    const km = new Keymap(DEFAULT_BINDINGS);
    for (const b of km.bindings) {
      if (b.steps.length < 2) continue;
      const c = km.findConflicts(b.context, b.steps[0]!).filter((x) => x.kind === 'exact');
      expect(c, b.sequence).toEqual([]);
    }
  });
  it('defineCommand pulls metadata, rejects typos, allows dynamic theme ids', () => {
    const c = defineCommand('reader.toggleFocus', () => {});
    expect(c).toMatchObject({ title: 'Toggle focus mode', category: 'Reading', contexts: ['reader'] });
    expect(defineCommand('reader.nextPage', () => {}).repeatable).toBe(true);
    expect(() => defineCommand('reader.nextPgae', () => {})).toThrow();
    expect(defineCommand('theme.set:sepia', () => {}, undefined, { title: 'Theme: Sepia' }).title).toBe('Theme: Sepia');
  });
});
