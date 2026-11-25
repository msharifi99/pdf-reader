// Dev/test harness for the PDF engine (not part of the app). Drives the engine directly; exposes window.__h for Playwright.
import { createPdfEngine, type PdfEngine } from '../src/lib/engines/pdf';
import type { BookHandle, EngineError, Theme } from '../src/lib/engines/types';

const FILES = ['text.pdf', 'big.pdf', 'encrypted.pdf', 'corrupt.pdf'];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const status = $('status');

const themes: Record<string, Theme> = {
  dark: { id: 'dark', name: 'Dark', dark: true, bg: '#1e1f22', surface: '#16171a', text: '#d8d8d0', muted: '#9a9a92', accent: '#7aa2f7', link: '#7aa2f7', selection: 'rgb(122 162 247 / 0.35)', highlight: ['#e5c07b', '#98c379', '#61afef', '#e06c9f'], shadow: 'rgb(0 0 0 / 0.5)' },
  light: { id: 'light', name: 'Light', dark: false, bg: '#fdf6e3', surface: '#eee8d5', text: '#073642', muted: '#586e75', accent: '#268bd2', link: '#268bd2', selection: 'rgb(38 139 210 / 0.3)', highlight: ['#ffd84d', '#7bd88f', '#6cb6ff', '#ff8fb8'], shadow: 'rgb(0 0 0 / 0.2)' },
};

const h = {
  engine: null as PdfEngine | null,
  handle: null as BookHandle | null,
  events: [] as unknown[],
  links: [] as unknown[],
  prompts: [] as boolean[],
  error: null as { code: string; message: string } | null,
  timing: { openMs: 0, firstPaintMs: 0 },
  rotation: 0 as 0 | 90 | 180 | 270,
  async open(file: string, opts: { passwords?: string[]; theme?: string; tint?: 'smart' | 'invert' | 'original'; page?: number; flow?: 'scrolled' | 'paginated'; fit?: 'width' | 'page' | 'actual' | 'custom'; zoom?: number } = {}) {
    h.engine?.dispose();
    stage.replaceChildren();
    h.events = []; h.links = []; h.prompts = []; h.error = null;
    const engine = (await createPdfEngine()) as PdfEngine;
    h.engine = engine;
    engine.on('relocated', (e) => { h.events.push(e); status.textContent = `page ${(e.progress.page?.index ?? 0) + 1}/${e.progress.page?.count} y=${(e.locator.kind === 'fixed' ? e.locator.y ?? 0 : 0).toFixed(3)} ${e.progress.chapter?.title ?? ''}`; });
    engine.on('link', (l) => h.links.push(l));
    engine.on('warning', (w) => console.warn('engine warning', w));
    engine.setPresentation({ theme: themes[opts.theme ?? $<HTMLSelectElement>('theme').value], pageTint: opts.tint ?? ($<HTMLSelectElement>('tint').value as 'smart'), flow: opts.flow ?? 'scrolled', fit: opts.fit ?? 'width', zoom: opts.zoom ?? 1 });
    const queue = [...(opts.passwords ?? [])];
    const t0 = performance.now();
    try {
      h.handle = await engine.open({ kind: 'file', url: `/fixtures/pdf/${file}`, format: 'pdf', fileName: file }, {
        requestPassword: async (retry) => { h.prompts.push(retry); return queue.shift() ?? null; },
      });
      h.timing.openMs = performance.now() - t0;
      await engine.render(stage, opts.page ? { kind: 'fixed', page: opts.page, y: 0 } : undefined);
      h.timing.firstPaintMs = performance.now() - t0;
    } catch (e) {
      h.error = { code: (e as EngineError).code ?? 'unknown', message: (e as Error).message };
    }
    return h.error;
  },
};
(window as unknown as { __h: typeof h }).__h = h;

for (const f of FILES) $<HTMLSelectElement>('file').add(new Option(f));
$('open').onclick = () => void h.open($<HTMLSelectElement>('file').value, { passwords: [prompt('Password (if any)') ?? ''] });
$('prev').onclick = () => void h.engine?.prev();
$('next').onclick = () => void h.engine?.next();
$('zin').onclick = () => h.engine?.zoomBy(1.2);
$('zout').onclick = () => h.engine?.zoomBy(1 / 1.2);
$('fw').onclick = () => h.engine?.setPresentation({ fit: 'width' });
$('fp').onclick = () => h.engine?.setPresentation({ fit: 'page' });
$('fa').onclick = () => h.engine?.setPresentation({ fit: 'actual' });
$('rot').onclick = () => { h.rotation = ((h.rotation + 90) % 360) as 0 | 90 | 180 | 270; h.engine?.setPresentation({ rotation: h.rotation }); };
$('tint').onchange = () => h.engine?.setPresentation({ pageTint: $<HTMLSelectElement>('tint').value as 'smart' });
$('theme').onchange = () => h.engine?.setPresentation({ theme: themes[$<HTMLSelectElement>('theme').value] });
$('flow').onchange = () => h.engine?.setPresentation({ flow: $<HTMLSelectElement>('flow').value as 'scrolled' });
$('spread').onchange = () => h.engine?.setPresentation({ spread: $<HTMLSelectElement>('spread').value as 'single' });
$('find').onclick = async () => {
  const hits = [];
  for await (const hit of h.engine!.search($<HTMLInputElement>('q').value)) hits.push(hit);
  h.engine!.setDecorations('search', hits.map((x, i) => ({ id: String(i), anchor: x.anchor, style: { type: 'search-hit' as const, current: i === 0 } })));
  status.textContent = `${hits.length} hits`;
};

const q = new URLSearchParams(location.search);
if (q.get('file')) void h.open(q.get('file')!, { passwords: q.get('password') ? [q.get('password')!] : [], theme: q.get('theme') ?? undefined });
