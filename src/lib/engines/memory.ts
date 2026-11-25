const MB = 1024 * 1024;

/** A decoded-bitmap cache budget that follows the machine: `perGB` MB per GB of RAM (navigator.deviceMemory, max 8), within [min, max]. */
export function cacheBudget(maxMB: number, perGB: number, minMB = 64): number {
  const gb = (typeof navigator !== 'undefined' && (navigator as { deviceMemory?: number }).deviceMemory) || 4;
  return Math.max(minMB, Math.min(maxMB, gb * perGB)) * MB;
}

/** Runs `cb` whenever the window is hidden or minimised, so caches can shrink to what is on screen. Returns the unsubscribe. */
export function onHidden(cb: () => void): () => void {
  const f = () => document.visibilityState === 'hidden' && cb();
  document.addEventListener('visibilitychange', f);
  return () => document.removeEventListener('visibilitychange', f);
}

/** What a hidden window keeps cached. */
export const HIDDEN_KEEP = 32 * MB;
