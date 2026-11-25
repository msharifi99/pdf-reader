/**
 * Annotations for the open book: the store plus every action the menu, popover, ribbon, panel,
 * commands and palette share. One instance per open book (created by Annotations.svelte).
 */
import { isTauri } from '../core/core';
import type { Anchor, Decoration, Locator, Rect } from '../engines/types';
import type { ReaderSession } from '../reader/session.svelte';
import { readerApi } from '../reader/slots.svelte';
import { chapterIndexAt } from '../reader/progress';
import { toast } from '../ui';
import { exportFileName, formatQuote, toMarkdown, type Placed } from './markdown';
import { colorIndex, highlightColors, isMark, position, whereLabel, type Ann, type HighlightColor } from './model';
import { reanchor } from './reanchor';
import { AnnotationStore } from './store.svelte';

export interface PopoverState {
  id: string;
  /** viewport coordinates of the highlight */
  rect: Rect;
  editing: boolean;
}

const sameText = (a: Anchor, b: Anchor) => a.quote.exact.trim() === b.quote.exact.trim() && JSON.stringify(a.locator) === JSON.stringify(b.locator);

export class Annotator {
  readonly store: AnnotationStore;
  popover = $state<PopoverState | null>(null);
  /** panel: the annotation whose note is being edited inline */
  editing = $state<string | null>(null);
  lastColor = $state<HighlightColor>('yellow');
  /** ids whose anchor the engine resolved after open (see decorations()) */
  verified = $state.raw<ReadonlySet<string>>(new Set());
  #abort = new AbortController();

  constructor(readonly session: ReaderSession) {
    this.store = new AnnotationStore(session.book.id, (a) => position(a.locator, this.pageCount));
  }

  get pageCount(): number {
    return this.session.handle?.pageCount ?? 1;
  }
  get title(): string {
    return this.session.handle?.metadata.title || this.session.book.title;
  }
  get author(): string {
    return this.session.handle?.metadata.authors.join(', ') ?? '';
  }

  dispose(): void {
    this.#abort.abort();
  }

  // ---- where things are ---------------------------------------------------------------------

  chapter(l: Locator): string {
    const i = chapterIndexAt(this.session.flat, l, this.pageCount);
    return i >= 0 ? (this.session.flat[i]?.entry.title ?? '') : '';
  }
  where(l: Locator): string {
    return whereLabel(l, this.session.handle?.pageLabels);
  }
  /** citation reference: the page for fixed layouts, else the chapter */
  ref(l: Locator): string {
    return l.kind === 'fixed' ? this.where(l) : this.chapter(l) || this.where(l);
  }
  placed(items: Ann[] = this.store.items): Placed[] {
    return items.map((ann) => ({ ann, chapter: this.chapter(ann.anchor.locator), where: this.where(ann.anchor.locator) }));
  }

  /** viewport rect for a rect in render-target space */
  toViewport(r: Rect): Rect {
    const s = readerApi.stage?.getBoundingClientRect();
    return s ? { x: r.x + s.left, y: r.y + s.top, width: r.width, height: r.height } : r;
  }

  decorations(): Decoration[] {
    // longest first, so a short highlight inside a long one is drawn on top and stays clickable
    // shortcut: the PDF engine re-resolves an anchor it cannot place (no quads, quote not on the page or
    // its neighbours) in an endless microtask loop that freezes the page, so quad-less anchors are only
    // drawn once re-anchoring has resolved them. Drop this filter once the engine caches the miss.
    return this.store.items
      .filter((a) => isMark(a) && !this.store.orphans.has(a.id) && (!!a.anchor.pdfQuads?.length || !!a.anchor.cfiRange || this.verified.has(a.id)))
      .sort((a, b) => b.anchor.quote.exact.length - a.anchor.quote.exact.length)
      .map((a) => ({ id: a.id, anchor: a.anchor, style: { type: a.note ? 'note' : 'highlight', color: colorIndex(a.color) } }));
  }

