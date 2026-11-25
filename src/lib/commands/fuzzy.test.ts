import { describe, expect, it } from 'vitest';
import { COMMAND_TABLE } from './commandIds';
import { fuzzyMatch, rankItems } from './fuzzy';

const titles = COMMAND_TABLE.map((c) => c.title);
const top = (q: string, items: string[] = titles, n = 1) => rankItems(items, q, { fields: (s) => s }).slice(0, n).map((r) => r.item);

describe('fuzzyMatch', () => {
  it('requires subsequence, case-insensitive', () => {
    expect(fuzzyMatch('tfm', 'Toggle focus mode')).not.toBeNull();
    expect(fuzzyMatch('TFM', 'Toggle focus mode')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Toggle focus mode')).toBeNull();
    expect(fuzzyMatch('fm', 'Toggle focus mode')!.indices.length).toBe(2);
  });
  it('returns valid, increasing indices that spell the pattern', () => {
    const text = 'Toggle focus mode';
    const r = fuzzyMatch('tgl foc', text)!;
    expect(r.indices).toEqual([...r.indices].sort((a, b) => a - b));
    const picked = r.indices.map((i) => text[i]!.toLowerCase()).join('');
    expect(picked).toBe('tglfoc');
  });
  it('empty query matches everything with no indices', () => {
    expect(fuzzyMatch('', 'abc')).toEqual({ score: 0, indices: [] });
  });
  it('prefers consecutive and word-boundary matches', () => {
    expect(fuzzyMatch('fit', 'Fit page')!.score).toBeGreaterThan(fuzzyMatch('fit', 'Reflow it')!.score);
    expect(fuzzyMatch('nc', 'Next chapter')!.score).toBeGreaterThan(fuzzyMatch('nc', 'Znacz')!.score);
    expect(fuzzyMatch('ob', 'fooBar')!.score).toBeLessThan(fuzzyMatch('bar', 'fooBar')!.score);
    expect(fuzzyMatch('gb', 'getBook')!.indices).toEqual([0, 3]); // camelCase hump
  });
  it('exact-case uppercase pattern char scores slightly higher', () => {
    expect(fuzzyMatch('T', 'Toggle')!.score).toBeGreaterThan(fuzzyMatch('T', 'toggle')!.score);
  });
  it('multi-term is AND', () => {
    expect(fuzzyMatch('tgl zzz', 'Toggle focus mode')).toBeNull();
    expect(fuzzyMatch('focus toggle', 'Toggle focus mode')).not.toBeNull();
  });
});

describe('rankItems', () => {
  it('"tgl foc" ranks "Toggle focus mode" first', () => {
    expect(top('tgl foc')).toEqual(['Toggle focus mode']);
  });
  it('sensible top hits', () => {
    expect(top('zoom in')[0]).toBe('Zoom in');
    expect(top('fullscr')[0]).toBe('Toggle fullscreen');
    expect(top('hl pink')[0]).toBe('Highlight pink');
    expect(top('settings')[0]).toBe('Open settings');
    expect(top('next page')[0]).toBe('Next page');
  });
  it('matches on keywords/secondary fields, ranked below title hits', () => {
    const items = [{ t: 'Toggle focus mode', k: 'zen' }, { t: 'Zen garden', k: '' }];
    const r = rankItems(items, 'zen', { fields: (i) => [i.t, i.k] });
    expect(r.map((x) => x.item.t)).toEqual(['Zen garden', 'Toggle focus mode']);
    expect(r[1]!.indices).toEqual([]);
  });
  it('MRU boosts ties and orders the empty query', () => {
    const items = ['Open file', 'Open folder', 'Open settings'];
    const rank = { 'Open settings': 0, 'Open file': 1 } as Record<string, number>;
    const empty = rankItems(items, '', { fields: (s) => s, recency: (s) => rank[s] });
    expect(empty.map((r) => r.item)).toEqual(['Open settings', 'Open file', 'Open folder']);
    const q = rankItems(items, 'open', { fields: (s) => s, recency: (s) => rank[s] });
    expect(q[0]!.item).toBe('Open settings');
  });
  it('limit and indices for highlighting', () => {
    const r = rankItems(titles, 'a', { fields: (s) => s, limit: 3 });
    expect(r).toHaveLength(3);
    expect(r[0]!.indices.length).toBe(1);
  });
  it('performance: 1000 items per keystroke well under 5 ms', () => {
    const words = ['toggle', 'focus', 'mode', 'next', 'previous', 'page', 'chapter', 'zoom', 'fit', 'width', 'highlight', 'bookmark', 'library', 'settings', 'search', 'export'];
    const items = Array.from({ length: 1000 }, (_, i) => `${words[i % 16]} ${words[(i * 7) % 16]} ${words[(i * 3 + 1) % 16]} ${i}`);
    for (let i = 0; i < 20; i++) rankItems(items, 'tgl foc', { fields: (s) => s }); // warm up the JIT
    let best = Infinity;
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      for (const q of ['t', 'tg', 'tgl', 'tgl f', 'tgl foc']) rankItems(items, q, { fields: (s) => s });
      best = Math.min(best, (performance.now() - t) / 5);
    }
    expect(best).toBeLessThan(5);
  });
});
