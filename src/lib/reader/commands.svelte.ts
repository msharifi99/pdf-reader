/** reader.* and comic.* commands, plus the reader's part of `app.back` (Esc order). */
import { commands, defineCommand, type Command } from '../commands';
import type { Spread, TypographyProfile } from '../engines/types';
import { closeBook } from '../stores/app.svelte';
import { settings } from '../stores/settings.svelte';
import { closeTopLayer } from '../shell/overlays.svelte';
import { openPalette } from '../shell/palette/providers.svelte';
import { defaultTypography, typographyLimits } from '../design/fonts';
import type { FindState } from './find.svelte';
import type { ReaderSession } from './session.svelte';
import type { ReaderUi } from './ui.svelte';
import { smoothScroll, type ReadingTools } from './tools.svelte';
import { chapterIndexAt, locatorFraction } from './progress';
import { readerApi } from './slots.svelte';

export interface ReaderContext {
  session: ReaderSession;
  find: FindState;
  tools: ReadingTools;
  ui: ReaderUi;
  stage: () => HTMLElement | null;
}

/** Typography change for the open book: the per-book override when it is on, else the global profile. */
export function setTypography(session: ReaderSession, patch: Partial<TypographyProfile>): void {
  if (session.typographyOverride) {
    session.setBookSetting({ typography: { ...($state.snapshot(session.typography) as TypographyProfile), ...patch } });
    return;
  }
  const next = { ...($state.snapshot(settings.value.typography) as TypographyProfile), ...patch };
  settings.set('typography', next);
  // a named profile is a saved copy: editing while it is active keeps it in step (as the settings screen does)
  const id = settings.value.activeTypographyProfile;
  if (id) settings.update('typographyProfiles', (l) => l.map((p) => (p.id === id ? { ...p, profile: next } : p)));
}

/** Arrow/j/k keys belong to a focused list (TOC, thumbnails, results) rather than to the page. */
const inKeyNav = () => !!(document.activeElement as HTMLElement | null)?.closest?.('[data-keynav]');

