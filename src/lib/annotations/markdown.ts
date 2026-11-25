/** Markdown export (story 97, Obsidian-friendly) and "copy as quote" (story 98). Pure: no DOM, no core. */
import { asColor, type Ann } from './model';

export interface BookInfo {
  title: string;
  author: string;
  format: string;
}

/** One annotation with where it sits, in reading order. */
export interface Placed {
  ann: Ann;
  /** chapter title, '' when the book has no contents */
  chapter: string;
  /** "p. 12" or "34%" */
  where: string;
}

const yaml = (s: string) => JSON.stringify(s); // a JSON string is a valid double-quoted YAML scalar
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const quoteBlock = (s: string) =>
  s
    .trim()
    .split(/\r?\n/)
    .map((l) => (l.trim() ? `> ${l.trim()}` : '>'))
    .join('\n');

export function toMarkdown(book: BookInfo, items: Placed[], exported: Date): string {
  const date = `${exported.getFullYear()}-${String(exported.getMonth() + 1).padStart(2, '0')}-${String(exported.getDate()).padStart(2, '0')}`;
  const out: string[] = ['---', `title: ${yaml(book.title)}`, `author: ${yaml(book.author)}`, `format: ${book.format}`, `exported: ${date}`, 'tags: [quire]', '---', '', `# ${oneLine(book.title)}`];
  if (book.author) out.push('', `*${oneLine(book.author)}*`);
  let chapter: string | null = null;
  for (const { ann, chapter: ch, where } of items) {
    if (ch !== chapter) {
      chapter = ch;
      if (ch) out.push('', `## ${oneLine(ch)}`);
    }
    out.push('');
    if (ann.type === 'bookmark') {
      out.push(`- **Bookmark**${ann.label ? `: ${oneLine(ann.label)}` : ''} · ${where}`);
      continue;
    }
    out.push(quoteBlock(ann.anchor.quote.exact || '…'));
    if (ann.note?.trim()) out.push('', ann.note.trim());
    out.push('', `${where} · #highlight/${asColor(ann.color)}`);
  }
  return out.join('\n') + '\n';
}

/** “Quote” — Author, *Title*, p. 12 (or the chapter for reflowable books). */
export function formatQuote(text: string, book: { title: string; author: string }, ref: string): string {
  const cite = [book.author.trim(), `*${oneLine(book.title)}*`, ref].filter(Boolean).join(', ');
  return `“${oneLine(text)}”\n— ${cite}`;
}

/** A file name for the export: "Title - highlights.md", without characters Windows forbids. */
export const exportFileName = (title: string): string => `${oneLine(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').slice(0, 120) || 'Book'} - highlights.md`;
