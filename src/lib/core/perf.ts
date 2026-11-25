import { core, coreMode } from './core';

const seen = new Set<string>();
/** One-shot timing mark: `performance.mark` always, plus a line in the Rust perf log (QUIRE_PERF=1 runs only record it). */
export function perfMark(name: string, at = performance.timeOrigin + performance.now()): void {
  if (seen.has(name)) return;
  seen.add(name);
  try {
    performance.mark(`quire:${name}`);
    if (coreMode() === 'tauri') void core.perfMark(name, at).catch(() => {});
  } catch {
    /* timing must never break the app */
  }
}

/** Mark after the next frame has painted. */
export const perfMarkAfterPaint = (name: string): void => void requestAnimationFrame(() => requestAnimationFrame(() => perfMark(name)));
