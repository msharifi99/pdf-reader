/**
 * Extension points of the reader for annotations (T11) and read-aloud / lookup (T13).
 * Documented at the top of ReaderView.svelte.
 *
 *   import { readerApi, setReaderPanel, addBottomBarItem } from '../reader/slots.svelte';
 *   readerApi.session                     // the open ReaderSession (null in the library)
 *   readerApi.session.engine              // the Engine (search, textStream, setDecorations...)
 *   readerApi.session.onSelection(fn)     // selection pipeline: fn({ anchor, text, rects }) / fn(null)
 *   readerApi.selectionRect()             // union of the selection rects in viewport (client) coords
 *   readerApi.session.decorate('annotations', items)   // decoration pass-through
 *   const off = setReaderPanel({ id: 'annotations', title: 'Annotations', body })  // right panel host
 *   readerApi.openPanel('annotations') / closePanel() / panelOpen
 *   const off = addBottomBarItem(snippet)  // left side of the bottom bar (read-aloud controls, OCR...)
 *   const off = addReaderOverlay(snippet)  // rendered over the page while a book is open; mounted per open
 *                                          // and destroyed on close, so components in it own per-book setup
 *
 * Wiring T13 (inside a component passed to addReaderOverlay, so it lives exactly as long as the book):
 *   onMount(() => registerSpeechCommands(() => readerApi.session?.engine ?? null,
 *     () => ({ lang: readerApi.session?.handle?.metadata.language })));   // speech.init() once at app start
 *   onMount(() => registerLookupCommands(() => { const s = readerApi.session?.selection;
 *     return s ? { text: s.text, rect: readerApi.selectionRect() ?? undefined, lang: readerApi.session?.handle?.metadata.language } : null; }));
 *   readerApi.session.decorate('speech', items) is free for the spoken-word highlight if the controller
 *   does not call engine.setDecorations itself; layers 'search' (find) and 'annotations' (T11) are taken.
 */
import type { Snippet } from 'svelte';
import type { Rect } from '../engines/types';
import type { ReaderSession } from './session.svelte';

export interface ReaderPanel {
  id: string;
  title: string;
  body: Snippet;
  /** px, default 340 */
  width?: number;
}

class ReaderApi {
  session = $state.raw<ReaderSession | null>(null);
  /** the render target the engine draws into (selection rects are relative to it) */
  stage = $state.raw<HTMLElement | null>(null);
  panels = $state.raw<ReaderPanel[]>([]);
  panelId = $state<string | null>(null);
  bottom = $state.raw<Snippet[]>([]);
  overlays = $state.raw<Snippet[]>([]);

  get panel(): ReaderPanel | null {
    return this.panels.find((p) => p.id === this.panelId) ?? null;
  }
  get panelOpen(): boolean {
    return this.panel !== null;
  }
  openPanel(id: string): void {
    this.panelId = id;
  }
  closePanel(): void {
    this.panelId = null;
  }
  togglePanel(id: string): void {
    this.panelId = this.panelId === id ? null : id;
  }

  /** The current selection's bounding box in viewport coordinates (for a floating menu), or null. */
  selectionRect(): Rect | null {
    const s = this.session?.selection;
    const st = this.stage?.getBoundingClientRect();
    if (!s?.rects.length || !st) return null;
    const x0 = Math.min(...s.rects.map((r) => r.x));
    const y0 = Math.min(...s.rects.map((r) => r.y));
    const x1 = Math.max(...s.rects.map((r) => r.x + r.width));
    const y1 = Math.max(...s.rects.map((r) => r.y + r.height));
    return { x: st.left + x0, y: st.top + y0, width: x1 - x0, height: y1 - y0 };
  }
}

export const readerApi = new ReaderApi();

export function setReaderPanel(panel: ReaderPanel): () => void {
  readerApi.panels = [...readerApi.panels.filter((p) => p.id !== panel.id), panel];
  return () => {
    readerApi.panels = readerApi.panels.filter((p) => p !== panel);
    if (readerApi.panelId === panel.id) readerApi.panelId = null;
  };
}

export function addBottomBarItem(item: Snippet): () => void {
  readerApi.bottom = [...readerApi.bottom, item];
  return () => (readerApi.bottom = readerApi.bottom.filter((s) => s !== item));
}

export function addReaderOverlay(item: Snippet): () => void {
  readerApi.overlays = [...readerApi.overlays, item];
  return () => (readerApi.overlays = readerApi.overlays.filter((s) => s !== item));
}
