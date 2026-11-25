/** Single / double page view: one `.q-view` per shown spread, cross-faded on a page turn. */
import { buildSpreads, spreadAt } from './pairing';
import { MAX_SCALE, MIN_SCALE, clamp, layoutSpread, type SpreadLayout } from './layout';
import type { PageView, ViewHost } from './host';
import type { RelocatedEvent } from '../types';

interface Shown {
  el: HTMLElement;
  spread: HTMLElement;
  /** Logical page numbers, reading order. */
  pages: number[];
  canvases: HTMLCanvasElement[];
  boxes: HTMLElement[];
  rtl: boolean;
  layout: SpreadLayout | null;
}

export class PagedView implements PageView {
  page = 0;
  private cur: Shown | null = null;
  private token = 0;
  private dead = false;

  constructor(
    private readonly host: ViewHost,
    private readonly root: HTMLElement,
  ) {}

  private isDouble(): boolean {
    const s = this.host.settings().spread;
    return s === 'double' || (s === 'auto' && this.root.clientWidth >= this.root.clientHeight * 1.2);
  }
  private readonly isWide = (i: number): boolean => {
    const d = this.host.dims(i);
    return !!d && d.w > d.h;
  };
  private spreads(): number[][] {
    return buildSpreads(this.host.count, this.isWide, this.isDouble());
  }
  private known(i: number): boolean {
    return i >= this.host.count || !!this.host.dims(i);
  }

  async goTo(page: number, _y: number, reason: RelocatedEvent['reason']): Promise<void> {
    page = clamp(Math.round(page), 0, this.host.count - 1);
    const near = [page - 1, page, page + 1].filter((p) => p >= 0 && p < this.host.count && !this.host.dims(p));
    if (near.length) await this.host.bitmaps(near);
    if (this.dead) return;
    const pages = this.spreads().find((s) => s.includes(page)) ?? [page];
    await this.showPages(pages, reason, 0);
  }

  async next(): Promise<boolean> {
    const cur = this.cur;
    if (!cur) return false;
    const start = Math.max(...cur.pages) + 1;
    if (start >= this.host.count) return false;
    if (!this.known(start) || !this.known(start + 1)) await this.host.bitmaps([start, start + 1].filter((p) => p < this.host.count));
    if (this.dead) return false;
    await this.showPages(spreadAt(start, this.host.count, this.isWide, this.isDouble()), 'page-turn', 1);
    return true;
  }

  async prev(): Promise<boolean> {
    const cur = this.cur;
    if (!cur) return false;
    const end = Math.min(...cur.pages) - 1;
    if (end < 0) return false;
    const need = [end - 1, end].filter((p) => p >= 0 && !this.known(p));
    if (need.length) await this.host.bitmaps(need);
    if (this.dead) return false;
    await this.showPages(this.spreads().find((s) => s.includes(end)) ?? [end], 'page-turn', -1);
    return true;
  }

  scrollBy(dy: number): void {
    if (this.cur) this.cur.el.scrollTop += dy;
  }

  scroller(): HTMLElement | null {
    return this.cur?.el ?? null;
  }

  onDims(): void {}

  relayout(): void {
    const cur = this.cur;
    if (!cur) return;
    // Spread mode, viewport shape or direction may change which pages share the screen.
    const want = this.spreads().find((s) => s.includes(this.page)) ?? cur.pages;
    const rtl = this.host.settings().direction === 'rtl';
    if (want.join() !== cur.pages.join() || rtl !== cur.rtl) void this.showPages(want, 'presentation', 0);
    else this.fit(cur, true);
  }

  repaint(): void {
    if (this.cur) this.fit(this.cur, true);
  }

  zoomAt(factor: number, cx: number, cy: number): void {
    const cur = this.cur;
    if (!cur?.layout) return;
    const next = clamp(cur.layout.scale * factor, MIN_SCALE, MAX_SCALE);
    if (next === cur.layout.scale) return;
    const r = cur.spread.getBoundingClientRect();
    const fx = (cx - r.left) / r.width;
    const fy = (cy - r.top) / r.height;
    this.host.presentation({ fit: 'custom', zoom: next });
    this.fit(cur, true);
    const r2 = cur.spread.getBoundingClientRect();
    cur.el.scrollLeft += r2.left + fx * r2.width - cx;
    cur.el.scrollTop += r2.top + fy * r2.height - cy;
  }

  stats(): Record<string, number> {
    return { views: this.root.querySelectorAll('.q-view').length, spreads: this.spreads().length };
  }

  dispose(): void {
    this.dead = true;
    this.token++;
    this.root.querySelectorAll('.q-view').forEach((e) => e.remove());
    this.cur = null;
  }

  // -------------------------------------------------------------------------------------------

