import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextStack } from './contexts';
import { installKeyboard } from './dispatcher';
import { Keymap, type DefaultBinding } from './keymap';
import { CommandRegistry } from './registry';

const defs: DefaultBinding[] = [
  { context: 'global', keys: 'Ctrl+K', command: 'palette', allowInInput: true },
  { context: 'reader', keys: 'j', command: 'down' },
  { context: 'reader', keys: 'f', command: 'focus' },
  { context: 'reader', keys: 'Space', command: 'page' },
  { context: 'reader', keys: ['Home', 'g g'], command: 'start' },
  { context: 'reader', keys: 'g', command: 'lone-g' },
  { context: 'reader', keys: '1', command: 'hl', allowInInput: false }
];

function setup() {
  const listeners: Record<string, (e: any) => void> = {};
  const target = {
    addEventListener: (t: string, fn: any) => (listeners[t] = fn),
    removeEventListener: (t: string) => delete listeners[t]
  };
  const reg = new CommandRegistry({ storage: null });
  const calls: string[] = [];
  const mk = (id: string, extra: object = {}) => ({ id, title: id, category: 'T', contexts: [], run: () => void calls.push(id), ...extra });
  reg.register([mk('palette'), mk('down', { repeatable: true }), mk('focus'), mk('page'), mk('start'), mk('lone-g'), mk('hl', { enabled: () => false })]);
  const km = new Keymap(defs);
  const stack = new ContextStack('reader.fixed');
  const stop = installKeyboard(target, { commands: reg, keymap: km, contextStack: stack });
  const press = (key: string, o: Record<string, unknown> = {}) => {
    const e = { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false, defaultPrevented: false, target: { tagName: 'DIV' }, preventDefault: vi.fn(), ...o };
    listeners.keydown?.(e);
    return e;
  };
  const flush = () => new Promise<void>((r) => queueMicrotask(r));
  return { listeners, stop, press, calls, stack, km, flush };
}

describe('installKeyboard', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs commands and preventDefaults only when handled', async () => {
    const s = setup();
    const handled = s.press('j');
    const unhandled = s.press('q');
    await s.flush();
    expect(s.calls).toEqual(['down']);
    expect(handled.preventDefault).toHaveBeenCalled();
    expect(unhandled.preventDefault).not.toHaveBeenCalled();
  });
  it('disabled commands are not handled (key falls through to the browser)', async () => {
    const s = setup();
    const e = s.press('1');
    await s.flush();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(s.calls).toEqual([]);
  });
  it('ignores IME composition and already-prevented events', async () => {
    const s = setup();
    s.press('j', { isComposing: true });
    s.press('j', { keyCode: 229 });
    s.press('j', { defaultPrevented: true });
    await s.flush();
    expect(s.calls).toEqual([]);
  });
  it('suppresses plain keys while typing but not allowInInput ones', async () => {
    const s = setup();
    const input = { tagName: 'INPUT', type: 'text' };
    const e1 = s.press('j', { target: input });
    s.press('k', { target: input });
    const e2 = s.press('k', { target: input, ctrlKey: true });
    s.press('K', { target: { tagName: 'DIV', isContentEditable: true }, ctrlKey: true });
    s.press('j', { target: { tagName: 'TEXTAREA' } });
    s.press('j', { target: { tagName: 'DIV', isContentEditable: true } });
    await s.flush();
    expect(e1.preventDefault).not.toHaveBeenCalled();
    expect(e2.preventDefault).toHaveBeenCalled();
    expect(s.calls).toEqual(['palette', 'palette']);
    // checkboxes are not text fields
    s.press('j', { target: { tagName: 'INPUT', type: 'checkbox' } });
    await s.flush();
    expect(s.calls.at(-1)).toBe('down');
  });
  it('leaves Enter/Space to focused buttons and links', async () => {
    const s = setup();
    const e = s.press(' ', { target: { tagName: 'BUTTON' } });
    s.press(' ', { target: { tagName: 'DIV', getAttribute: () => 'button' } });
    s.press(' ');
    await s.flush();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(s.calls).toEqual(['page']);
  });
  it('repeat: only repeatable commands re-run, but repeats are still swallowed', async () => {
    const s = setup();
    s.press('f');
    const rep = s.press('f', { repeat: true });
    s.press('j');
    s.press('j', { repeat: true });
    s.press('j', { repeat: true });
    await s.flush();
    expect(s.calls).toEqual(['focus', 'down', 'down', 'down']);
    expect(rep.preventDefault).toHaveBeenCalled();
  });
  it('held `g` does not complete `g g` via auto-repeat', async () => {
    const s = setup();
    s.press('g');
    s.press('g', { repeat: true });
    await s.flush();
    expect(s.calls).toEqual([]);
    vi.advanceTimersByTime(1100);
    await s.flush();
    expect(s.calls).toEqual(['lone-g']);
  });
  it('sequences: g g runs start; lone g fires after timeout; prefix state visible', async () => {
    const s = setup();
    s.press('g');
    expect(s.km.pendingLabel).toBe('g …');
    s.press('g');
    await s.flush();
    expect(s.calls).toEqual(['start']);
    s.press('g');
    vi.advanceTimersByTime(1001);
    await s.flush();
    expect(s.calls).toEqual(['start', 'lone-g']);
  });
  it('context change cancels a pending sequence; dialog blocks reader keys', async () => {
    const s = setup();
    s.press('g');
    const pop = s.stack.push('dialog');
    expect(s.km.pending).toEqual([]);
    vi.advanceTimersByTime(2000);
    s.press('j');
    await s.flush();
    expect(s.calls).toEqual([]);
    pop();
    s.press('j');
    await s.flush();
    expect(s.calls).toEqual(['down']);
  });
  it('a failing command never throws into the key handler', async () => {
    const listeners: Record<string, (e: any) => void> = {};
    const reg = new CommandRegistry({ storage: null });
    reg.onError(() => {});
    reg.register({ id: 'down', title: 'd', category: 'T', contexts: [], run: () => { throw new Error('x'); } });
    installKeyboard({ addEventListener: (t, f) => (listeners[t] = f), removeEventListener() {} }, { commands: reg, keymap: new Keymap(defs), contextStack: new ContextStack('reader') });
    expect(() => listeners.keydown!({ key: 'j', repeat: false, target: {}, preventDefault() {} })).not.toThrow();
  });
  it('uninstall removes the listener', async () => {
    const s = setup();
    s.stop();
    expect(s.listeners.keydown).toBeUndefined();
  });
});
