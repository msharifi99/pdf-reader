/**
 * A normalised plain-text view of a document body with exact mapping back to DOM positions.
 * Used for sentence chunking (read-aloud), quote anchors and fuzzy re-anchoring, and getText.
 *
 * Normalisation: whitespace runs collapse to one space; a "\n" separates blocks and <br>.
 * Every character of `text` maps to (text node, UTF-16 offset); "\n" separators map to nothing.
 */

const BLOCKS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP = new Set(['script', 'style', 'head', 'title', 'noscript', 'template']);
const WS = /[\s\u00a0\u2028\u2029]/;

export interface TextMap {
  text: string;
  nodes: Text[];
  /** text node -> index into `nodes` */
  nodeIndex: Map<Node, number>;
  /** per char: index into `nodes` (non-decreasing; a virtual "\n" carries the index of the node that follows it) */
  node: Int32Array;
  /** per char: offset inside that node, or VIRTUAL for a "\n" separator */
  offset: Uint32Array;
}

export const VIRTUAL = 0xffffffff;

const localName = (n: Node) => (n as Element).localName?.toLowerCase() ?? '';

function blockOf(n: Node, root: Node): Node {
  let el: Node | null = n.parentNode;
  while (el && el !== root) {
    if (BLOCKS.has(localName(el))) return el;
    el = el.parentNode;
  }
  return root;
}

export function buildTextMap(root: Node): TextMap {
  const doc = root.ownerDocument ?? (root as Document);
  const nodes: Text[] = [];
  const out: string[] = [];
  const nodeIx: number[] = [];
  const offs: number[] = [];
  let lastBlock: Node | null = null;
  let pendingBreak = false;

  const lastChar = () => out[out.length - 1];
  const addBreak = () => {
    if (!out.length || lastChar() === '\n') return;
    if (lastChar() === ' ') {
      out.pop();
      nodeIx.pop();
      offs.pop();
    }
    out.push('\n');
    nodeIx.push(nodes.length);
    offs.push(VIRTUAL);
  };

  const walker = doc.createTreeWalker(root, 0x1 | 0x4, {
    acceptNode: (n) => (n.nodeType === 1 && SKIP.has(localName(n)) ? 2 : 1),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 1) {
      if (localName(n) === 'br') pendingBreak = true;
      continue;
    }
    const data = (n as Text).data;
    if (!data) continue;
    const block = blockOf(n, root);
    if (block !== lastBlock || pendingBreak) {
      if (out.length) addBreak();
      lastBlock = block;
      pendingBreak = false;
    }
    const ni = nodes.length;
    nodes.push(n as Text);
    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      if (WS.test(c)) {
        const last = lastChar();
        if (last === undefined || last === ' ' || last === '\n') continue;
        out.push(' ');
      } else out.push(c);
      nodeIx.push(ni);
      offs.push(i);
    }
  }
  while (out.length && (lastChar() === ' ' || lastChar() === '\n')) {
    out.pop();
    nodeIx.pop();
    offs.pop();
  }
  return { text: out.join(''), nodes, nodeIndex: new Map(nodes.map((n, i) => [n, i])), node: Int32Array.from(nodeIx), offset: Uint32Array.from(offs) };
}

/** Text offset of a DOM point (node, offset); clamps into the map. */
/** `end`: a range end (keep a following separator out of the span instead of skipping past it). */
export function textOffsetOf(map: TextMap, node: Node, offset: number, end = false): number {
  if (node.nodeType === 3) {
    const ni = map.nodeIndex.get(node) ?? -1;
    if (ni >= 0) {
      // first char of this node whose offset >= `offset`
      let lo = 0;
      let hi = map.text.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const c = map.node[mid]!;
        if (c < ni || (c === ni && map.offset[mid]! < offset)) lo = mid + 1;
        else hi = mid;
      }
      if (!end) while (lo < map.text.length && map.offset[lo] === VIRTUAL) lo++;
      return lo;
    }
  }
  // Element boundary: find the first mapped text node at/after (container, offset).
  const doc = node.ownerDocument ?? (node as Document);
  const probe = doc.createRange();
  try {
    probe.setStart(node, offset);
  } catch {
    return 0;
  }
  for (let ni = 0; ni < map.nodes.length; ni++) {
    const t = map.nodes[ni]!;
    if (probe.comparePoint(t, 0) >= 0) {
      // skip nodes that contributed no characters (whitespace-only) and separators
      let at = map.node.indexOf(ni);
      while (at >= 0 && at < map.text.length && map.offset[at] === VIRTUAL) at++;
      if (at >= 0 && at < map.text.length) return at;
    }
  }
  return map.text.length;
}

