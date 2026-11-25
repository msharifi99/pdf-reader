/**
 * Webtoon view: all pages stacked in one scroller at the viewport width. Only pages near the
 * viewport have a canvas (the rest are empty space of the right height), so the DOM stays bounded
 * for 1000-page strips. Unknown page sizes use an estimate and are corrected as pages decode, with
 * the reading position (page + fraction) held fixed so nothing jumps.
 */
import { clamp, pageAtY, stackLayout } from './layout';
import type { PageView, ViewHost } from './host';
import type { RelocatedEvent } from '../types';

const EST_ASPECT = 1.45;
/** How far beyond the viewport pages stay realized, in viewport heights. */
const BEHIND = 1.5;
const AHEAD = 2.5;

export class WebtoonView implements PageView {
  page = 0;
  private readonly scrollEl: HTMLElement;
  private readonly strip: HTMLElement;
  private heights: number[] = [];
  private tops: number[] = [];
  private width = 0;
  private realized = new Map<number, HTMLCanvasElement>();
  private raf = 0;
  private dead = false;
  private readonly onScroll = () => {
    if (!this.raf) this.raf = requestAnimationFrame(() => ((this.raf = 0), this.tick()));
  };

  constructor(
    private readonly host: ViewHost,
    root: HTMLElement,
    start: { page: number; y: number },
  ) {
    this.scrollEl = document.createElement('div');
    this.scrollEl.className = 'q-view q-webtoon';
    this.scrollEl.style.cssText = 'position:absolute;inset:0;overflow:auto;scrollbar-width:none;touch-action:none;overflow-anchor:none;';
    this.strip = document.createElement('div');
    this.strip.className = 'q-strip';
    this.strip.style.cssText = 'position:relative;margin:0 auto;';
    this.scrollEl.append(this.strip);
    root.append(this.scrollEl);
    this.scrollEl.addEventListener('scroll', this.onScroll, { passive: true });
    this.page = clamp(start.page, 0, host.count - 1);
    this.layout(true, { page: this.page, y: start.y });
    this.tick('initial');
  }

