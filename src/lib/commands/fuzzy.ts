/**
 * fzf-style fuzzy scorer. Case-insensitive; an exact-case match of an uppercase pattern char earns a small bonus.
 * Bonuses: word boundary, camelCase hump, digit start, consecutive run, first pattern char (x2).
 * Space-separated terms must all match (AND). Returns matched indices for highlighting.
 */
export interface FuzzyResult {
  score: number;
  indices: number[];
}

const NEG = -1e9;
const MATCH = 16;
const BOUNDARY = 8;
const CAMEL = 7;
const DIGIT = 3;
const CONSEC = 4;
const CASE = 2;

let H = new Int32Array(1024);
let M = new Int32Array(1024);
let BONUS = new Int32Array(256);

function cls(c: number): number {
  if (c >= 97 && c <= 122) return 1; // a-z
  if (c >= 65 && c <= 90) return 2; // A-Z
  if (c >= 48 && c <= 57) return 3; // 0-9
  if (c > 127) return 1; // non-ASCII letters treated as lowercase letters
  return 0;
}

function fuzzyTerm(pRaw: string, p: string, text: string, lower: string): FuzzyResult | null {
  const m = p.length;
  const n = text.length;
  if (!m) return { score: 0, indices: [] };
  if (m > n) return null;

  // forward greedy: earliest possible start; backward greedy: latest possible end
  let pi = 0;
  let first = -1;
  for (let j = 0; j < n && pi < m; j++) if (lower[j] === p[pi]) { if (pi === 0) first = j; pi++; }
  if (pi < m) return null;
  pi = m - 1;
  let last = n;
  for (let j = n - 1; j >= 0 && pi >= 0; j--) if (lower[j] === p[pi]) { if (pi === m - 1) last = j; pi--; }

  const w = last - first + 1;
  if (H.length < m * w) { H = new Int32Array(m * w * 2); M = new Int32Array(m * w * 2); }
  if (BONUS.length < n) BONUS = new Int32Array(n * 2);
  let prev = 0;
  for (let j = 0; j < n; j++) {
    const c = cls(text.charCodeAt(j));
    BONUS[j] = c === 0 ? 0 : prev === 0 ? BOUNDARY : prev === 1 && c === 2 ? CAMEL : prev !== 3 && c === 3 ? DIGIT : 0;
    prev = c;
  }

  for (let i = 0; i < m; i++) {
    const pc = p[i];
    const caseSensitiveChar = pRaw[i] !== pc;
    for (let j = first; j <= last; j++) {
      const idx = i * w + (j - first);
      let ms = NEG;
      if (lower[j] === pc) {
        const bj = BONUS[j]!;
        const b = bj + (caseSensitiveChar && text[j] === pRaw[i] ? CASE : 0);
        if (i === 0) ms = MATCH + bj * 2 + (b - bj) - Math.min(j, 10);
        else if (j > first) {
          const ph = H[(i - 1) * w + (j - 1 - first)]!;
          const pm = M[(i - 1) * w + (j - 1 - first)]!;
          if (ph > NEG / 2) ms = ph + MATCH + b;
          if (pm > NEG / 2) ms = Math.max(ms, pm + MATCH + Math.max(b, CONSEC));
        }
      }
      M[idx] = ms;
      let h = ms;
      if (j > first) {
        const left = H[idx - 1]!;
        if (left > NEG / 2 && left - 1 > h) h = left - 1;
      }
      H[idx] = h;
    }
  }
  // best end position (no penalty for trailing text)
  let best = NEG;
  let end = -1;
  for (let j = first; j <= last; j++) {
    const v = M[(m - 1) * w + (j - first)]!;
    if (v > best) { best = v; end = j; }
  }
  if (best <= NEG / 2) return null;

  const indices: number[] = [];
  let i = m - 1;
  let j = end;
  while (i >= 0 && j >= first) {
    const idx = i * w + (j - first);
    if (M[idx] === H[idx] && M[idx]! > NEG / 2) { indices.push(j); i--; }
    j--;
  }
  if (i >= 0) return null; // defensive
  indices.reverse();
  return { score: best, indices };
}

/** Match `query` (space-separated terms, all required) against `text`. null if no match. */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return { score: 0, indices: [] };
  const lower = text.toLowerCase();
  const lo = lower.length === text.length ? lower : text;
  let score = 0;
  const all = new Set<number>();
  for (const t of terms) {
    const r = fuzzyTerm(t, t.toLowerCase(), text, lo);
    if (!r) return null;
    score += r.score;
    for (const i of r.indices) all.add(i);
  }
  return { score: score - text.length * 0.05, indices: [...all].sort((a, b) => a - b) };
}

export interface RankOptions<T> {
  /** searchable strings; the FIRST is primary (its indices are returned for highlighting), others are keywords/category */
  fields: (item: T) => string | readonly string[];
  /** 0 = most recently used, <0 / undefined = never */
  recency?: (item: T) => number | undefined;
  limit?: number;
}
export interface Ranked<T> {
  item: T;
  score: number;
  /** indices into the primary field, empty when matched via a secondary field */
  indices: number[];
}

const MRU_BONUS = 10;
const SECONDARY = 0.6;

/** Filter + rank. Empty query returns everything, most recently used first, otherwise original order. */
export function rankItems<T>(items: readonly T[], query: string, opts: RankOptions<T>): Ranked<T>[] {
  const rec = (it: T) => {
    const r = opts.recency?.(it);
    return r === undefined || r < 0 ? -1 : r;
  };
  const out: (Ranked<T> & { order: number })[] = [];
  const q = query.trim();
  for (let order = 0; order < items.length; order++) {
    const item = items[order] as T;
    const r = rec(item);
    if (!q) {
      out.push({ item, score: r >= 0 ? 1000 - r : 0, indices: [], order });
      continue;
    }
    const f = opts.fields(item);
    const fields = typeof f === 'string' ? [f] : f;
    let best: FuzzyResult | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < fields.length; k++) {
      const res = fuzzyMatch(q, fields[k]!);
      if (!res) continue;
      const s = k === 0 ? res.score : res.score * SECONDARY;
      if (s > bestScore) { bestScore = s; best = k === 0 ? res : { score: s, indices: [] }; }
    }
    if (!best) continue;
    out.push({ item, score: bestScore + (r >= 0 ? Math.max(0, MRU_BONUS - r) : 0), indices: best.indices, order });
  }
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  const res = opts.limit ? out.slice(0, opts.limit) : out;
  return res.map(({ item, score, indices }) => ({ item, score, indices }));
}