/** DOM range for text span [start, end). Skips virtual separators at the edges. */
export function rangeOfText(map: TextMap, doc: Document, start: number, end: number): Range | null {
  start = Math.max(0, start);
  end = Math.min(map.text.length, end);
  while (start < end && map.offset[start] === VIRTUAL) start++;
  while (end > start && map.offset[end - 1] === VIRTUAL) end--;
  if (end <= start) return null;
  const r = doc.createRange();
  r.setStart(map.nodes[map.node[start]!]!, map.offset[start]!);
  r.setEnd(map.nodes[map.node[end - 1]!]!, map.offset[end - 1]! + 1);
  return r;
}

export const normaliseWs = (s: string) => s.replace(/[\s\u00a0]+/g, ' ').trim();

/**
 * Fuzzy locate `quote` in `text`, preferring the occurrence whose surroundings best match
 * prefix/suffix and which is closest to `near`. Returns [start, end) or null.
 */
export function findQuote(
  text: string,
  quote: { exact: string; prefix?: string; suffix?: string },
  near = 0,
): [number, number] | null {
  const exact = normaliseWs(quote.exact);
  if (!exact) return null;
  const hits: number[] = [];
  for (let i = text.indexOf(exact); i >= 0; i = text.indexOf(exact, i + 1)) hits.push(i);
  // context is collapsed but not trimmed: its edge spaces are part of the match
  const collapse = (s: string) => s.replace(/[\s\u00a0]+/g, ' ');
  const prefix = collapse(quote.prefix ?? '');
  const suffix = collapse(quote.suffix ?? '');
  const score = (at: number) => {
    let s = 0;
    for (let k = 1; k <= prefix.length && text[at - k] === prefix[prefix.length - k]; k++) s++;
    for (let k = 0; k < suffix.length && text[at + exact.length + k] === suffix[k]; k++) s++;
    return s;
  };
  if (hits.length) {
    const best = hits.reduce((a, b) => {
      const d = score(b) - score(a);
      return d > 0 || (d === 0 && Math.abs(b - near) < Math.abs(a - near)) ? b : a;
    });
    return [best, best + exact.length];
  }
  // Edited passage: anchor on the first and last 40 characters.
  if (exact.length > 80) {
    const head = text.indexOf(exact.slice(0, 40));
    const tail = text.lastIndexOf(exact.slice(-40));
    if (head >= 0 && tail > head) return [head, tail + 40];
  }
  return null;
}

/**
 * Split into sentence-ish chunks no longer than `max` chars: paragraph breaks ("\n") always end
 * a chunk, sentences are merged greedily, over-long sentences are cut at a space.
 */
export function chunkSentences(text: string, lang: string | undefined, max = 400): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let seg: Intl.Segmenter | null = null;
  try {
    seg = new Intl.Segmenter(lang || 'en', { granularity: 'sentence' });
  } catch {
    seg = null;
  }
  let at = 0;
  for (const para of text.split('\n')) {
    const base = at;
    at += para.length + 1;
    if (!para.trim()) continue;
    const sentences: Array<[number, number]> = [];
    if (seg) for (const s of seg.segment(para)) sentences.push([s.index, s.index + s.segment.length]);
    else for (const m of para.matchAll(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g)) sentences.push([m.index!, m.index! + m[0].length]);
    let cur: [number, number] | null = null;
    const push = (a: number, b: number) => spans.push([base + a, base + b]);
    for (const [a0, b0] of sentences) {
      const a = a0 + (para.slice(a0, b0).length - para.slice(a0, b0).trimStart().length);
      const b = a0 + para.slice(a0, b0).trimEnd().length;
      if (b <= a) continue;
      if (b - a > max) {
        if (cur) (push(cur[0], cur[1]), (cur = null));
        for (let x = a; x < b; ) {
          let y = Math.min(b, x + max);
          if (y < b) {
            const sp = para.lastIndexOf(' ', y);
            if (sp > x + max / 2) y = sp;
          }
          push(x, y);
          x = y;
          while (x < b && para[x] === ' ') x++;
        }
      } else if (cur && b - cur[0] <= max) cur[1] = b;
      else {
        if (cur) push(cur[0], cur[1]);
        cur = [a, b];
      }
    }
    if (cur) push(cur[0], cur[1]);
  }
  return spans;
}
