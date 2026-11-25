// Tiny toast store. `toast('Saved')`, `toast('Highlight removed', { action: { label: 'Undo', run } })`.
export type ToastKind = 'info' | 'success' | 'warning' | 'error';
export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  action?: { label: string; run: () => void };
  /** ms; 0 = sticky */
  duration: number;
}

let next = 1;
export const toasts: Toast[] = $state([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
  const t: Toast = { id: next++, message, kind: opts.kind ?? 'info', action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 3500) };
  toasts.push(t);
  if (toasts.length > 3) dismiss(toasts[0]!.id); // calm: never a wall of toasts
  schedule(t);
  return t.id;
}

function schedule(t: Toast) {
  if (t.duration > 0) timers.set(t.id, setTimeout(() => dismiss(t.id), t.duration));
}

export function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Pause auto-dismiss while hovered/focused (WCAG 2.2.1). */
export function hold(id: number) {
  clearTimeout(timers.get(id));
}
export function release(id: number) {
  const t = toasts.find((x) => x.id === id);
  if (t) schedule(t);
}
