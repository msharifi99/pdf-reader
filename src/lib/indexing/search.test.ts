import { describe, expect, it } from 'vitest';
import { groupHits, parseSnippet } from './search';

describe('library search helpers', () => {
  it('splits a snippet into plain and matching segments', () => {
    expect(parseSnippet('…a <mark>b</mark> c <mark>d</mark>')).toEqual([
      { text: '…a ', match: false },
      { text: 'b', match: true },
      { text: ' c ', match: false },
      { text: 'd', match: true },
    ]);
    expect(parseSnippet('<mark>x</mark>')).toEqual([{ text: 'x', match: true }]);
  });

  it('groups hits by book in relevance order', () => {
    const loc = (page: number) => ({ kind: 'fixed', page });
    const g = groupHits([
      { bookId: 'a', bookTitle: 'A', locator: loc(1), snippet: '<mark>one</mark>' },
      { bookId: 'b', bookTitle: 'B', locator: loc(0), snippet: 'x <mark>two</mark>' },
      { bookId: 'a', bookTitle: 'A', locator: loc(4), snippet: '<mark>three</mark>' },
    ]);
    expect(g.map((b) => [b.bookId, b.hits.length])).toEqual([['a', 2], ['b', 1]]);
    expect(g[1].hits[0].text).toBe('x two');
  });
});
