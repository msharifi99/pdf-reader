// Dev/test bench for the Reflow Engine. Not part of the app: `?` the Playwright specs drive it
// through `window.__reflow`.
import { createReflowEngine } from '../src/lib/engines/reflow';
import type { ReflowEngine } from '../src/lib/engines/reflow/engine';
import type { BookFormat, Decoration, EngineError, Presentation, SearchHit, Theme, TypographyProfile } from '../src/lib/engines/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const FILES: Array<[string, BookFormat]> = [
  ['epub3.epub', 'epub'],
  ['epub2.epub', 'epub'],
  ['drm.epub', 'epub'],
  ['corrupt.epub', 'epub'],
  ['fb2.fb2', 'fb2'],
  ['fb2.fbz', 'fbz'],
  ['mobi.mobi', 'mobi'],
  ['azw3.azw3', 'azw3'],
  ['drm.mobi', 'mobi'],
  ['corrupt.mobi', 'mobi'],
  ['corrupt.fb2', 'fb2'],
];

const THEMES: Record<string, Theme> = {
  light: {
    id: 'light', name: 'Light', dark: false, bg: '#faf7f0', surface: '#f3efe6', text: '#1d1b17', muted: '#6b665c',
    accent: '#a8651c', link: '#2a5a9a', selection: '#cfe0f5', highlight: ['#f6e08a', '#bfe3b4', '#b6d4f2', '#f2bdd6'], shadow: '#000000',
  },
  dark: {
    id: 'dark', name: 'Dark', dark: true, bg: '#1b1c1f', surface: '#222327', text: '#e8e4dc', muted: '#a19d95',
    accent: '#e2a85e', link: '#8fb8e8', selection: '#3a4b66', highlight: ['#5f4c1c', '#2c4f36', '#284563', '#5c2f47'], shadow: '#000000',
  },
  solarized: {
    id: 'solarized', name: 'Solarized Light', dark: false, bg: '#fdf6e3', surface: '#f6efda', text: '#586e75', muted: '#93a1a1',
    accent: '#b58900', link: '#268bd2', selection: '#eee8d5', highlight: ['#f2e1a0', '#cfe3b0', '#bcd8ea', '#efc3d4'], shadow: '#000000',
  },
};

const target = $('target');
const status = $('status');
let engine: ReflowEngine | null = null;
const events: Array<{ type: string; detail?: unknown }> = [];
let hits: SearchHit[] = [];
let hitIx = -1;

const typography = (): TypographyProfile => ({
  fontFamily: ($('font') as HTMLSelectElement).value,
  fontSize: +($('size') as HTMLInputElement).value,
  fontWeight: 400,
  lineHeight: +($('lh') as HTMLInputElement).value,
  letterSpacing: 0,
  wordSpacing: 0,
  paragraphSpacing: 0.6,
  textIndent: 0,
  textAlign: ($('justify') as HTMLInputElement).checked ? 'justify' : 'start',
  hyphenation: true,
  marginX: 6,
  marginY: 5,
  maxLineWidth: 66,
  columns: 'auto',
  overridePublisher: ($('override') as HTMLSelectElement).value as TypographyProfile['overridePublisher'],
});

const presentation = (): Partial<Presentation> => ({
  theme: THEMES[($('theme') as HTMLSelectElement).value]!,
  typography: typography(),
  flow: ($('flow') as HTMLSelectElement).value as Presentation['flow'],
  spread: ($('spread') as HTMLSelectElement).value as Presentation['spread'],
});

const log = (type: string, detail?: unknown) => events.push({ type, detail });

function updateStatus(text: string) {
  status.textContent = text;
}

function wire(e: ReflowEngine) {
  e.on('relocated', (ev) => {
    log('relocated', ev);
    const p = ev.progress;
    updateStatus(`${ev.reason} ${(p.fraction * 100).toFixed(1)}% ${p.chapter?.title ?? ''} ${ev.locator.kind === 'reflow' ? ev.locator.cfi : ''}`);
  });
  e.on('footnote', (f) => {
    log('footnote', f);
    const note = $('note');
    note.innerHTML = f.html;
    note.style.display = 'block';
    note.style.left = `${Math.max(8, f.rect.x)}px`;
    note.style.top = `${f.rect.y + f.rect.height + 6}px`;
  });
  e.on('link', (l) => log('link', l));
  e.on('selection', (s) => {
    log('selection', s ? { text: s.text, anchor: s.anchor } : null);
    const m = $('selmenu');
    if (!s || !s.rects.length) return void (m.style.display = 'none');
    const r = s.rects[0]!;
    m.textContent = 'Highlight';
    m.style.display = 'block';
    m.style.left = `${r.x}px`;
    m.style.top = `${Math.max(0, r.y - 32)}px`;
  });
  e.on('decorationclick', (d) => log('decorationclick', d));
  e.on('pointer', (p) => log('pointer', p));
  e.on('warning', (w) => log('warning', { code: w.code, message: w.message }));
}

