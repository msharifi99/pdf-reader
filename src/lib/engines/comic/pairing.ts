/**
 * Double-page pairing. Pages are logical (reading order) indices; right-to-left only flips how a
 * pair is drawn, never which pages pair up. Rules: the cover stands alone, a page wider than tall
 * is a spread and stands alone, and pairing restarts after it.
 */
/** The spread that starts at `start`: one page or a pair. */
export function spreadAt(start: number, count: number, isWide: (page: number) => boolean, double: boolean, coverAlone = true): number[] {
  const alone = !double || (coverAlone && start === 0) || isWide(start) || start + 1 >= count || isWide(start + 1);
  return alone ? [start] : [start, start + 1];
}

export function buildSpreads(count: number, isWide: (page: number) => boolean, double: boolean, coverAlone = true): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; ) {
    const s = spreadAt(i, count, isWide, double, coverAlone);
    out.push(s);
    i += s.length;
  }
  return out;
}

/** Index of the spread that contains `page` (clamped). */
export function spreadIndexOf(spreads: number[][], page: number): number {
  const i = spreads.findIndex((s) => s.includes(page));
  return i >= 0 ? i : page < 0 ? 0 : Math.max(0, spreads.length - 1);
}
