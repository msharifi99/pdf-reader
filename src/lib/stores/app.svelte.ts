/** Cross-cutting app state. Keep small; feature areas keep their own stores. */
import type { BookFormat } from '../engines/types';

export type AppView = 'library' | 'reader';

export interface OpenBook {
  /** Library id once the book is in the DB; absent for ad-hoc opened files. */
  id?: string;
  path: string;
  title: string;
  format?: BookFormat;
}

export const app = $state<{ view: AppView; book: OpenBook | null; version: string }>({
  view: 'library',
  book: null,
  version: '',
});

export function openBook(book: OpenBook): void {
  app.book = book;
  app.view = 'reader';
}

export function closeBook(): void {
  app.book = null;
  app.view = 'library';
}
