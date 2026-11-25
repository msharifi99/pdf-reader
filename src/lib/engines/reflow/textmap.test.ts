// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeNote, noteElement, noteRefKind, referencedType } from './footnotes';
import { buildTextMap, chunkSentences, findQuote, normaliseWs, rangeOfText, textOffsetOf, VIRTUAL } from './textmap';

const body = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

describe('buildTextMap', () => {
  it('collapses whitespace and separates blocks and <br> with a newline', () => {
    const map = buildTextMap(body('<h1>  Title </h1>\n<p>First   para<br/>line two</p><p>Second <em>em</em>phasis</p>'));
    expect(map.text).toBe('Title\nFirst para\nline two\nSecond emphasis');
  });

  it('skips script/style/head content', () => {
    const map = buildTextMap(body('<p>a</p><script>var x</script><style>p{}</style><p>b</p>'));
    expect(map.text).toBe('a\nb');
  });

  it('maps every real char back to its text node and offset; separators are VIRTUAL', () => {
    const map = buildTextMap(body('<p>ab</p><p>cd</p>'));
    expect(map.text).toBe('ab\ncd');
    expect(map.offset[2]).toBe(VIRTUAL);
    expect(map.nodes[map.node[3]!]!.data).toBe('cd');
    expect(map.offset[3]).toBe(0);
    expect(map.offset[4]).toBe(1);
    // node indices never decrease (binary search relies on it)
    for (let i = 1; i < map.node.length; i++) expect(map.node[i]!).toBeGreaterThanOrEqual(map.node[i - 1]!);
  });

  it('textOffsetOf / rangeOfText round-trip, across inline elements and into element boundaries', () => {
    const root = body('<p>Hello <b>brave</b> new world</p>');
    const map = buildTextMap(root);
    expect(map.text).toBe('Hello brave new world');
    const r = rangeOfText(map, document, 6, 11)!;
    expect(r.toString()).toBe('brave');
    expect(textOffsetOf(map, r.startContainer, r.startOffset)).toBe(6);
    expect(textOffsetOf(map, r.endContainer, r.endOffset, true)).toBe(11);
    expect(textOffsetOf(map, root, 0)).toBe(0); // element boundary -> first char
    const spanning = rangeOfText(map, document, 3, 15)!;
    expect(spanning.toString()).toBe('lo brave new');
  });

  it('a leading whitespace-only node does not break element-boundary lookups', () => {
    const root = body('\n   <h1>Heading</h1><p>Body</p>');
    const map = buildTextMap(root);
    expect(textOffsetOf(map, root, 0)).toBe(0);
    expect(map.text.slice(textOffsetOf(map, root, 0))).toBe('Heading\nBody');
  });

  it('rangeOfText skips separators at the edges', () => {
    const map = buildTextMap(body('<p>ab</p><p>cd</p>'));
    expect(rangeOfText(map, document, 2, 3)).toBeNull(); // just the separator
    expect(rangeOfText(map, document, 1, 4)!.toString()).toBe('bc');
  });
});

describe('findQuote', () => {
  const text = 'The cat sat. The dog sat. The cat ran. The dog ran away.';
  it('prefers the occurrence whose context matches', () => {
    const [a] = findQuote(text, { exact: 'The cat', prefix: 'sat. The dog sat. ', suffix: ' ran.' })!;
    expect(a).toBe(text.lastIndexOf('The cat'));
    const [b] = findQuote(text, { exact: 'The cat', prefix: '', suffix: ' sat' })!;
    expect(b).toBe(0);
  });
  it('breaks ties by distance to the hint, normalises whitespace, gives up when absent', () => {
    expect(findQuote(text, { exact: 'The   dog' }, 30)![0]).toBe(text.lastIndexOf('The dog'));
    expect(findQuote(text, { exact: 'nothing like this' })).toBeNull();
    expect(findQuote(text, { exact: '  ' })).toBeNull();
  });
  it('re-anchors an edited long passage on its first and last 40 chars', () => {
    const head = 'A'.repeat(40);
    const tail = 'Z'.repeat(40);
    const t = `xx ${head} middle was edited ${tail} yy`;
    const q = { exact: `${head} original middle text that differs ${tail}` };
    const hit = findQuote(t, q)!;
    expect(t.slice(hit[0], hit[1])).toBe(`${head} middle was edited ${tail}`);
  });
});

