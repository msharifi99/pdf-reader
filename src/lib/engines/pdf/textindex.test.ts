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

describe('block breaks and glyph-measured quads', () => {
  const big = (str: string, y: number) => ({ str, transform: [24, 0, 0, 24, 72, y], width: 150, height: 24, hasEOL: true });
  const body = (str: string, y: number, width = 460) => ({ str, transform: [12, 0, 0, 12, 72, y], width, height: 12, hasEOL: true });

  it('a heading is its own chunk (size jump), also when the heading is body-sized but followed by a gap', async () => {
    const { splitBlocks } = await import('./textindex');
    const pt = buildPageText([big('Chapter 1', 700), body('The harbour pilot rose before dawn and walked down to the quay where the boats lay.', 660), body('Nobody else was awake yet.', 646, 150)], view);
    const chunks = splitBlocks(pt.text, 400, pt.breaks).map((c) => c.text.trim());
    expect(chunks[0]).toBe('Chapter 1');
    expect(chunks[1]).toMatch(/^The harbour pilot/);

    const pt2 = buildPageText([body('Part one', 700, 60), body('It began quietly.', 650)], view); // vertical gap, same size
    expect(splitBlocks(pt2.text, 400, pt2.breaks).map((c) => c.text.trim())).toEqual(['Part one', 'It began quietly.']);
  });

  it('a short line followed by a capital starts a new block; a wrapped paragraph does not', async () => {
    const { splitBlocks } = await import('./textindex');
    const pt = buildPageText(
      [body('A full line of text that runs across the entire measure of the column,', 700), body('and wraps onto the next line which is also long enough to count as full', 686), body('End.', 672, 30), body('Next paragraph begins here and goes on.', 658)],
      view,
    );
    const chunks = splitBlocks(pt.text, 400, pt.breaks).map((c) => c.text.trim());
    expect(chunks.some((c) => c.startsWith('Next paragraph'))).toBe(true);
    expect(chunks[0]).toContain('and wraps onto');
  });

  it('quads use per-glyph advances when measured: "reached" starts at the r, not one letter late', () => {
    // 'i' and 'l' are narrow, 'm' and 'w' wide: equal-width spreading would shift the box by about a letter
    const str = 'illiill reached';
    const w: Record<string, number> = { i: 0.25, l: 0.25, ' ': 0.3, r: 0.35, e: 0.55, a: 0.55, c: 0.5, h: 0.55, d: 0.55 };
    const cum = [0];
    for (const ch of str) cum.push(cum[cum.length - 1] + w[ch]);
    const total = cum[cum.length - 1];
    const measured = buildPageText([{ str, transform: [12, 0, 0, 12, 100, 700], width: 100, height: 12 }], view, () => cum.map((v) => v / total));
    const plain = buildPageText([{ str, transform: [12, 0, 0, 12, 100, 700], width: 100, height: 12 }], view);
    const start = str.indexOf('reached');
    const wantX = 100 + (100 * cum[start]) / total;
    expect(quadsFor(measured, start, str.length)[0][0]).toBeCloseTo(wantX, 5);
    expect(Math.abs(quadsFor(plain, start, str.length)[0][0] - wantX)).toBeGreaterThan(5); // the old uniform spreading was off
    const back = rangeForQuads(measured, quadsFor(measured, start, str.length))!;
    expect(measured.text.slice(back.start, back.end)).toBe('reached');
  });
});