  // ---- highlights and notes ------------------------------------------------------------------

  /** Highlight the selection (recolours an identical highlight instead of stacking a second one). */
  highlight(color: HighlightColor, opts: { note?: boolean } = {}): Ann | null {
    const sel = this.session.selection;
    if (!sel) return null;
    this.lastColor = color;
    const anchor = $state.snapshot(sel.anchor) as Anchor;
    const rect = readerApi.selectionRect();
    const same = this.store.items.find((a) => isMark(a) && sameText(a.anchor, anchor));
    let a: Ann;
    if (same) {
      if (same.color !== color) this.store.update(same.id, { color });
      a = same;
    } else {
      a = this.store.create({ type: 'highlight', color, anchor });
    }
    this.session.engine?.clearSelection();
    window.getSelection()?.removeAllRanges();
    if (opts.note && rect) this.popover = { id: a.id, rect, editing: true };
    return a;
  }

  /** N: a highlight plus a note for the selection, or edit the note of the open popover. */
  note(): void {
    if (this.session.selection) {
      this.highlight(this.lastColor, { note: true });
    } else if (this.popover) {
      this.popover = { ...this.popover, editing: true };
    }
  }

  setNote(id: string, text: string): void {
    const a = this.store.get(id);
    if (!a) return;
    const note = text.trim() ? text.replace(/\s+$/, '') : null;
    this.store.update(id, a.type === 'bookmark' ? { note } : { note, type: note ? 'note' : 'highlight' });
  }

  recolor(id: string, color: HighlightColor): void {
    this.lastColor = color;
    this.store.update(id, { color });
  }

  remove(id: string): void {
    const a = this.store.remove(id);
    if (this.popover?.id === id) this.popover = null;
    if (!a) return;
    toast(a.type === 'bookmark' ? 'Bookmark removed' : a.note ? 'Note removed' : 'Highlight removed', { action: { label: 'Undo', run: () => this.store.undo() } });
  }

  undo(): void {
    this.popover = null;
    this.store.undo();
  }
  redo(): void {
    this.popover = null;
    this.store.redo();
  }

  openPopover(id: string, rect: Rect, editing = false): void {
    this.popover = { id, rect, editing };
  }

  /** PDF clicks (no decorationclick there): the smallest highlight under the point, or null. */
  async hitTest(x: number, y: number): Promise<{ id: string; rect: Rect } | null> {
    const e = this.session.engine;
    const here = this.session.location?.locator;
    if (!e || here?.kind !== 'fixed') return null;
    let best: { id: string; rect: Rect; area: number } | null = null;
    for (const a of this.store.items) {
      const l = a.anchor.locator;
      if (!isMark(a) || l.kind !== 'fixed' || l.page < here.page - 1 || l.page > here.page + 2) continue;
      const r = await e.anchorToRanges(a.anchor).catch(() => null);
      const rects = r?.regions.flatMap((g) => g.rects) ?? [];
      const hit = rects.find((q) => x >= q.x - 1 && x <= q.x + q.width + 1 && y >= q.y - 1 && y <= q.y + q.height + 1);
      if (!hit) continue;
      const area = rects.reduce((s, q) => s + q.width * q.height, 0);
      if (!best || area < best.area) best = { id: a.id, rect: hit, area };
    }
    return best;
  }

  // ---- bookmarks -----------------------------------------------------------------------------

  /** The bookmark at the current position, if any. */
  get here(): Ann | undefined {
    const loc = this.session.location;
    if (!loc) return undefined;
    const l = loc.locator;
    return this.store.items.find((a) => {
      if (a.type !== 'bookmark') return false;
      const b = a.anchor.locator;
      if (l.kind === 'fixed' && b.kind === 'fixed') return b.page === l.page;
      if (l.kind === 'reflow' && b.kind === 'reflow') return b.cfi === l.cfi || Math.abs(b.fraction - l.fraction) < 0.0015;
      return false;
    });
  }

