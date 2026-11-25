import { describe, expect, it } from 'vitest';
import { buildRows, chapterIndex, computeLayout, fitZoom, fractionOf, locationAt, rowAt, scrollTopFor, ROW_GAP } from './layout';

const size = () => ({ w: 600, h: 800 });

describe('rows', () => {
  it('builds single, spread and spread-with-cover rows', () => {
    expect(buildRows(5, false, false)).toEqual([[0], [1], [2], [3], [4]]);
    expect(buildRows(5, true, false)).toEqual([[0, 1], [2, 3], [4]]);
    expect(buildRows(5, true, true)).toEqual([[0], [1, 2], [3, 4]]);
    expect(buildRows(0, true, true)).toEqual([]);
  });
});

describe('layout and locators', () => {
  const l = computeLayout(buildRows(100, false, false), size, 1, { viewportH: 900, paginated: false });
  it('stacks rows with a gap and reports total height', () => {
    expect(l.tops[1]).toBe(800 + ROW_GAP);
    expect(l.tops[100]).toBe(100 * (800 + ROW_GAP));
  });
  it('rowAt binary search', () => {
    expect(rowAt(l.tops, 0)).toBe(0);
    expect(rowAt(l.tops, l.tops[57] + 1)).toBe(57);
    expect(rowAt(l.tops, 1e9)).toBe(99);
  });
  it('scrollTopFor and locationAt round-trip exactly', () => {
    for (const [page, y] of [[0, 0], [5, 0.25], [42, 0.9], [99, 0.5]] as const) {
      const st = scrollTopFor(l, page, y);
      const loc = locationAt(l, st);
      expect(loc.page).toBe(page);
      expect(loc.y).toBeCloseTo(y, 9);
    }
  });
  it('paginated rows fill the viewport and centre the page', () => {
    const p = computeLayout(buildRows(3, false, false), () => ({ w: 300, h: 400 }), 1, { viewportH: 900, paginated: true });
    expect(p.heights[0]).toBe(900);
    expect(p.contentTops[0]).toBe(250);
  });
  it('spread rows use the taller page and the summed width', () => {
    const s = computeLayout(buildRows(4, true, false), (i) => ({ w: 100, h: 100 + i * 10 }), 2, { viewportH: 0, paginated: false });
    expect(s.pageHeights[0]).toBe(220);
    expect(s.width).toBe(2 * 100 * 2 + 6);
    expect(s.rowOfPage[3]).toBe(1);
  });
});

describe('fit, progress, chapters', () => {
  it('fits width, page and actual', () => {
    const vp = { w: 1000, h: 800 };
    const row = { w: 500, h: 1000 };
    expect(fitZoom('width', vp, row, 20)).toBeCloseTo(1.92);
    expect(fitZoom('page', vp, row, 20)).toBeCloseTo(0.76);
    expect(fitZoom('actual', vp, row, 20)).toBe(1);
    expect(fitZoom('custom', vp, row, 20, 2.5)).toBe(2.5);
  });
  it('fraction and chapterIndex', () => {
    expect(fractionOf(50, 0.5, 100)).toBeCloseTo(0.505);
    expect(fractionOf(99, 1, 100)).toBe(1);
    const flat = [{ page: 0, y: 0 }, { page: 4, y: 0 }, { page: 4, y: 0.5 }, { page: 9, y: 0 }];
    expect(chapterIndex(flat, 4, 0.2)).toBe(1);
    expect(chapterIndex(flat, 4, 0.5)).toBe(2);
    expect(chapterIndex(flat, 8, 0)).toBe(2);
  });
});
