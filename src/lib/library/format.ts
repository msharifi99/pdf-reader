/** Small, pure presentation helpers for the library (tested in format.test.ts). */
import type { Book, Format, ReadingSpeed } from '../core/bindings';

/** Stable hue from the title, so generated covers vary but never change between runs (same as ui/Card). */
export const coverHue = (title: string): number => [...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export const FORMAT_LABEL: Record<Format, string> = {
  pdf: 'PDF', epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', fb2: 'FB2', fbz: 'FB2', cbz: 'CBZ', cbr: 'CBR', image: 'Images',
};

/** Filter groups shown in the Filter menu: one entry may cover several formats. */
export const FORMAT_GROUPS: { label: string; formats: Format[] }[] = [
  { label: 'PDF', formats: ['pdf'] },
  { label: 'EPUB', formats: ['epub'] },
  { label: 'Kindle (MOBI, AZW3)', formats: ['mobi', 'azw3'] },
  { label: 'FictionBook', formats: ['fb2', 'fbz'] },
  { label: 'Comics (CBZ, CBR)', formats: ['cbz', 'cbr'] },
  { label: 'Images', formats: ['image'] },
];

export const isDone = (b: Pick<Book, 'status' | 'progress'>): boolean => b.status === 'finished' || (b.progress ?? 0) >= 0.995;

/** Minutes left from the user's own speed, or null when the book's length is unknown. */
export function minutesLeft(b: Pick<Book, 'progress' | 'pageCount' | 'wordCount'>, speed: ReadingSpeed | null): number | null {
  if (!speed) return null;
  const left = 1 - Math.min(1, Math.max(0, b.progress ?? 0));
  if (b.wordCount) return (left * b.wordCount) / speed.wordsPerMinute;
  if (b.pageCount) return left * b.pageCount * speed.minutesPerPage;
  return null;
}

/** "12 min left", "2 h 10 min left", "Under a minute left". */
export function formatLeft(min: number | null): string | null {
  if (min == null || !Number.isFinite(min)) return null;
  if (min < 1) return 'Under a minute left';
  const m = Math.round(min);
  if (m < 60) return `${m} min left`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min left` : `${h} h left`;
}

/** "Just now", "12 min ago", "3 h ago", "2 d ago", "3 w ago", "4 mo ago", "2 y ago". */
export function ago(ts: number | null, now = Date.now()): string {
  if (!ts) return '';
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return 'Just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.floor(m)} min ago`;
  if (h < 24) return `${Math.floor(h)} h ago`;
  if (d < 7) return `${Math.floor(d)} d ago`;
  if (d < 30.44) return `${Math.floor(d / 7)} w ago`;
  if (d < 365.25) return `${Math.floor(d / 30.44)} mo ago`;
  return `${Math.floor(d / 365.25)} y ago`;
}

export const percent = (p: number | null | undefined): string => `${Math.round((p ?? 0) * 100)}%`;

/** Greeting for the hour. */
export function greeting(hour = new Date().getHours()): string {
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
