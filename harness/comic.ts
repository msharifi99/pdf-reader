// Dev/test harness for the comic engine (not part of the app). Exposes window.__h for Playwright.
import { initCore, core, fileUrl } from '../src/lib/core/core';
import { createComicEngine } from '../src/lib/engines/comic';
import type { ComicEngine } from '../src/lib/engines/comic/engine';
import type { BookHandle, BookSource, EngineError, Fit, Flow, PageTint, ReadingDirection, Spread, Theme } from '../src/lib/engines/types';

const FILES = ['comic.cbz', 'manga-rtl.cbz', 'comic.cbr', 'comic-rar4.cbr', 'encrypted.cbr', 'corrupt.cbz', 'empty.cbz'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const status = $('status');

const themes: Record<string, Theme> = {
  dark: { id: 'dark', name: 'Dark', dark: true, bg: '#1e1f22', surface: '#16171a', text: '#d8d8d0', muted: '#9a9a92', accent: '#7aa2f7', link: '#7aa2f7', selection: 'rgb(122 162 247 / 0.35)', highlight: ['#e5c07b', '#98c379', '#61afef', '#e06c9f'], shadow: 'rgb(0 0 0 / 0.5)' },
  light: { id: 'light', name: 'Light', dark: false, bg: '#fdf6e3', surface: '#eee8d5', text: '#073642', muted: '#586e75', accent: '#268bd2', link: '#268bd2', selection: 'rgb(38 139 210 / 0.3)', highlight: ['#ffd84d', '#7bd88f', '#6cb6ff', '#ff8fb8'], shadow: 'rgb(0 0 0 / 0.2)' },
};

interface Opts {
  password?: string;
  theme?: string;
  tint?: PageTint;
  flow?: Flow;
  spread?: Spread;
  fit?: Fit;
  direction?: ReadingDirection;
  page?: number;
  y?: number;
  gap?: number;
}

const h = {
  engine: null as ComicEngine | null,
  handle: null as BookHandle | null,
  events: [] as unknown[],
  warnings: [] as unknown[],
  prompts: [] as boolean[],
  presentation: [] as unknown[],
  pointers: [] as unknown[],
  error: null as { code: string; message: string } | null,
  timing: { openMs: 0, firstPaintMs: 0 },
  /** Open a fixture archive in /fixtures/comic, or a source built by the caller. */
  async open(file: string | BookSource, opts: Opts = {}) {
    h.engine?.dispose();
    stage.replaceChildren();
    h.events = []; h.warnings = []; h.prompts = []; h.presentation = []; h.pointers = []; h.error = null; h.handle = null;
    const engine = (await createComicEngine()) as ComicEngine;
    h.engine = engine;
    engine.on('relocated', (e) => {
      h.events.push(e);
      status.textContent = `page ${(e.progress.page?.index ?? 0) + 1}/${e.progress.page?.count} y=${(e.locator.kind === 'fixed' ? (e.locator.y ?? 0) : 0).toFixed(3)} ${e.progress.chapter?.title ?? ''}`;
    });
    engine.on('warning', (w) => h.warnings.push({ code: w.code, message: w.message }));
    engine.on('presentationchange', (p) => h.presentation.push(p));
    engine.on('pointer', (p) => h.pointers.push(p));
    engine.setPresentation({
      theme: themes[opts.theme ?? $<HTMLSelectElement>('theme').value],
      pageTint: opts.tint ?? ($<HTMLSelectElement>('tint').value as PageTint),
      flow: opts.flow ?? 'paginated',
      spread: opts.spread ?? 'single',
      fit: opts.fit ?? 'page',
      ...(opts.direction ? { direction: opts.direction } : {}),
    });
    if (opts.gap !== undefined) engine.setWebtoonGap(opts.gap);
    const source: BookSource = typeof file === 'string' ? { kind: 'file', url: `/fixtures/comic/${file}`, format: file.endsWith('.cbr') ? 'cbr' : 'cbz', fileName: file } : file;
    const t0 = performance.now();
    try {
      h.handle = await engine.open(source, {
        requestPassword: async (retry) => {
          h.prompts.push(retry);
          return opts.password ?? null;
        },
      });
      h.timing.openMs = performance.now() - t0;
      await engine.render(stage, opts.page || opts.y ? { kind: 'fixed', page: opts.page ?? 0, y: opts.y ?? 0 } : undefined);
      h.timing.firstPaintMs = performance.now() - t0;
    } catch (e) {
      h.error = { code: (e as EngineError).code ?? 'unknown', message: (e as Error).message };
    }
    return h.error;
  },
  /** The app's open flow for folders and single images: core.listImageFolder + fileUrl per image. */
  async openFolder(path: string, startImage: string | null, opts: Opts = {}) {
    await initCore();
    const files = await core.listImageFolder(path);
    const src: BookSource = { kind: 'images', format: 'image', urls: files.map((p) => fileUrl({ path: p })), names: files.map((p) => p.split(/[\\/]/).pop()!) };
    const page = startImage ? Math.max(0, files.findIndex((p) => p === startImage)) : 0;
    return h.open(src, { ...opts, page });
  },
  /** Time one page turn (call after the next pages are preloaded). */
  async timeTurn(dir: 'next' | 'prev' = 'next') {
    const t0 = performance.now();
    await h.engine![dir]();
    return performance.now() - t0;
  },
  /** Mean RGB of the first page canvas (tint tests). */
  sample() {
    const c = stage.querySelector<HTMLCanvasElement>('canvas.q-page');
    if (!c) return null;
    const g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let r = 0, gg = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]!; gg += d[i + 1]!; b += d[i + 2]!; }
    return [r / n, gg / n, b / n];
  },
};
(window as unknown as { __h: typeof h }).__h = h;

for (const f of FILES) $<HTMLSelectElement>('file').add(new Option(f));
$('open').onclick = () => void h.open($<HTMLSelectElement>('file').value, { password: prompt('Password (if any)') ?? undefined });
$('left').onclick = () => void h.engine?.turnToward('left');
$('right').onclick = () => void h.engine?.turnToward('right');
$('zin').onclick = () => h.engine?.zoomBy(1.2);
$('zout').onclick = () => h.engine?.zoomBy(1 / 1.2);
const sel = (id: string, f: (v: string) => void) => ($(id).onchange = () => f($<HTMLSelectElement>(id).value));
sel('fit', (v) => h.engine?.setPresentation({ fit: v as Fit }));
sel('tint', (v) => h.engine?.setPresentation({ pageTint: v as PageTint }));
sel('theme', (v) => h.engine?.setPresentation({ theme: themes[v] }));
sel('flow', (v) => h.engine?.setPresentation({ flow: v === 'scrolled' ? 'scrolled' : 'paginated' }));
sel('spread', (v) => h.engine?.setPresentation({ spread: v as Spread }));
sel('dir', (v) => h.engine?.setPresentation({ direction: v as ReadingDirection }));

const q = new URLSearchParams(location.search);
if (q.get('file')) void h.open(q.get('file')!, { password: q.get('password') ?? undefined, flow: q.get('flow') === 'scrolled' ? 'scrolled' : undefined, spread: (q.get('spread') as Spread) ?? undefined });
