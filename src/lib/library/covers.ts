/**
 * Background cover pass: books the core marks `needsCover` (PDF, MOBI/AZW3, CBR... whatever Rust
 * couldn't extract) get page 1 / the first image / the embedded cover rendered with the right engine,
 * encoded as WebP (~400 px tall) and stored with `saveCover`. One book at a time, in idle time,
 * paused while a book is open. A book that can't produce a cover gets empty bytes, so it isn't retried.
 *
 *   startCoverPass(onSaved)     // idempotent; call again when the library changes
 *   await encodeCover(blobOrBitmap)  // -> WebP bytes, also used by "Edit details → Choose image"
 */
import type { Book } from '../core/bindings';
import { core, fileUrl, raw } from '../core/core';
import { engineKindFor } from '../engines/sniff';
import type { Engine } from '../engines/types';
import { app } from '../stores/app.svelte';

const COVER_HEIGHT = 400;

/** Scale to at most 400 px tall and encode as WebP. */
export async function encodeCover(src: Blob | ImageBitmap): Promise<Uint8Array> {
  const bm = src instanceof Blob ? await createImageBitmap(src) : src;
  try {
    const h = Math.min(COVER_HEIGHT, bm.height);
    const w = Math.max(1, Math.round((bm.width * h) / bm.height));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bm, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.85 });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    bm.close();
  }
}

async function engineFor(b: Book): Promise<Engine | null> {
  const kind = engineKindFor(b.format);
  if (kind === 'pdf') return (await import('../engines/pdf')).createPdfEngine();
  if (kind === 'reflow') return (await import('../engines/reflow')).createReflowEngine();
  if (kind === 'comic' && b.format !== 'image') return (await import('../engines/comic')).createComicEngine();
  return null; // image folders: the core uses the first image itself
}

/** Render one book's cover; null when it has none. */
export async function renderCover(b: Book): Promise<Uint8Array | null> {
  const engine = await engineFor(b);
  if (!engine) return null;
  try {
    const name = b.path?.split(/[\\/]/).pop();
    const handle = await engine.open({ kind: 'file', url: fileUrl({ bookId: b.id }), format: b.format, fileName: name, byteLength: b.fileSize || undefined });
    const embedded = await handle.metadata.cover?.().catch(() => null);
    if (embedded) return await encodeCover(embedded);
    const thumb = await engine.thumbnail?.(0, 300);
    return thumb ? await encodeCover(thumb) : null;
  } finally {
    engine.dispose();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idle = () =>
  new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 3000 }) : setTimeout(r, 200)));

let running = false;
let again = false;
const tried = new Set<string>();

export function startCoverPass(onSaved: (b: Book) => void): void {
  if (running) {
    again = true;
    return;
  }
  running = true;
  void (async () => {
    try {
      await sleep(1200); // let the library paint first
      do {
        again = false;
        const todo = (await core.booksNeedingCovers()).filter((b) => !tried.has(b.id));
        for (const b of todo) {
          tried.add(b.id);
          while (app.view === 'reader') await sleep(2000); // never compete with the page being read
          await idle();
          let bytes: Uint8Array | null = null;
          try {
            bytes = await renderCover(b);
          } catch (err) {
            console.info('[covers] no cover for', b.title, err);
          }
          try {
            onSaved(await raw.saveCover(b.id, bytes ?? new Uint8Array()));
          } catch (err) {
            console.warn('[covers] save failed', err);
          }
        }
      } while (again);
    } catch (err) {
      console.warn('[covers] pass stopped', err);
    } finally {
      running = false;
    }
  })();
}
