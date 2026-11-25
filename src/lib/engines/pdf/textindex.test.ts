import { describe, expect, it } from 'vitest';
import { buildPageText, findAll, fuzzyFind, makeQuote, normalizeQuery, quadsFor, rangeForQuads, splitSentences } from './textindex';

const item = (str: string, x: number, y: number, width: number, eol = false) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL: eol });
const view = [0, 0, 612, 792];

describe('page text index', () => {
  const pt = buildPageText([item('The lighthouse', 72, 700, 84), item('keeper climbed', 72, 686, 80, true), item('the stair.', 72, 672, 60)], view);
  it('joins lines with spaces and indexes items', () => {
    expect(pt.text).toBe('The lighthouse keeper climbed the stair.');
    expect(pt.items).toHaveLength(3);
  });
  it('finds matches case-insensitively across items, whole-word aware', () => {
    const q = normalizeQuery('Lighthouse Keeper', false);
    expect(findAll(pt.text, q)).toEqual([{ start: 4, end: 21 }]);
    expect(findAll('keepers keep', 'keep', { wholeWord: true })).toEqual([{ start: 8, end: 12 }]);
    expect(findAll('Aa aa', 'aa', { caseSensitive: true })).toEqual([{ start: 3, end: 5 }]);
  });
  it('quads split per line and quadsFor/rangeForQuads agree', () => {
    const quads = quadsFor(pt, 4, 21);
    expect(quads).toHaveLength(2);
    expect(quads[0][1]).toBeLessThan(quads[1][1]); // first line is higher on the page (smaller y)
    const r = rangeForQuads(pt, quads)!;
    expect(pt.text.slice(r.start, r.end).trim()).toContain('keeper');
  });
});

describe('fuzzy re-anchoring', () => {
  const text = 'Alpha beta gamma. The sea had gone the colour of slate and gulls settled. Delta. The sea had gone dark.';
  it('prefers the occurrence whose context matches', () => {
    const quote = { exact: 'The sea had gone', prefix: 'settled. Delta. ', suffix: ' dark.' };
    const m = fuzzyFind(text, quote)!;
    expect(m.exact).toBe(true);
    expect(text.slice(m.start, m.end + 5)).toBe('The sea had gone dark');
  });
  it('tolerates small edits', () => {
    const m = fuzzyFind(text, { exact: 'the colour of slat and gulls settled', prefix: '', suffix: '' })!;
    expect(m.exact).toBe(false);
    expect(text.slice(m.start, m.end)).toContain('colour of slate');
  });
  it('returns null when nothing resembles the quote', () => {
    expect(fuzzyFind(text, { exact: 'completely unrelated sentence here', prefix: '', suffix: '' })).toBeNull();
  });
  it('makeQuote captures context', () => {
    const q = makeQuote(text, 6, 10);
    expect(q.exact).toBe('beta');
    expect(q.prefix).toBe('Alpha ');
  });
});

describe('splitSentences', () => {
  it('splits on sentence ends and caps chunk size', () => {
    const parts = splitSentences('One. Two! Three? ' + 'word '.repeat(200), 100);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.text.length <= 100)).toBe(true);
    expect(parts.map((p) => p.text).join('').replace(/\s+/g, ' ').trim().startsWith('One. Two!')).toBe(true);
  });
});
