import { describe, expect, it } from 'vitest';
import { isPageName, naturalCompare, sortPages } from './pages';
import { parseComicInfo } from './comicinfo';
import { buildSpreads, spreadIndexOf } from './pairing';
import { ByteLru } from '../pdf/lru';

describe('natural sort', () => {
  it('orders numbers by value and files before nested folders', () => {
    expect(['p10.png', 'p2.png', 'p1.png', 'P3.png'].sort(naturalCompare)).toEqual(['p1.png', 'p2.png', 'P3.png', 'p10.png']);
    expect(['b/1.png', 'a/10.png', 'a/9.png', 'cover.png'].sort(naturalCompare)).toEqual(['cover.png', 'a/9.png', 'a/10.png', 'b/1.png']);
  });
  it('drops junk and keeps images', () => {
    const names = ['__MACOSX/._1.png', 'Thumbs.db', '.hidden.png', 'ComicInfo.xml', 'notes.txt', 'b.JPG', 'a.png', 'x/c.svg', 'd.tif'];
    expect(sortPages(names)).toEqual(['a.png', 'b.JPG', 'x/c.svg']);
    expect(isPageName('folder/')).toBe(false);
  });
});

describe('ComicInfo', () => {
  const xml = `<?xml version="1.0"?><ComicInfo><Title>A &amp; B</Title><Series>S</Series><Number>3</Number><Writer>W</Writer>
    <Year>2020</Year><Manga>YesAndRightToLeft</Manga>
    <Pages><Page Image="0" Type="FrontCover" ImageWidth="800" ImageHeight="1200"/><Page Image="4" Bookmark="Chapter &quot;2&quot;"/></Pages></ComicInfo>`;
  it('parses fields, direction, pages', () => {
    const i = parseComicInfo(xml);
    expect(i).toMatchObject({ title: 'A & B', series: 'S', number: '3', writer: 'W', year: 2020, rtl: true });
    expect(i.pages).toEqual([
      { image: 0, type: 'FrontCover', bookmark: undefined, width: 800, height: 1200 },
      { image: 4, type: undefined, bookmark: 'Chapter "2"', width: undefined, height: undefined },
    ]);
  });
  it('defaults to ltr', () => {
    expect(parseComicInfo('<ComicInfo><Manga>Yes</Manga></ComicInfo>').rtl).toBe(false);
    expect(parseComicInfo('').pages).toEqual([]);
  });
});

describe('spread pairing', () => {
  it('cover alone, wide pages alone, re-pair after a spread', () => {
    const wide = new Set([5]);
    expect(buildSpreads(10, (i) => wide.has(i), true)).toEqual([[0], [1, 2], [3, 4], [5], [6, 7], [8, 9]]);
  });
  it('a wide second page splits the pair', () => {
    expect(buildSpreads(5, (i) => i === 2, true)).toEqual([[0], [1], [2], [3, 4]]);
  });
  it('single mode and odd tails', () => {
    expect(buildSpreads(3, () => false, false)).toEqual([[0], [1], [2]]);
    expect(buildSpreads(4, () => false, true)).toEqual([[0], [1, 2], [3]]);
    expect(buildSpreads(0, () => false, true)).toEqual([]);
  });
  it('finds the spread of a page', () => {
    const s = buildSpreads(6, () => false, true);
    expect(spreadIndexOf(s, 2)).toBe(1);
    expect(spreadIndexOf(s, 99)).toBe(s.length - 1);
  });
});

describe('bitmap LRU', () => {
  it('evicts oldest past budget and reports evictions', () => {
    const gone: number[] = [];
    const l = new ByteLru<number, string>(10, (k) => gone.push(k));
    l.set(1, 'a', 4);
    l.set(2, 'b', 4);
    l.get(1);
    l.set(3, 'c', 4);
    expect(gone).toEqual([2]);
    expect(l.has(1) && l.has(3)).toBe(true);
  });
});
