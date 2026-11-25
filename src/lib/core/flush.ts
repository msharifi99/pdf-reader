import { core, coreEvents } from './core';

/**
 * Everything that debounces a write (reading position, settings, annotation edits, pending removals) registers
 * here. When the core says the window is closing, all of it is written, then the core is told it may go ahead.
 */
const fns = new Set<() => unknown>();

export function onFlush(fn: () => unknown): () => void {
  fns.add(fn);
  return () => fns.delete(fn);
}

export async function flushAll(): Promise<void> {
  await Promise.allSettled([...fns].map((f) => Promise.resolve().then(f)));
}

export function installFlushOnClose(): void {
  void coreEvents
    .onFlushRequest(() => void flushAll().finally(() => core.flushDone().catch(() => {})))
    .catch((e) => console.warn('[flush] no close notifications', e));
}
