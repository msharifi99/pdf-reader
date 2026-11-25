import { describe, expect, it } from 'vitest';
import type { Anchor, Engine, SearchHit } from '../engines/types';
import { bestCandidate, reanchor, scoreCandidate, similarity, type Candidate } from './reanchor';

const at = (page: number, exact: string, prefix = '', suffix = ''): Anchor => ({ locator: { kind: 'fixed', page, y: 0 }, quote: { exact, prefix, suffix } });

describe('similarity', () => {
  it('ignores case and whitespace, and degrades with edits', () => {
    expect(similarity('The  quick\nbrown fox', 'the quick brown fox')).toBe(1);
    expect(similarity('the quick brown fox', 'the quick brown box')).toBeGreaterThan(0.9);
    expect(similarity('the quick brown fox', 'an entirely different line')).toBeLessThan(0.5);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('bestCandidate', () => {
  const target = at(10, 'all happy families are alike', 'It begins: ', '; each unhappy one');

  it('rejects text that is not the quote', () => {
    expect(scoreCandidate(target, { anchor: at(10, 'unrelated words entirely here') })).toBeNull();
    expect(bestCandidate(target, [{ anchor: at(10, 'unrelated words entirely here') }])).toBeNull();
  });

  it('prefers the occurrence whose surroundings match the stored prefix and suffix', () => {
    const far: Candidate = { anchor: at(40, 'all happy families are alike'), before: 'It begins: ', after: '; each unhappy one is' };
    const near: Candidate = { anchor: at(11, 'all happy families are alike'), before: 'Nobody said ', after: ' in this house.' };
    expect(bestCandidate(target, [near, far], 50)).toBe(far);
  });

  it('breaks ties by closeness to the old locator', () => {
    const a: Candidate = { anchor: at(48, 'all happy families are alike') };
    const b: Candidate = { anchor: at(12, 'all happy families are alike') };
    expect(bestCandidate(target, [a, b], 50)).toBe(b);
  });

  it('accepts a lightly edited quote (a fixed typo)', () => {
    const c: Candidate = { anchor: at(3, 'all happy familes are alike') };
    expect(bestCandidate(target, [c], 50)).toBe(c);
  });
});

describe('reanchor', () => {
  const engine = (resolved: unknown, hits: SearchHit[] = []) =>
    ({
      anchorToRanges: async () => resolved,
      async *search() {
        yield* hits;
      },
    }) as unknown as Engine;
  const hit = (page: number, before: string, match: string, after: string): SearchHit => ({ locator: { kind: 'fixed', page }, excerpt: { before, match, after }, anchor: at(page, match) });

  it('is ok when the engine resolves exactly, and repairs with the engine update', async () => {
    const a = at(2, 'a quote');
    expect(await reanchor(engine({ regions: [], exact: true }), a)).toEqual({ status: 'ok' });
    const upd = at(3, 'a quote');
    expect(await reanchor(engine({ regions: [], exact: false, updated: upd }), a)).toEqual({ status: 'repaired', anchor: upd });
  });

  it('finds a quote that moved far away by searching the book', async () => {
    const a = at(1, 'the lamp went out', 'and then ', ' at last');
    const r = await reanchor(engine(null, [hit(7, 'nothing ', 'the lamp went out', ' here'), hit(30, 'and then ', 'the lamp went out', ' at last.')]), a, { search: true, pageCount: 40 });
    expect(r.status).toBe('repaired');
    if (r.status === 'repaired') {
      expect(r.anchor.locator).toEqual({ kind: 'fixed', page: 30, y: 0 });
      expect(r.anchor.quote.exact).toBe('the lamp went out');
    }
  });

  it('leaves an unmatched annotation orphaned', async () => {
    expect(await reanchor(engine(null, []), at(1, 'gone for good'), { search: true })).toEqual({ status: 'orphaned' });
    expect(await reanchor(engine(null), at(1, 'gone for good'))).toEqual({ status: 'orphaned' });
  });

  it('never re-anchors bookmarks', async () => {
    expect(await reanchor(engine(null), at(4, ''))).toEqual({ status: 'ok' });
  });
});
