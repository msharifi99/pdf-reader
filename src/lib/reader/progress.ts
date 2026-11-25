/** Progress persistence and time-left estimates (stories 36, 77, 78). Pure, unit-tested. */
import type { Locator, Progress, TocEntry } from '../engines/types';

export interface ProgressSaver {
  /** Note a new position; it is written at most once per `interval` ms. */
  update(locator: Locator, fraction: number): void;
  /** Write the pending position now (close, blur, hide). */
  flush(): Promise<void>;
  /** The position not yet written, if any. */
  readonly pending: { locator: Locator; fraction: number } | null;
}

export function createProgressSaver(save: (locator: Locator, fraction: number) => Promise<unknown>, interval = 2000): ProgressSaver {
  let pending: { locator: Locator; fraction: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    clearTimeout(timer);
    timer = undefined;
    const p = pending;
    pending = null;
    if (!p) return;
    try {
      await save(p.locator, p.fraction);
    } catch (err) {
      console.warn('[reader] could not save progress', err);
    }
  };
  return {
    update(locator, fraction) {
      pending = { locator: structuredClone(locator), fraction };
      timer ??= setTimeout(() => void flush(), interval);
    },
    flush,
    get pending() {
      return pending;
    },
  };
}

export interface FlatToc {
  entry: TocEntry;
  depth: number;
  /** index in depth-first order (matches `ChapterInfo.index`) */
  index: number;
  parent: number;
}

export function flattenToc(toc: TocEntry[]): FlatToc[] {
  const out: FlatToc[] = [];
  const walk = (list: TocEntry[], depth: number, parent: number) => {
    for (const entry of list) {
      const index = out.length;
      out.push({ entry, depth, index, parent });
      walk(entry.children, depth + 1, index);
    }
  };
  walk(toc, 0, -1);
  return out;
}

/** 0..1 position of a locator in the whole book (fixed: by page). */
export function locatorFraction(l: Locator, pageCount = 1): number {
  return l.kind === 'reflow' ? l.fraction : (l.page + (l.y ?? 0)) / Math.max(1, pageCount);
}

/** Index of the flattened TOC entry containing `at` (the last one starting at or before it), or -1. */
export function chapterIndexAt(flat: FlatToc[], at: Locator, pageCount = 1): number {
  const f = locatorFraction(at, pageCount) + 1e-6;
  let best = -1;
  let bestStart = -Infinity;
  for (const t of flat) {
    const s = locatorFraction(t.entry.locator, pageCount);
    if (s <= f && s >= bestStart) {
      best = t.index;
      bestStart = s;
    }
  }
  return best;
}

/** Chapter boundaries (top-level TOC starts) as 0..1 ticks for the progress line. */
export function chapterTicks(flat: FlatToc[], pageCount = 1): number[] {
  const ticks = flat.filter((t) => t.depth === 0).map((t) => locatorFraction(t.entry.locator, pageCount));
  return [...new Set(ticks.map((t) => Math.round(t * 1000) / 1000))].filter((t) => t > 0.002 && t < 0.998);
}

export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min < 0) return '';
  if (min < 1) return 'less than a minute';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 || h >= 10 ? `${h} h` : `${h} h ${m} min`;
}

export interface TimeLeftInput {
  progress: Progress;
  locator: Locator;
  flat: FlatToc[];
  wordCount?: number;
  pageCount?: number;
  wordsPerMinute: number;
  minutesPerPage: number;
}

/** Minutes left in the chapter and in the book, from the reader's own speed. */
export function timeLeft(i: TimeLeftInput): { chapter: number | null; book: number | null } {
  const p = i.progress;
  if (i.locator.kind === 'reflow') {
    const words = i.wordCount ?? 0;
    if (!words || i.wordsPerMinute <= 0) return { chapter: null, book: null };
    const book = (words * (1 - p.fraction)) / i.wordsPerMinute;
    const ch = p.chapter;
    const chapter = ch?.words != null && ch.fraction != null ? (ch.words * (1 - ch.fraction)) / i.wordsPerMinute : null;
    return { chapter, book };
  }
  const count = p.page?.count ?? i.pageCount ?? 0;
  if (!count || i.minutesPerPage <= 0) return { chapter: null, book: null };
  const here = i.locator.page + (i.locator.y ?? 0);
  const book = Math.max(0, count - here) * i.minutesPerPage;
  const idx = p.chapter?.index ?? chapterIndexAt(i.flat, i.locator, count);
  let chapter: number | null = null;
  if (idx >= 0) {
    const here0 = i.locator.page;
    const next = i.flat.slice(idx + 1).find((t) => t.entry.locator.kind === 'fixed' && t.entry.locator.page > here0 && t.depth <= i.flat[idx]!.depth);
    const end = next && next.entry.locator.kind === 'fixed' ? next.entry.locator.page : count;
    chapter = Math.max(0, end - here) * i.minutesPerPage;
  }
  return { chapter, book };
}

/** "12 min left in chapter · 3 h 10 min left in book" (parts that are unknown are left out). */
export function timeLeftLabel(t: { chapter: number | null; book: number | null }): string {
  const parts: string[] = [];
  if (t.chapter != null) parts.push(`${formatMinutes(t.chapter)} left in chapter`);
  if (t.book != null) parts.push(`${formatMinutes(t.book)} left in book`);
  return parts.join(' · ');
}
