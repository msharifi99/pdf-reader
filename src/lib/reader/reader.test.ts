import { describe, expect, it, vi } from 'vitest';
import { History } from './history';
import { chapterIndexAt, chapterTicks, createProgressSaver, flattenToc, formatMinutes, timeLeft, timeLeftLabel } from './progress';
import type { Locator, TocEntry } from '../engines/types';

const page = (p: number, y = 0): Locator => ({ kind: 'fixed', page: p, y });
const toc: TocEntry[] = [
  { title: 'One', locator: page(0), children: [{ title: 'One.a', locator: page(2), children: [] }] },
  { title: 'Two', locator: page(5), children: [] },
  { title: 'Three', locator: page(8), children: [] },
];

describe('history', () => {
  it('goes back and forward, and a new jump clears forward', () => {
    const h = new History();
    h.push(page(1));
    h.push(page(5));
    expect(h.goBack(page(9))).toEqual(page(5));
    expect(h.goBack(page(5))).toEqual(page(1));
    expect(h.goBack(page(1))).toBeNull();
    expect(h.goForward(page(1))).toEqual(page(5));
    h.push(page(5));
    expect(h.forward).toEqual([]);
  });
  it('does not stack the same place twice', () => {
    const h = new History();
    h.push(page(3, 0.1));
    h.push(page(3, 0.105));
    expect(h.back).toHaveLength(1);
  });
});

describe('progress saver', () => {
  it('writes at most once per interval and flushes the latest position', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const s = createProgressSaver(save, 2000);
    s.update(page(1), 0.1);
    s.update(page(2), 0.2);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(page(2), 0.2);
    s.update(page(3), 0.3);
    await s.flush();
    expect(save).toHaveBeenLastCalledWith(page(3), 0.3);
    await s.flush();
    expect(save).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('toc and time left', () => {
  const flat = flattenToc(toc);
  it('flattens depth-first and finds the chapter at a position', () => {
    expect(flat.map((t) => t.entry.title)).toEqual(['One', 'One.a', 'Two', 'Three']);
    expect(chapterIndexAt(flat, page(3), 10)).toBe(1);
    expect(chapterIndexAt(flat, page(6), 10)).toBe(2);
    expect(chapterTicks(flat, 10)).toEqual([0.5, 0.8]);
  });
  it('estimates fixed layouts by pages and reflow by words', () => {
    const fixed = timeLeft({ progress: { fraction: 0.6, page: { index: 6, count: 10 }, chapter: { index: 2, title: 'Two' } }, locator: page(6), flat, wordsPerMinute: 250, minutesPerPage: 2 });
    expect(fixed).toEqual({ chapter: 4, book: 8 });
    const reflow = timeLeft({
      progress: { fraction: 0.5, chapter: { index: 0, title: 'x', fraction: 0.5, words: 5000 } },
      locator: { kind: 'reflow', cfi: 'epubcfi(/6/2)', fraction: 0.5 },
      flat: [],
      wordCount: 100000,
      wordsPerMinute: 250,
      minutesPerPage: 1,
    });
    expect(reflow).toEqual({ chapter: 10, book: 200 });
    expect(timeLeftLabel(reflow)).toBe('10 min left in chapter · 3 h 20 min left in book');
    expect(formatMinutes(0.4)).toBe('less than a minute');
  });
});