  async toggleBookmark(): Promise<void> {
    const cur = this.here;
    if (cur) return this.remove(cur.id);
    const loc = this.session.location;
    if (!loc) return;
    const locator = $state.snapshot(loc.locator) as Locator;
    const a = this.store.create({ type: 'bookmark', color: null, anchor: { locator, quote: { exact: '', prefix: '', suffix: '' } } });
    // the text at the mark, so the panel and the export can show where it is
    const text = await this.#textAt(locator);
    if (text && this.store.get(a.id)) this.store.repair(a.id, { locator, quote: { exact: '', prefix: '', suffix: text } });
  }

  async #textAt(l: Locator): Promise<string> {
    const e = this.session.engine;
    if (!e || !this.session.handle?.capabilities.textStream) return '';
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    try {
      for await (const c of e.textStream(l, { signal: ctl.signal, maxChunkChars: 240 })) {
        const s = c.text.replace(/\s+/g, ' ').trim();
        if (s) return s.slice(0, 200);
      }
    } catch {
      /* no text here (a scan, an image page) */
    } finally {
      clearTimeout(t);
      ctl.abort();
    }
    return '';
  }

  // ---- navigation ----------------------------------------------------------------------------

  async jump(a: Ann): Promise<void> {
    await this.session.jump(a.anchor.locator);
  }

  // ---- copy, export --------------------------------------------------------------------------

  async copy(text: string, what = 'Copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast(what, { duration: 1800 });
    } catch {
      toast('Couldn’t reach the clipboard.', { kind: 'warning' });
    }
  }

  quoteFor(text: string, l: Locator): string {
    return formatQuote(text, { title: this.title, author: this.author }, this.ref(l));
  }

  /** Copy as quote: the selection, else the highlight whose popover is open. */
  async copyQuote(id?: string): Promise<void> {
    const sel = this.session.selection;
    const a = id ? this.store.get(id) : !sel && this.popover ? this.store.get(this.popover.id) : undefined;
    if (a) return this.copy(this.quoteFor(a.anchor.quote.exact, a.anchor.locator), 'Quote copied');
    if (sel) return this.copy(this.quoteFor(sel.text, sel.anchor.locator), 'Quote copied');
  }

  markdown(): string {
    const format = this.session.book.format;
    return toMarkdown({ title: this.title, author: this.author, format }, this.placed(), new Date());
  }

  async exportMarkdown(): Promise<void> {
    const text = this.markdown();
    const name = exportFileName(this.title);
    try {
      if (isTauri()) {
        const d = await import('@tauri-apps/plugin-dialog');
        const path = await d.save({ title: 'Export highlights and notes', defaultPath: name, filters: [{ name: 'Markdown', extensions: ['md'] }] });
        if (!path) return;
        const fs = await import('@tauri-apps/plugin-fs');
        await fs.writeTextFile(path, text);
        toast('Highlights exported', { duration: 2500 });
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: name });
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (err) {
      console.warn('[annotations] export failed', err);
      toast('Couldn’t export the highlights.', { kind: 'warning' });
    }
  }

  // ---- re-anchoring ---------------------------------------------------------------------------

  /** After open: check every highlight still finds its passage; repair or mark orphaned. */
  async reanchorAll(): Promise<void> {
    const signal = this.#abort.signal;
    for (const a of [...this.store.items]) {
      if (signal.aborted) return;
      if (!isMark(a) || !this.session.engine) continue;
      await new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 500 }) : setTimeout(r, 16)));
      const engine = this.session.engine;
      if (signal.aborted || !engine) return;
      const res = await reanchor(engine, a.anchor, { pageCount: this.pageCount, search: !!this.session.handle?.capabilities.search, signal });
      if (signal.aborted) return;
      if (res.status === 'repaired') this.store.repair(a.id, res.anchor);
      else this.store.setOrphan(a.id, res.status === 'orphaned');
      if (res.status !== 'orphaned') this.verified = new Set([...this.verified, a.id]);
    }
  }
}

export { highlightColors };
