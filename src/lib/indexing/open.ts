/** Open a library book with the right Engine, without a visible target (indexing, OCR in the background). */
import type { Book } from '../core/bindings';
import { core, fileUrl } from '../core/core';
import type { BookHandle, BookSource, Engine, EngineKind } from '../engines/types';

export const engineKindOf = (format: Book['format']): EngineKind =>
  format === 'pdf' ? 'pdf' : format === 'cbz' || format === 'cbr' || format === 'image' ? 'comic' : 'reflow';

export async function createEngine(kind: EngineKind): Promise<Engine> {
  if (kind === 'pdf') return (await import('../engines/pdf')).createPdfEngine();
  if (kind === 'comic') return (await import('../engines/comic')).createComicEngine();
  return (await import('../engines/reflow')).createReflowEngine();
}

export async function sourceFor(book: Book): Promise<BookSource> {
  if (book.format === 'image') {
    // An image book is a folder (its path) listed by the core.
    const paths = await core.listImageFolder(book.path ?? '');
    return { kind: 'images', urls: paths.map((p) => fileUrl({ path: p })), names: paths.map((p) => p.split(/[\\/]/).pop() ?? p), format: 'image' };
  }
  return { kind: 'file', url: fileUrl({ bookId: book.id }), format: book.format, fileName: book.path?.split(/[\\/]/).pop() };
}

/** The caller must `engine.dispose()`. Never calls `render()`: only `textStream`, `search`, `thumbnail`, `setOcrWords`. */
export async function openBookHeadless(book: Book, signal?: AbortSignal): Promise<{ engine: Engine; handle: BookHandle }> {
  const engine = await createEngine(engineKindOf(book.format));
  try {
    return { engine, handle: await engine.open(await sourceFor(book), { signal }) };
  } catch (e) {
    engine.dispose();
    throw e;
  }
}
