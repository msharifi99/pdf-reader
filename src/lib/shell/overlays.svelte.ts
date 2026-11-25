/**
 * Shell overlays (palette, cheat-sheet, settings) in opening order. Each open overlay pushes the
 * 'dialog' key context; Esc (`app.back`) closes the top one first.
 *
 *   import { overlays, openOverlay, closeOverlay } from '../shell/overlays.svelte';
 *   openOverlay('settings'); overlays.top === 'settings'
 *   registerOverlay({ close }) -> unregister   // for other areas' own modal layers
 */
import { contextStack } from '../commands';

export type ShellOverlay = 'palette' | 'cheatSheet' | 'settings';

interface Entry {
  id: string;
  close: () => void;
  pop: () => void;
}

const stack = $state<Entry[]>([]);

export const overlays = {
  get stack(): readonly string[] {
    return stack.map((e) => e.id);
  },
  get top(): string | undefined {
    return stack[stack.length - 1]?.id;
  },
  get any(): boolean {
    return stack.length > 0;
  },
  isOpen(id: string): boolean {
    return stack.some((e) => e.id === id);
  },
};

/** Register an open modal layer. Returns the function to call when it closes by itself. */
export function registerOverlay(id: string, close: () => void): () => void {
  const pop = contextStack.push('dialog');
  const entry: Entry = { id, close, pop };
  stack.push(entry);
  return () => {
    const i = stack.findIndex((e) => e === entry || (e.id === entry.id && e.close === entry.close));
    if (i >= 0) stack.splice(i, 1);
    pop();
  };
}

const shellOpen = $state<Record<ShellOverlay, boolean>>({ palette: false, cheatSheet: false, settings: false });
const unreg = new Map<ShellOverlay, () => void>();

export const shellOverlays: Readonly<Record<ShellOverlay, boolean>> = shellOpen;

export function openOverlay(id: ShellOverlay): void {
  if (shellOpen[id]) return;
  shellOpen[id] = true;
  unreg.set(id, registerOverlay(id, () => closeOverlay(id)));
}

export function closeOverlay(id: ShellOverlay): void {
  if (!shellOpen[id]) return;
  shellOpen[id] = false;
  unreg.get(id)?.();
  unreg.delete(id);
}

export function toggleOverlay(id: ShellOverlay): void {
  if (shellOpen[id]) closeOverlay(id);
  else openOverlay(id);
}

/** Close the top-most layer: a light-dismiss popover/menu, a foreign <dialog>, then a shell overlay. */
export function closeTopLayer(): boolean {
  const pops = document.querySelectorAll<HTMLElement>('[popover]:popover-open');
  const menuLike = [...pops].filter((p) => p.getAttribute('popover') !== 'manual' && !p.matches('[role=tooltip]'));
  if (menuLike.length) {
    menuLike[menuLike.length - 1]!.hidePopover();
    return true;
  }
  // a ui <Dialog> opened by some feature (it is not in our stack)
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => !d.dataset.shellOverlay);
  if (dialogs.length) {
    const d = dialogs[dialogs.length - 1]!;
    const ev = new Event('cancel', { cancelable: true });
    if (d.dispatchEvent(ev)) d.close();
    return true;
  }
  const top = stack[stack.length - 1];
  if (top) {
    top.close();
    return true;
  }
  return false;
}