export function registerReaderCommands(c: ReaderContext): () => void {
  const { session: s, find, tools, ui } = c;
  const ready = () => s.status === 'ready' && !!s.engine;
  const nav = () => ready() && !inKeyNav();
  const caps = () => s.handle?.capabilities;
  const viewport = () => c.stage()?.clientHeight ?? 600;
  const fixedZoom = () => ready() && !!caps()?.zoom;

  const page = async (dir: 1 | -1) => {
    const e = s.engine!;
    if (s.flow === 'scrolled') return smoothScroll(s, dir * viewport() * 0.88, 190);
    await (dir > 0 ? e.next() : e.prev());
  };

  const line = async (dir: 1 | -1) => {
    const e = s.engine!;
    if (s.flow === 'scrolled') return smoothScroll(s, dir * 72, 120);
    if (tools.ruler) {
      // paginated with the ruler: the band walks down the page, then the page turns
      const h = viewport();
      const step = tools.rulerHeight * 0.85;
      const next = tools.rulerTop + dir * step;
      if (next >= 40 && next + tools.rulerHeight <= h - 24) return void (tools.rulerTop = next);
      const moved = await (dir > 0 ? e.next() : e.prev());
      if (moved) tools.rulerTop = dir > 0 ? 48 : Math.max(48, h - 24 - tools.rulerHeight);
      return;
    }
    await (dir > 0 ? e.next() : e.prev());
  };

  const chapterStep = async (dir: 1 | -1) => {
    const loc = s.location;
    if (!loc || !s.flat.length) return;
    const n = s.handle?.pageCount ?? 1;
    const at = locatorFraction(loc.locator, n);
    const idx = loc.progress.chapter?.index ?? chapterIndexAt(s.flat, loc.locator, n);
    const startOf = (i: number) => locatorFraction(s.flat[i]!.entry.locator, n);
    let target = -1;
    if (dir > 0) target = s.flat.findIndex((t) => locatorFraction(t.entry.locator, n) > at + 1e-6);
    else {
      // a little way into a chapter, "previous" means its start
      if (idx >= 0 && at - startOf(idx) > 0.002) target = idx;
      else for (let i = s.flat.length - 1; i >= 0; i--) if (startOf(i) < at - 1e-6) { target = i; break; }
    }
    if (target >= 0) await s.jump(s.flat[target]!.entry.locator);
  };

  const setSpread = (v: Spread) => s.setBookSetting({ spread: v });
  const fitTo = (fit: 'width' | 'page' | 'actual' | 'height') => s.setBookSetting({ fit, zoom: null });

  const textSize = (delta: number | null) => {
    const L = typographyLimits.fontSize;
    const size = delta === null ? defaultTypography.fontSize : Math.min(L.max, Math.max(L.min, s.typography.fontSize + delta));
    setTypography(s, { fontSize: size });
  };

  const list: Command[] = [
    defineCommand('reader.nextPage', () => page(1), nav),
    defineCommand('reader.prevPage', () => page(-1), nav),
    defineCommand('reader.scrollDown', () => line(1), nav),
    defineCommand('reader.scrollUp', () => line(-1), nav),
    defineCommand('reader.nextChapter', () => chapterStep(1), () => ready() && s.flat.length > 0),
    defineCommand('reader.prevChapter', () => chapterStep(-1), () => ready() && s.flat.length > 0),
    defineCommand('reader.goToStart', () => s.jump({ fraction: 0 }), nav),
    defineCommand('reader.goToEnd', () => s.jump({ fraction: 1 }), nav),
    defineCommand('reader.goTo', () => openPalette({ prefix: '#' }), ready),
    defineCommand('reader.historyBack', () => s.back(), ready),
    defineCommand('reader.historyForward', () => s.forward(), ready),

    defineCommand('reader.toggleToc', () => ui.toggleSidebar('toc'), ready),
    defineCommand('reader.toggleThumbnails', () => ui.toggleSidebar('pages'), () => ready() && !!caps()?.thumbnails),
    defineCommand('reader.toggleFlow', () => s.setBookSetting({ flow: s.flow === 'paginated' ? 'scrolled' : 'paginated' }), () => ready() && !!caps()?.flows && s.kind !== 'comic'),
    defineCommand('reader.toggleSpread', () => setSpread(s.spread === 'single' ? (s.kind === 'reflow' ? 'auto' : 'double') : 'single'), () => ready() && !!caps()?.spreads && s.kind !== 'comic'),

    defineCommand('reader.zoomIn', () => s.engine?.zoomBy?.(1.15), fixedZoom),
    defineCommand('reader.zoomOut', () => s.engine?.zoomBy?.(1 / 1.15), fixedZoom),
    defineCommand('reader.zoomReset', () => s.setBookSetting({ fit: s.defaultFit, zoom: null }), fixedZoom),
    defineCommand('reader.fitWidth', () => fitTo('width'), fixedZoom),
    defineCommand('reader.fitPage', () => fitTo('page'), fixedZoom),
    defineCommand('reader.actualSize', () => fitTo('actual'), fixedZoom),
    defineCommand('reader.rotate', () => s.setBookSetting({ rotation: (((s.bookSettings.rotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 }), () => ready() && s.kind === 'pdf'),
    defineCommand('reader.textBigger', () => textSize(1), () => ready() && !!caps()?.typography),
    defineCommand('reader.textSmaller', () => textSize(-1), () => ready() && !!caps()?.typography),
    defineCommand('reader.textReset', () => textSize(null), () => ready() && !!caps()?.typography),
    defineCommand('reader.pageTint.smart', () => s.setBookSetting({ pageTint: 'smart' }), () => ready() && !!caps()?.pageTint),
    defineCommand('reader.pageTint.invert', () => s.setBookSetting({ pageTint: 'invert' }), () => ready() && !!caps()?.pageTint),
    defineCommand('reader.pageTint.original', () => s.setBookSetting({ pageTint: 'original' }), () => ready() && !!caps()?.pageTint),

    defineCommand('reader.find', () => {
      const picked = s.selection?.text?.trim();
      find.show(picked && picked.length < 120 ? picked : undefined);
    }, ready),
    defineCommand('reader.findNext', () => (find.open ? find.step(1) : find.show()), ready),
    defineCommand('reader.findPrev', () => (find.open ? find.step(-1) : find.show()), ready),
    defineCommand('reader.closeFind', () => find.close(), () => find.open),

    defineCommand('reader.toggleFocus', () => tools.setFocus(!tools.focus), ready),
    defineCommand('reader.toggleRuler', () => (tools.ruler = !tools.ruler), ready),
    defineCommand('reader.toggleAutoScroll', () => tools.toggleAuto(), ready),
    defineCommand('reader.autoScrollFaster', () => tools.changeSpeed(1), ready),
    defineCommand('reader.autoScrollSlower', () => tools.changeSpeed(-1), ready),

    defineCommand('comic.left', () => s.engine?.turnToward?.('left'), nav),
    defineCommand('comic.right', () => s.engine?.turnToward?.('right'), nav),
    defineCommand('comic.toggleDirection', () => s.setBookSetting({ direction: s.direction === 'rtl' ? 'ltr' : 'rtl' }), ready),
    defineCommand('comic.modeSingle', () => s.setBookSetting({ comicMode: 'single' }), ready),
    defineCommand('comic.modeDouble', () => s.setBookSetting({ comicMode: 'double' }), ready),
    defineCommand('comic.modeWebtoon', () => s.setBookSetting({ comicMode: 'webtoon' }), ready),
  ];

  // Esc: menus/dialogs/overlays first (the shell), then the reader's own layers, then the library.
  const shellBack = commands.get('app.back');
  const back = defineCommand('app.back', () => {
    if (closeTopLayer()) return;
    if (ui.footnote) return void (ui.footnote = null);
    if (find.open) return find.close();
    if (readerApi.panelOpen) return readerApi.closePanel();
    if (ui.sidebar) return void (ui.sidebar = null);
    if (tools.focus) return tools.setFocus(false);
    if (tools.auto !== 'off') return tools.stopAuto();
    closeBook();
  });
  const offs = [commands.register(list), commands.register(back)];
  return () => {
    offs.forEach((f) => f());
    if (shellBack && !commands.has('app.back')) commands.register(shellBack);
  };
}
