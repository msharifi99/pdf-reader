/**
 * Re-anchoring (SPEC "Locators and anchors"). Engines already repair an anchor whose quote sits
 * near its old place (`anchorToRanges` -> `updated`). When that fails, the quote is searched for
 * across the book and the candidates are ranked here: exact quote first, then how well the text
 * around each hit matches the stored prefix/suffix, then closeness to the old locator.
 * An annotation nothing matches stays "orphaned": listed, never deleted.
 */
import type { Anchor, Engine } from '../engines/types';
import { position } from './model';

export interface Candidate {
  anchor: Anchor;
  /** text right before / after the hit, when the source knows it better than `anchor.quote` */
  before?: string;
  after?: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 similarity of two passages (whitespace and case insensitive). Long passages compare head and tail. */
export function similarity(a: string, b: string): number {
  let x = norm(a);
  let y = norm(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const cap = 160; // shortcut: bounded cost; long quotes compare their first and last 80 chars
  if (x.length > cap) x = x.slice(0, cap / 2) + x.slice(-cap / 2);
  if (y.length > cap) y = y.slice(0, cap / 2) + y.slice(-cap / 2);
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

const commonSuffix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

/** Score a candidate for `target`, or null when its text is not the quote. Higher is better. */
export function scoreCandidate(target: Anchor, c: Candidate, pageCount = 1): number | null {
  const sim = similarity(target.quote.exact, c.anchor.quote.exact);
  if (sim < 0.8) return null;
  const pre = norm(target.quote.prefix);
  const suf = norm(target.quote.suffix);
  const before = norm(c.before ?? c.anchor.quote.prefix);
  const after = norm(c.after ?? c.anchor.quote.suffix);
  const ctx = (pre ? commonSuffix(before, pre) / pre.length : 0) + (suf ? commonPrefix(after, suf) / suf.length : 0); // 0..2
  const dist = Math.abs(position(target.locator, pageCount) - position(c.anchor.locator, pageCount));
  return sim * 4 + ctx + (1 - Math.min(1, dist * 4)) * 0.75;
}

/** The best candidate for `target`, or null. */
export function bestCandidate(target: Anchor, cands: Candidate[], pageCount = 1): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const s = scoreCandidate(target, c, pageCount);
    if (s != null && s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  return best;
}

export type ReanchorResult = { status: 'ok' } | { status: 'repaired'; anchor: Anchor } | { status: 'orphaned' };

/** Resolve one stored anchor against the open book: ok, repaired (persist `anchor`), or orphaned. */
export async function reanchor(engine: Engine, anchor: Anchor, opts: { pageCount?: number; search?: boolean; signal?: AbortSignal } = {}): Promise<ReanchorResult> {
  if (!anchor.quote.exact.trim()) return { status: 'ok' }; // bookmarks and page marks: nothing to match
  const r = await engine.anchorToRanges(anchor).catch(() => null);
  if (r?.exact) return { status: 'ok' };
  if (r?.updated) return { status: 'repaired', anchor: r.updated };
  if (r) return { status: 'ok' };
  if (!opts.search) return { status: 'orphaned' };
  const cands: Candidate[] = [];
  try {
    for await (const hit of engine.search(anchor.quote.exact.replace(/\s+/g, ' ').trim(), { signal: opts.signal })) {
      cands.push({ anchor: hit.anchor, before: hit.excerpt.before, after: hit.excerpt.after });
      if (cands.length >= 50) break;
    }
  } catch {
    return { status: 'orphaned' };
  }
  const best = bestCandidate(anchor, cands, opts.pageCount);
  if (!best) return { status: 'orphaned' };
  // keep the stored context when the engine's search anchor carries none
  const q = best.anchor.quote;
  const fixed: Anchor = { ...best.anchor, quote: { exact: q.exact || anchor.quote.exact, prefix: q.prefix || best.before?.slice(-32) || '', suffix: q.suffix || best.after?.slice(0, 32) || '' } };
  return { status: 'repaired', anchor: fixed };
}
