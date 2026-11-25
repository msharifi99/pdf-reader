/**
 * Per-page text index built from pdf.js text content: the page string, where each text item sits in
 * it, and each item's box in page space (PDF points, origin top-left, y down). Search, anchors,
 * fuzzy re-anchoring and getText are all built on this; no DOM involved.
 */

export interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface IndexedItem {
  start: number;
  end: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageText {
  text: string;
  items: IndexedItem[];
}

export type Quad = number[]; // [x, y, width, height] in page space

const CTX = 32;

/** `view` is the page's [x0, y0, x1, y1] in PDF user space. */
export function buildPageText(raw: TextItemLike[], view: number[]): PageText {
  let text = '';
  const items: IndexedItem[] = [];
  let prevRight = NaN;
  let prevY = NaN;
  for (const it of raw) {
    const s = it.str.replace(/\s+/g, ' ');
    if (!s) {
      if (it.hasEOL && text && !text.endsWith(' ')) text += ' ';
      continue;
    }
    const [a, b, , d, e, f] = it.transform;
    const vertical = Math.abs(a) < Math.abs(b);
    const h = Math.abs(vertical ? a || it.height : d) || it.height || 1;
    const x = e - view[0];
    const yTop = view[3] - (f + 0.85 * h);
    // Insert a space between items on the same line that are visibly apart.
    if (text && !text.endsWith(' ') && !s.startsWith(' ')) {
      const sameLine = Math.abs(yTop - prevY) < h * 0.5;
      if (!sameLine || x - prevRight > h * 0.15) text += ' ';
    }
    const start = text.length;
    text += s;
    items.push(vertical ? { start, end: text.length, x: x - 0.85 * h, y: view[3] - f - it.width, w: h * 1.1, h: it.width } : { start, end: text.length, x, y: yTop, w: it.width, h: h * 1.1 });
    prevRight = x + it.width;
    prevY = yTop;
    if (it.hasEOL && !text.endsWith(' ')) text += ' ';
  }
  return { text, items };
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

export function normalizeQuery(q: string, caseSensitive: boolean): string {
  const s = q.replace(/\s+/g, ' ').trim();
  return caseSensitive ? s : s.toLowerCase();
}

/** All non-overlapping matches of `query` in `text`. `query` must come from `normalizeQuery`. */
export function findAll(text: string, query: string, opts: { caseSensitive?: boolean; wholeWord?: boolean } = {}): { start: number; end: number }[] {
  if (!query) return [];
  const hay = opts.caseSensitive ? text : text.toLowerCase();
  const out: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(query, from);
    if (i < 0) break;
    const end = i + query.length;
    if (!opts.wholeWord || (!isWordChar(text[i - 1]) && !isWordChar(text[end]))) out.push({ start: i, end });
    from = end;
  }
  return out;
}

/** Line-merged quads covering `[start, end)` of the page text. */
export function quadsFor(pt: PageText, start: number, end: number): Quad[] {
  const quads: Quad[] = [];
  for (const it of pt.items) {
    if (it.end <= start || it.start >= end) continue;
    const len = it.end - it.start;
    const f0 = Math.max(0, (start - it.start) / len);
    const f1 = Math.min(1, (end - it.start) / len);
    const q = [it.x + it.w * f0, it.y, it.w * (f1 - f0), it.h];
    const last = quads[quads.length - 1];
    if (last && Math.abs(last[1] - q[1]) < it.h * 0.4 && q[0] - (last[0] + last[2]) < it.h * 0.6 && q[0] >= last[0]) {
      const right = Math.max(last[0] + last[2], q[0] + q[2]);
      const top = Math.min(last[1], q[1]);
      last[3] = Math.max(last[1] + last[3], q[1] + q[3]) - top;
      last[1] = top;
      last[2] = right - last[0];
    } else quads.push(q);
  }
  return quads;
}

/** Character range whose items overlap the given quads (inverse of `quadsFor`, item-granular at the ends). */
export function rangeForQuads(pt: PageText, quads: Quad[]): { start: number; end: number } | null {
  let start = Infinity;
  let end = -1;
  for (const q of quads) {
    for (const it of pt.items) {
      const cx = q[0] + q[2] / 2;
      const cy = q[1] + q[3] / 2;
      if (cy < it.y - 1 || cy > it.y + it.h + 1) continue;
      if (q[0] + q[2] < it.x || q[0] > it.x + it.w) continue;
      const len = it.end - it.start;
      const f0 = Math.max(0, (q[0] - it.x) / (it.w || 1));
      const f1 = Math.min(1, (q[0] + q[2] - it.x) / (it.w || 1));
      void cx;
      start = Math.min(start, it.start + Math.round(f0 * len));
      end = Math.max(end, it.start + Math.round(f1 * len));
    }
  }
  return end > start && start !== Infinity ? { start, end } : null;
}

export function contextAround(text: string, start: number, end: number, n = CTX): { before: string; match: string; after: string } {
  return { before: text.slice(Math.max(0, start - n), start), match: text.slice(start, end), after: text.slice(end, end + n) };
}

export function makeQuote(text: string, start: number, end: number): { exact: string; prefix: string; suffix: string } {
  const c = contextAround(text, start, end);
  return { exact: c.match, prefix: c.before, suffix: c.after };
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
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

/**
 * Re-anchor a quote in `text`: exact occurrences are ranked by how well their surroundings match the
 * stored prefix/suffix; failing that, a similarity search around 8-char seeds of the quote (>= 75% similar).
 */
export function fuzzyFind(text: string, quote: { exact: string; prefix: string; suffix: string }): { start: number; end: number; exact: boolean } | null {
  const q = quote.exact.replace(/\s+/g, ' ').trim();
  if (!q) return null;
  const score = (s: number, e: number) => commonSuffix(text.slice(Math.max(0, s - CTX), s), quote.prefix) + commonPrefix(text.slice(e, e + CTX), quote.suffix);
  let best: { start: number; end: number; exact: boolean; score: number } | null = null;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    const sc = score(i, i + q.length);
    if (!best || sc > best.score) best = { start: i, end: i + q.length, exact: true, score: sc };
  }
  if (best) return best;
  const seedLen = Math.min(8, q.length);
  const seen = new Set<number>();
  let bestSim = 0.75;
  for (const off of [0, Math.max(0, (q.length >> 1) - 4), Math.max(0, q.length - seedLen)]) {
    const seed = q.slice(off, off + seedLen);
    for (let i = text.indexOf(seed); i >= 0; i = text.indexOf(seed, i + 1)) {
      const s0 = i - off;
      if (seen.has(s0)) continue;
      seen.add(s0);
      for (const delta of [0, -2, 2, -4, 4]) {
        const s = Math.max(0, s0 + delta);
        for (const len of [q.length, q.length - 2, q.length + 2]) {
          const w = text.slice(s, s + len);
          const sim = 1 - editDistance(q, w) / Math.max(q.length, w.length);
          const withCtx = sim + score(s, s + len) / (CTX * 40);
          if (sim >= 0.75 && withCtx > bestSim) {
            bestSim = withCtx;
            best = { start: s, end: s + w.length, exact: false, score: withCtx };
          }
        }
      }
    }
  }
  return best;
}

/** Split text into sentence-ish chunks no longer than `max` characters (breaking on sentence ends, then spaces). */
export function splitSentences(text: string, max: number): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*\s+|$)/g;
  let m: RegExpExecArray | null;
  let cur = '';
  let curStart = 0;
  const flush = () => {
    if (cur.trim()) out.push({ text: cur, start: curStart });
    cur = '';
  };
  while ((m = re.exec(text)) && m[0]) {
    let s = m[0];
    let pos = m.index;
    while (s.length > max) {
      let cut = s.lastIndexOf(' ', max);
      if (cut < max / 2) cut = max;
      flush();
      curStart = pos;
      cur = s.slice(0, cut);
      flush();
      s = s.slice(cut);
      pos += cut;
    }
    if (cur && cur.length + s.length > max) flush();
    if (!cur) curStart = pos;
    cur += s;
    if (/[.!?]["')\]]*\s*$/.test(cur) && cur.length > max / 2) flush();
  }
  flush();
  return out;
}
