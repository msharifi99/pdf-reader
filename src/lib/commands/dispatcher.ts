import type { ContextStack } from './contexts';
import { commands as defaultCommands, contextStack as defaultStack, keymap as defaultKeymap } from './instances';
import type { Keymap } from './keymap';
import { normalizeEvent } from './keys';
import type { CommandRegistry } from './registry';

export interface DispatcherOptions {
  commands?: CommandRegistry;
  keymap?: Keymap;
  contextStack?: ContextStack;
}

interface TargetLike {
  addEventListener(type: string, fn: (e: any) => void, opts?: any): void;
  removeEventListener(type: string, fn: (e: any) => void, opts?: any): void;
}

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** Elements where typing characters edits text (or where arrows/typeahead belong to the control). */
export function isEditableTarget(t: any): boolean {
  if (!t || typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(t.type ?? '').toLowerCase());
  return !!t.isContentEditable;
}

/** Native controls that activate on bare Enter/Space: leave those keys to the browser (visible-focus keyboard nav). */
function isActivatable(t: any): boolean {
  if (!t || typeof t.tagName !== 'string') return false;
  const tag = t.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return true;
  if (tag === 'INPUT') return NON_TEXT_INPUTS.has(String(t.type ?? '').toLowerCase());
  const role = t.getAttribute?.('role');
  return role === 'button' || role === 'checkbox' || role === 'switch' || role === 'menuitem';
}

/**
 * Wire keydown -> keymap -> registry.execute. Returns an uninstaller.
 * - IME composition is never touched.
 * - preventDefault only when a binding handled (or swallowed as a pending prefix) the key.
 * - Auto-repeat only re-runs commands marked `repeatable`; repeats are swallowed while a prefix is pending.
 */
export function installKeyboard(target: TargetLike = window, o: DispatcherOptions = {}): () => void {
  const commands = o.commands ?? defaultCommands;
  const keymap = o.keymap ?? defaultKeymap;
  const stack = o.contextStack ?? defaultStack;

  const run = (id: string) => void commands.execute(id);

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const step = normalizeEvent(e);
    if (!step) return;
    if ((step === 'Enter' || step === 'Space') && isActivatable(e.target)) return;
    if (e.repeat && keymap.pending.length) {
      e.preventDefault();
      return;
    }
    const res = keymap.handle(step, {
      chain: stack.chain(),
      inInput: isEditableTarget(e.target),
      isRunnable: (id) => commands.isEnabled(id)
    });
    if (res.type === 'none' && !res.before) return;
    e.preventDefault();
    if (res.before) run(res.before.command);
    if (res.type === 'run') {
      if (e.repeat && !commands.isRepeatable(res.command)) return;
      run(res.command);
    }
  };

  const offFire = keymap.onFire((b) => run(b.command));
  const offStack = stack.subscribe(() => keymap.cancelPending());
  target.addEventListener('keydown', onKey as any, true);
  return () => {
    target.removeEventListener('keydown', onKey as any, true);
    offFire();
    offStack();
    keymap.cancelPending();
  };
}