async function openBook(name: string, locator?: Parameters<ReflowEngine['render']>[1]) {
  engine?.dispose();
  target.replaceChildren();
  events.length = 0;
  $('note').style.display = 'none';
  const fmt = FILES.find((f) => f[0] === name)?.[1] ?? 'epub';
  engine = (await createReflowEngine()) as ReflowEngine;
  wire(engine);
  window.__reflow.engine = engine;
  try {
    const handle = await engine.open({ kind: 'file', url: `/fixtures/reflow/${name}`, format: fmt, fileName: name });
    const toc = $('toc') as HTMLSelectElement;
    toc.replaceChildren();
    const flat: Array<[string, number]> = [];
    const walk = (list: typeof handle.toc, depth: number) =>
      list.forEach((t) => {
        flat.push([`${'· '.repeat(depth)}${t.title}`, flat.length]);
        walk(t.children, depth + 1);
      });
    walk(handle.toc, 0);
    window.__reflow.tocFlat = [];
    const collect = (list: typeof handle.toc) => list.forEach((t) => (window.__reflow.tocFlat.push(t.locator), collect(t.children)));
    collect(handle.toc);
    for (const [label, i] of flat) toc.add(new Option(label, String(i)));
    engine.setPresentation(presentation());
    ($('anim') as HTMLInputElement).checked ? engine.setOptions({ animatePageTurns: true }) : engine.setOptions({ animatePageTurns: false });
    await engine.render(target, locator);
    window.__reflow.handle = handle;
    updateStatus(`open: ${handle.metadata.title}`);
    return handle;
  } catch (err) {
    const e = err as EngineError;
    window.__reflow.error = { name: e.name, code: e.code, message: e.message };
    updateStatus(`error: ${e.code ?? 'unknown'} ${e.message}`);
    throw err;
  }
}

declare global {
  interface Window {
    __reflow: {
      engine: ReflowEngine | null;
      handle?: Awaited<ReturnType<ReflowEngine['open']>>;
      events: typeof events;
      error?: { name: string; code?: string; message: string };
      tocFlat: Array<import('../src/lib/engines/types').Locator>;
      openBook: typeof openBook;
      /** Open an arbitrary URL on a throw-away engine (error-path tests). */
      openUrl: (url: string, format: BookFormat) => Promise<void>;
      hits: SearchHit[];
      THEMES: typeof THEMES;
    };
  }
}
async function openUrl(url: string, format: BookFormat) {
  const e = await createReflowEngine();
  try {
    await e.open({ kind: 'file', url, format });
  } finally {
    e.dispose();
  }
}
window.__reflow = { engine: null, events, tocFlat: [], openBook, openUrl, hits, THEMES };

for (const [name] of FILES) ($('file') as HTMLSelectElement).add(new Option(name));

const apply = () => engine?.setPresentation(presentation());
for (const id of ['theme', 'font', 'size', 'lh', 'override', 'justify', 'flow', 'spread']) $(id).addEventListener('input', apply);
$('open').addEventListener('click', () => void openBook(($('file') as HTMLSelectElement).value).catch(() => {}));
$('prev').addEventListener('click', () => void engine?.prev());
$('next').addEventListener('click', () => void engine?.next());
$('anim').addEventListener('change', (e) => engine?.setOptions({ animatePageTurns: (e.target as HTMLInputElement).checked }));
$('toc').addEventListener('change', (e) => {
  const loc = window.__reflow.tocFlat[+(e.target as HTMLSelectElement).value];
  if (loc) void engine?.goTo(loc);
});

$('find').addEventListener('click', async () => {
  if (!engine) return;
  hits = [];
  hitIx = -1;
  window.__reflow.hits = hits;
  for await (const h of engine.search(($('q') as HTMLInputElement).value)) hits.push(h);
  const deco = (current: number): Decoration[] =>
    hits.map((h, i) => ({ id: String(i), anchor: h.anchor, style: { type: 'search-hit', current: i === current } }));
  engine.setDecorations('search', deco(-1));
  updateStatus(`${hits.length} hits`);
  window.__reflow.hits = hits;
});
$('hit-next').addEventListener('click', async () => {
  if (!engine || !hits.length) return;
  hitIx = (hitIx + 1) % hits.length;
  await engine.goTo(hits[hitIx]!.locator);
  engine.setDecorations('search', hits.map((h, i) => ({ id: String(i), anchor: h.anchor, style: { type: 'search-hit', current: i === hitIx } })));
});
$('selmenu').addEventListener('mousedown', async (e) => {
  e.preventDefault();
  const sel = engine?.getSelection();
  if (!engine || !sel) return;
  const id = `h${Date.now()}`;
  const prior = (window as unknown as { __hl?: Decoration[] }).__hl ?? [];
  const next = [...prior, { id, anchor: sel.anchor, style: { type: 'highlight' as const, color: 0 as const } }];
  (window as unknown as { __hl?: Decoration[] }).__hl = next;
  engine.setDecorations('annotations', next);
  engine.clearSelection();
});
$('speak').addEventListener('click', async () => {
  if (!engine) return;
  for await (const chunk of engine.textStream(undefined, { maxChunkChars: 160 })) {
    const words = [...chunk.text.matchAll(/\S+/g)].slice(0, 8);
    const sentence = await chunk.anchorFor(0, chunk.text.length);
    for (const w of words) {
      await engine.showSpeech(await chunk.anchorFor(w.index!, w.index! + w[0].length), sentence);
      await new Promise((r) => setTimeout(r, 150));
    }
    engine.clearSpeech();
    break;
  }
});
document.addEventListener('click', () => ($('note').style.display = 'none'), true);

// `?book=epub3.epub` opens straight away (handy for manual testing).
const q = new URLSearchParams(location.search).get('book');
if (q) {
  ($('file') as HTMLSelectElement).value = q;
  void openBook(q).catch(() => {});
}