  private async showPages(pages: number[], reason: RelocatedEvent['reason'], dir: -1 | 0 | 1): Promise<void> {
    const t = ++this.token;
    let bms = pages.map((p) => this.host.cached(p));
    if (bms.some((b) => !b)) {
      const got = await this.host.bitmaps(pages);
      if (t !== this.token || this.dead) return;
      bms = got;
    }
    this.mount(pages, dir);
    this.page = Math.min(...pages);
    this.host.relocated(this.page, 0, reason);
    this.preload();
  }

  private preload(): void {
    const cur = this.cur;
    if (!cur) return;
    const hi = Math.max(...cur.pages);
    const lo = Math.min(...cur.pages);
    const want = [hi + 1, hi + 2, hi + 3, lo - 1].filter((p) => p >= 0 && p < this.host.count);
    this.host.preload(want);
  }

  private mount(pages: number[], dir: -1 | 0 | 1): void {
    const prev = this.cur;
    const rtl = this.host.settings().direction === 'rtl';
    const el = document.createElement('div');
    el.className = 'q-view';
    el.style.cssText = 'position:absolute;inset:0;overflow:auto;display:flex;scrollbar-width:none;touch-action:none;';
    const spread = document.createElement('div');
    spread.className = 'q-spread';
    // margin:auto centres small content and still lets large content scroll from its edge.
    spread.style.cssText = `flex:none;margin:auto;display:flex;flex-direction:${rtl ? 'row-reverse' : 'row'};`;
    const canvases = pages.map((p) => {
      const c = document.createElement('canvas');
      c.className = 'q-page';
      c.dataset.page = String(p);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `Page ${p + 1} of ${this.host.count}`);
      c.style.cssText = 'display:block;';
      return c;
    });
    const boxes = canvases.map((c) => {
      const b = document.createElement('div');
      b.className = 'q-pg';
      b.dataset.page = c.dataset.page;
      b.style.cssText = 'position:relative;flex:none;container-type:size;';
      b.append(c);
      spread.append(b);
      return b;
    });
    el.append(spread);
    const shown: Shown = { el, spread, pages, canvases, boxes, rtl, layout: null };
    this.root.append(el);
    this.fit(shown, true);
    boxes.forEach((b, i) => this.host.mounted(pages[i]!, b));
    if (rtl) el.scrollLeft = el.scrollWidth;

    this.root.querySelectorAll('.q-view').forEach((e) => e !== el && e !== prev?.el && e.remove());
    this.cur = shown;
    if (prev && prev.el.isConnected) {
      if (dir && !this.host.reduceMotion()) {
        const sign = (dir > 0 ? 1 : -1) * (rtl ? -1 : 1);
        const a = el.animate([{ opacity: 0, transform: `translateX(${sign * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 150, easing: 'ease-out' });
        const drop = () => prev.el.remove();
        a.onfinish = drop;
        a.oncancel = drop;
      } else prev.el.remove();
    }
  }

  /** Size the canvases for the current fit/zoom and (optionally) redraw them from cached bitmaps. */
  private fit(shown: Shown, paint: boolean): void {
    const s = this.host.settings();
    const sizes = shown.pages.map((p) => this.host.dims(p) ?? { w: 800, h: 1200 });
    const layout = layoutSpread(sizes, this.root.clientWidth, this.root.clientHeight, s.fit, s.zoom);
    shown.layout = layout;
    shown.spread.style.width = `${layout.width}px`;
    shown.spread.style.height = `${layout.height}px`;
    shown.el.style.cursor = layout.width > this.root.clientWidth + 1 || layout.height > this.root.clientHeight + 1 ? 'grab' : 'default';
    if (s.fit !== 'custom') this.host.presentation({ zoom: layout.scale });
    const draw = (bms: ImageBitmap[]) => {
      if (this.cur !== shown && shown.el.isConnected === false) return;
      shown.canvases.forEach((c, i) => {
        shown.boxes[i]!.style.width = `${layout.pages[i]!.w}px`;
        shown.boxes[i]!.style.height = `${layout.pages[i]!.h}px`;
        const bm = bms[i];
        if (bm && bm.width > 0) this.host.painter.paint(c, bm, layout.pages[i]!.w, layout.pages[i]!.h, s.tint, s.rotation);
        else {
          c.style.width = `${layout.pages[i]!.w}px`;
          c.style.height = `${layout.pages[i]!.h}px`;
        }
      });
    };
    if (!paint) return;
    const cached = shown.pages.map((p) => this.host.cached(p));
    if (cached.every((b) => b && b.width > 0)) draw(cached as ImageBitmap[]);
    else void this.host.bitmaps(shown.pages).then(draw);
    this.host.layoutChanged();
  }
}
