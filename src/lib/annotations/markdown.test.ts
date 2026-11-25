import { describe, expect, it } from 'vitest';
import { exportFileName, formatQuote, toMarkdown, type Placed } from './markdown';
import type { Ann } from './model';

const ann = (p: Partial<Ann>): Ann => ({
  id: 'x',
  bookId: 'b',
  type: 'highlight',
  color: 'yellow',
  anchor: { locator: { kind: 'fixed', page: 0 }, quote: { exact: '', prefix: '', suffix: '' } },
  note: null,
  label: null,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  ...p,
});
const q = (exact: string) => ({ locator: { kind: 'fixed' as const, page: 0 }, quote: { exact, prefix: '', suffix: '' } });

describe('toMarkdown', () => {
  it('writes front matter, chapter headings, quotes, notes, references, colour tags and bookmarks', () => {
    const items: Placed[] = [
      { ann: ann({ anchor: q('Call me Ishmael.'), color: 'green' }), chapter: 'Loomings', where: 'p. 1' },
      { ann: ann({ type: 'note', anchor: q('Whenever I find myself\ngrowing grim'), color: 'pink', note: 'The mood.\nSecond line.' }), chapter: 'Loomings', where: 'p. 2' },
      { ann: ann({ type: 'bookmark', label: 'Back here' }), chapter: 'The Carpet-Bag', where: 'p. 9' },
    ];
    expect(toMarkdown({ title: 'Moby: Dick', author: 'Herman Melville', format: 'pdf' }, items, new Date(2026, 10, 5))).toBe(
      [
        '---',
        'title: "Moby: Dick"',
        'author: "Herman Melville"',
        'format: pdf',
        'exported: 2026-11-05',
        'tags: [quire]',
        '---',
        '',
        '# Moby: Dick',
        '',
        '*Herman Melville*',
        '',
        '## Loomings',
        '',
        '> Call me Ishmael.',
        '',
        'p. 1 · #highlight/green',
        '',
        '> Whenever I find myself',
        '> growing grim',
        '',
        'The mood.\nSecond line.',
        '',
        'p. 2 · #highlight/pink',
        '',
        '## The Carpet-Bag',
        '',
        '- **Bookmark**: Back here · p. 9',
        '',
      ].join('\n'),
    );
  });
});

describe('formatQuote', () => {
  it('cites author, title and place', () => {
    expect(formatQuote('  It was\nthe best of times ', { title: 'A Tale of Two Cities', author: 'Charles Dickens' }, 'p. 3')).toBe('“It was the best of times”\n— Charles Dickens, *A Tale of Two Cities*, p. 3');
    expect(formatQuote('x', { title: 'T', author: '' }, 'Chapter 2')).toBe('“x”\n— *T*, Chapter 2');
  });
  it('makes safe file names', () => {
    expect(exportFileName('What? A/B: "C"')).toBe('What AB C - highlights.md');
  });
});
