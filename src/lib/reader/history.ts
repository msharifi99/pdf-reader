/** Back/forward history of reading positions (link follows and jumps; story 45). Pure. */
import type { Locator } from '../engines/types';

const MAX = 100;

/** Two positions closer than this count as the same place (no history entry for a no-op jump). */
export function samePlace(a: Locator, b: Locator): boolean {
  if (a.kind === 'fixed' && b.kind === 'fixed') return a.page === b.page && Math.abs((a.y ?? 0) - (b.y ?? 0)) < 0.02;
  if (a.kind === 'reflow' && b.kind === 'reflow') return a.cfi === b.cfi || Math.abs(a.fraction - b.fraction) < 1e-4;
  return false;
}

export class History {
  back: Locator[] = [];
  forward: Locator[] = [];

  /** Remember `from` before jumping away from it. A new jump clears the forward stack. */
  push(from: Locator): void {
    const top = this.back[this.back.length - 1];
    if (!top || !samePlace(top, from)) this.back.push(from);
    if (this.back.length > MAX) this.back.shift();
    this.forward = [];
  }

  /** Where "back" goes, given where we are now; null when there's nothing behind. */
  goBack(current: Locator | null): Locator | null {
    const to = this.back.pop();
    if (!to) return null;
    if (current) this.forward.push(current);
    return to;
  }

  goForward(current: Locator | null): Locator | null {
    const to = this.forward.pop();
    if (!to) return null;
    if (current) this.back.push(current);
    return to;
  }
}