describe('chunkSentences', () => {
  it('splits on sentences and merges up to the limit', () => {
    const t = 'One. Two. Three here. Four five six seven.';
    const spans = chunkSentences(t, 'en', 20);
    expect(spans.map(([a, b]) => t.slice(a, b))).toEqual(['One. Two.', 'Three here.', 'Four five six seven.']);
  });
  it('never merges across paragraphs', () => {
    const t = 'Alpha.\nBeta.';
    expect(chunkSentences(t, 'en', 400).map(([a, b]) => t.slice(a, b))).toEqual(['Alpha.', 'Beta.']);
  });
  it('cuts an over-long sentence at spaces', () => {
    const t = `${'word '.repeat(60)}end.`;
    const spans = chunkSentences(t, 'en', 50);
    expect(spans.length).toBeGreaterThan(4);
    for (const [a, b] of spans) {
      expect(b - a).toBeLessThanOrEqual(50);
      expect(t.slice(a, b)).toBe(t.slice(a, b).trim());
    }
  });
  it('is robust to empty input', () => {
    expect(chunkSentences('', 'en')).toEqual([]);
    expect(chunkSentences('\n\n', 'en')).toEqual([]);
  });
});

describe('normaliseWs', () => {
  it('collapses runs including nbsp', () => {
    expect(normaliseWs('  a   b\n c ')).toBe('a b c');
  });
});

describe('footnotes', () => {
  beforeEach(() => body(''));

  it('sanitises to an attribute-free allow-list: no links, media, scripts, backlinks, handlers', () => {
    const root = body(
      `<aside id="fn1" class="x" style="color:red" onclick="evil()"><p onmouseover="x()">1. A <a href="javascript:alert(1)">bad</a> <em>noted</em> thing<script>alert(1)</script>
       <img src="x.png"/><a href="#back" role="doc-backlink">↩</a></p><h3>Head</h3><ul><li>item</li></ul></aside>`,
    );
    const html = sanitizeNote(root.firstElementChild!);
    expect(html).toContain('<em>noted</em>');
    expect(html).toContain('bad');
    expect(html).toContain('<li>item</li>');
    expect(html).toContain('<p>Head</p>'); // headings flattened
    expect(html).not.toMatch(/<(a|img|script|aside)\b/);
    expect(html).not.toMatch(/\s(href|src|class|style|id|on\w+)=/);
    expect(html).not.toContain('alert');
    expect(html).not.toContain('↩');
  });

  it('wraps bare text in a paragraph', () => {
    const root = body('<span id="n">just text</span>');
    expect(sanitizeNote(root.firstElementChild!)).toBe('<p>just text</p>');
  });

  it('noteElement picks the list item / aside, climbs inline wrappers, rejects an empty body target', () => {
    const root = body('<ol><li id="a"><span id="b">text</span></li></ol><p id="p"><sup id="s">1</sup> note text</p>');
    expect(noteElement(root.querySelector('#b'))!.id).toBe('a');
    expect(noteElement(root.querySelector('#s'))!.id).toBe('p');
    expect(noteElement(null)).toBeNull();
  });

  it('detects declared note references by role', () => {
    const root = body('<a id="r" role="doc-noteref" href="#n">1</a><a id="x" href="#y">plain</a>');
    expect(noteRefKind(root.querySelector('#r')!).yes).toBe(true);
    expect(noteRefKind(root.querySelector('#x')!).yes).toBe(false);
    expect(noteRefKind(root.querySelector('#x')!).maybe()).toBe(false);
    body('<sup><a id="y" href="#n">1</a></sup>');
    expect(noteRefKind(document.getElementById('y')!).maybe()).toBe(true);
  });

  it('classifies referenced notes', () => {
    const root = body('<aside id="a" role="doc-endnote"></aside><aside id="b" role="doc-footnote"></aside><div id="c"></div>');
    expect(referencedType(root.querySelector('#a'))).toBe('endnote');
    expect(referencedType(root.querySelector('#b'))).toBe('footnote');
    expect(referencedType(root.querySelector('#c'))).toBeNull();
  });
});
