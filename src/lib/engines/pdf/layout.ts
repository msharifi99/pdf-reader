/** Pure layout and locator math for the virtualised page list (no DOM, unit-tested). */

/** PDF points -> CSS px at 100% zoom (pdf.js "actual size"). */
export const PDF_TO_CSS = 96 / 72;
/** Vertical space around each row, and horizontal space between the two pages of a spread. */
export const ROW_GAP = 12;
export const PAGE_GAP = 6;

export interface Size {
  w: number;
  h: number;
}

/** Group pages into rows: one page each, or spreads of two (optionally with page 1 alone, as in a book). */
export function buildRows(pageCount: number, spread: boolean, firstAlone: boolean): number[][] {
  const rows: number[][] = [];
  let i = 0;
  if (spread && firstAlone && pageCount > 0) rows.push([i++]);
  while (i < pageCount) {
    rows.push(spread && i + 1 < pageCount ? [i, i + 1] : [i]);
    i += spread ? 2 : 1;
  }
  return rows;
}

export interface Layout {
  rows: number[][];
  /** Top of each row, plus one trailing entry = total height. */
  tops: number[];
  /** Height of each row's box (includes gap, and fills the viewport when paginated). */
  heights: number[];
  /** Offset of the page content inside its row box. */
  contentTops: number[];
  /** Page height used for the row's primary page (locator y is relative to this). */
  pageHeights: number[];
  /** Widest row, CSS px. */
  width: number;
  rowOfPage: Int32Array;
}

/** `size(i)` is the page size at 100% zoom with view rotation applied. */
export function computeLayout(rows: number[][], size: (page: number) => Size, scale: number, opts: { viewportH: number; paginated: boolean }): Layout {
  const n = rows.length;
  const tops = new Array<number>(n + 1);
  const heights = new Array<number>(n);
  const contentTops = new Array<number>(n);
  const pageHeights = new Array<number>(n);
  let width = 0;
  let pageCount = 0;
  let y = 0;
  for (let r = 0; r < n; r++) {
    let h = 0;
    let w = 0;
    for (const p of rows[r]) {
      const s = size(p);
      h = Math.max(h, s.h * scale);
      w += s.w * scale;
      pageCount = Math.max(pageCount, p + 1);
    }
    w += (rows[r].length - 1) * PAGE_GAP;
    width = Math.max(width, w);
    const box = opts.paginated ? Math.max(h + ROW_GAP, opts.viewportH) : h + ROW_GAP;
    tops[r] = y;
    heights[r] = box;
    pageHeights[r] = h;
    contentTops[r] = opts.paginated ? (box - h) / 2 : ROW_GAP / 2;
    y += box;
  }
  tops[n] = y;
  const rowOfPage = new Int32Array(pageCount);
  rows.forEach((row, r) => row.forEach((p) => (rowOfPage[p] = r)));
  return { rows, tops, heights, contentTops, pageHeights, width, rowOfPage };
}

/** Index of the row containing `y` (clamped to the list). */
export function rowAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** First/last row intersecting [y0, y1]. */
export function visibleRows(tops: number[], y0: number, y1: number): [number, number] {
  return [rowAt(tops, y0), rowAt(tops, Math.max(y0, y1))];
}

/** scrollTop for "page `page`, `y` of the way down". y = 0 shows the row from its very top (gap included). */
export function scrollTopFor(l: Layout, page: number, y: number): number {
  const r = l.rowOfPage[Math.min(Math.max(page, 0), l.rowOfPage.length - 1)] ?? 0;
  if (!(y > 0)) return l.tops[r];
  return l.tops[r] + l.contentTops[r] + Math.min(y, 1) * l.pageHeights[r];
}

/** Inverse of `scrollTopFor`: the page at the top edge of the viewport and the fraction down it. */
export function locationAt(l: Layout, scrollTop: number): { page: number; y: number; row: number } {
  const row = rowAt(l.tops, Math.max(0, scrollTop) + 1); // +1: the browser rounds scrollTop, so a row top at 17391.4 reads back as 17391
  const page = l.rows[row]?.[0] ?? 0;
  const ph = l.pageHeights[row] || 1;
  const y = Math.min(1, Math.max(0, (scrollTop - l.tops[row] - l.contentTops[row]) / ph));
  return { page, y, row };
}

export type FitMode = 'width' | 'height' | 'page' | 'actual' | 'custom';

/** Zoom (1 = 100%) for a fit mode. `row` is the reference row's size at zoom 1; `pad` is the margin kept around it. */
export function fitZoom(mode: FitMode, viewport: Size, row: Size, pad: number, custom = 1): number {
  const aw = Math.max(0.01, (viewport.w - 2 * pad) / row.w);
  const ah = Math.max(0.01, (viewport.h - 2 * pad) / row.h);
  switch (mode) {
    case 'width':
      return aw;
    case 'height':
      return ah;
    case 'page':
      return Math.min(aw, ah);
    case 'actual':
      return 1;
    default:
      return custom;
  }
}

export const clampZoom = (z: number) => Math.min(8, Math.max(0.1, z));

/** Overall 0..1 progress for a fixed layout. */
export function fractionOf(page: number, y: number, count: number): number {
  return count <= 0 ? 0 : Math.min(1, (page + Math.min(1, Math.max(0, y))) / count);
}

/** Last entry (in document order) that starts at or before (page, y); -1 if none. */
export function chapterIndex(flat: { page: number; y: number }[], page: number, y: number): number {
  let best = -1;
  for (let i = 0; i < flat.length; i++) {
    const e = flat[i];
    if (e.page < page || (e.page === page && e.y <= y + 1e-6)) best = i;
  }
  return best;
}

/** Page-space (PDF points, origin top-left) rect -> percent box of the page, for resolution-independent overlays. */
export function pctBox(r: number[], pageW: number, pageH: number): { left: number; top: number; width: number; height: number } {
  return { left: (r[0] / pageW) * 100, top: (r[1] / pageH) * 100, width: (r[2] / pageW) * 100, height: (r[3] / pageH) * 100 };
}