  private aspect(i: number): number {
    const d = this.host.dims(i);
    return d ? d.h / d.w : this.known || EST_ASPECT;
  }
  /** Mean aspect of pages seen so far: a better guess for unseen pages than a constant. */
  private known = 0;
  private learn(): void {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < this.host.count; i++) {
      const d = this.host.dims(i);
      if (d) (sum += d.h / d.w), n++;
    }
    this.known = n ? sum / n : 0;
  }

  private locate(): { page: number; y: number } {
    if (!this.tops.length) return { page: 0, y: 0 };
    const top = this.scrollEl.scrollTop;
    const i = pageAtY(this.tops, top);
    return { page: i, y: clamp((top - this.tops[i]!) / (this.heights[i] || 1), 0, 1) };
  }

  /** Recompute geometry; `anchor` (default: where we are now) keeps its screen position. */
  private layout(repaint: boolean, anchor: { page: number; y: number } = this.locate()): void {
    const s = this.host.settings();
    const k = s.fit === 'custom' ? clamp(s.zoom, 0.2, 5) : 1;
    this.learn();
    this.width = this.scrollEl.clientWidth * k;
    const L = stackLayout(Array.from({ length: this.host.count }, (_, i) => this.aspect(i)), this.width, s.gap);
    this.heights = L.heights;
    this.tops = L.tops;
    this.strip.style.width = `${this.width}px`;
    this.strip.style.height = `${L.total}px`;
    for (const [i, c] of this.realized) this.place(i, c, repaint);
    this.scrollEl.scrollTop = this.tops[anchor.page]! + anchor.y * this.heights[anchor.page]!;
    if (s.fit === 'custom') this.host.presentation({ zoom: k });
    else this.host.presentation({ zoom: 1 });
  }

  private place(i: number, c: HTMLCanvasElement, repaint: boolean): void {
    const b = c.parentElement!;
    b.style.top = `${this.tops[i]}px`;
    b.style.width = c.style.width = `${this.width}px`;
    b.style.height = c.style.height = `${this.heights[i]}px`;
    if (repaint) this.paintPage(i, c);
  }

  private paintPage(i: number, c: HTMLCanvasElement): void {
    const draw = (bm: ImageBitmap) => {
      if (this.dead || this.realized.get(i) !== c || bm.width === 0) return;
      this.host.painter.paint(c, bm, this.width, this.heights[i]!, this.host.settings().tint);
      c.dataset.rendered = 'true';
    };
    const hit = this.host.cached(i);
    if (hit && hit.width > 0) draw(hit);
    else void this.host.bitmaps([i]).then(([bm]) => bm && draw(bm));
  }

  private tick(reason: RelocatedEvent['reason'] = 'scroll'): void {
    if (this.dead || !this.tops.length) return;
    const vh = this.scrollEl.clientHeight;
    const top = this.scrollEl.scrollTop;
    const from = pageAtY(this.tops, Math.max(0, top - vh * BEHIND));
    const to = pageAtY(this.tops, top + vh * (1 + AHEAD));
    for (const [i, c] of this.realized) {
      if (i < from || i > to) {
        c.width = c.height = 0;
        c.parentElement?.remove();
        this.realized.delete(i);
      }
    }
    for (let i = from; i <= to; i++) {
      if (this.realized.has(i)) continue;
      const c = document.createElement('canvas');
      c.className = 'q-page';
      c.dataset.page = String(i);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `Page ${i + 1} of ${this.host.count}`);
      c.style.cssText = 'display:block;';
      const box = document.createElement('div');
      box.className = 'q-pg';
      box.dataset.page = String(i);
      box.style.cssText = 'position:absolute;left:0;container-type:size;';
      box.append(c);
      this.strip.append(box);
      this.realized.set(i, c);
      this.place(i, c, true);
      this.host.mounted(i, box);
    }
    const loc = this.locate();
    this.page = loc.page;
    this.host.relocated(loc.page, loc.y, reason);
  }

  async goTo(page: number, y: number, reason: RelocatedEvent['reason']): Promise<void> {
    page = clamp(Math.round(page), 0, this.host.count - 1);
    this.scrollEl.scrollTop = this.tops[page]! + clamp(y, 0, 1) * this.heights[page]!;
    this.tick(reason);
    await this.host.bitmaps([page]);
  }

  async next(): Promise<boolean> {
    const el = this.scrollEl;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return false;
    el.scrollTop += el.clientHeight * 0.9;
    this.tick('page-turn');
    return true;
  }

  async prev(): Promise<boolean> {
    const el = this.scrollEl;
    if (el.scrollTop <= 0) return false;
    el.scrollTop -= el.clientHeight * 0.9;
    this.tick('page-turn');
    return true;
  }

  scrollBy(dy: number): void {
    this.scrollEl.scrollTop += dy;
  }

  scroller(): HTMLElement {
    return this.scrollEl;
  }

  relayout(): void {
    this.layout(true);
    this.tick('resize');
    this.host.layoutChanged();
  }

  repaint(): void {
    for (const [i, c] of this.realized) this.paintPage(i, c);
  }

  onDims(): void {
    // Sizes only (pixels of other pages are unaffected); the anchor page keeps its place.
    this.layout(false);
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    const s = this.host.settings();
    const cur = s.fit === 'custom' ? s.zoom : 1;
    const next = clamp(cur * factor, 0.2, 5);
    if (next === cur) return;
    const rect = this.scrollEl.getBoundingClientRect();
    const px = cy - rect.top;
    const at = pageAtY(this.tops, this.scrollEl.scrollTop + px);
    const fy = (this.scrollEl.scrollTop + px - this.tops[at]!) / (this.heights[at] || 1);
    const fx = (this.scrollEl.scrollLeft + cx - rect.left) / (this.width || 1);
    this.host.presentation({ fit: 'custom', zoom: next });
    this.layout(true, { page: at, y: 0 });
    this.scrollEl.scrollTop = this.tops[at]! + fy * this.heights[at]! - px;
    this.scrollEl.scrollLeft = fx * this.width - (cx - rect.left);
    this.tick('presentation');
  }

  stats(): Record<string, number> {
    return { realized: this.realized.size, total: this.host.count, strip: this.strip.childElementCount };
  }

  dispose(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.scrollEl.removeEventListener('scroll', this.onScroll);
    for (const c of this.realized.values()) c.width = c.height = 0;
    this.realized.clear();
    this.scrollEl.remove();
  }
}
