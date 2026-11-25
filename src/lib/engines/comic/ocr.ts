/** Pure OCR-word geometry and text-offset helpers for comic pages. Words and quads are [x, y, w, h] in decoded-image pixels, origin top-left. */
import type { Anchor, OcrWord } from '../types';

export type Quad = number[];
export type Rotation = 0 | 90 | 180 | 270;

export const wordText = (ws: OcrWord[]): string => ws.map((w) => w.text).join(' ');

/** Start offset of each word within `wordText`. */
export function wordStarts(ws: OcrWord[]): number[] {
  let s = 0;
  return ws.map((w) => {
    const at = s;
    s += w.text.length + 1;
    return at;
  });
}

/** Inclusive word index range overlapping text offsets [start, end), or null. */
export function wordsInRange(ws: OcrWord[], start: number, end: number): [number, number] | null {
  const starts = wordStarts(ws);
  let a = -1;
  let b = -1;
  ws.forEach((w, i) => {
    if (starts[i]! + w.text.length > start && starts[i]! < end) {
      if (a < 0) a = i;
      b = i;
    }
  });
  return a < 0 ? null : [a, b];
}

/** One merged quad per text line over words i0..i1. */
export function quadsFor(ws: OcrWord[], i0: number, i1: number): Quad[] {
  const out: Quad[] = [];
  for (let i = i0; i <= i1; i++) {
    const w = ws[i]!;
    const l = out.at(-1);
    if (l && Math.abs(w.y + w.height / 2 - (l[1]! + l[3]! / 2)) < 0.5 * Math.max(l[3]!, w.height)) {
      const x2 = Math.max(l[0]! + l[2]!, w.x + w.width);
      const y1 = Math.min(l[1]!, w.y);
      const y2 = Math.max(l[1]! + l[3]!, w.y + w.height);
      l[0] = Math.min(l[0]!, w.x);
      l[1] = y1;
      l[2] = x2 - l[0];
      l[3] = y2 - y1;
    } else out.push([w.x, w.y, w.width, w.height]);
  }
  return out;
}

/** The box in the frame of the image rotated clockwise by `rot` degrees. */
export function rotateBox(rot: Rotation, W: number, H: number, [x, y, w, h]: Quad): Quad {
  switch (rot) {
    case 90: return [H - y - h, x, h, w];
    case 180: return [W - x - w, H - y - h, w, h];
    case 270: return [y, W - x - w, h, w];
    default: return [x, y, w, h];
  }
}

export function anchorFor(page: number, ws: OcrWord[], i0: number, i1: number, pageH: number): Anchor {
  const text = wordText(ws);
  const a = wordStarts(ws)[i0]!;
  const b = wordStarts(ws)[i1]! + ws[i1]!.text.length;
  const quads = quadsFor(ws, i0, i1);
  return {
    locator: { kind: 'fixed', page, y: Math.min(1, Math.max(0, quads[0]![1]! / (pageH || 1))) },
    quote: { exact: text.slice(a, b), prefix: text.slice(Math.max(0, a - 32), a), suffix: text.slice(b, b + 32) },
    pdfQuads: quads,
  };
}

/** Offset of the best occurrence of `quote.exact` in `text` (context-scored), or -1. */
export function findQuote(text: string, q: { exact: string; prefix: string; suffix: string }): number {
  if (!q.exact) return -1;
  let best = -1;
  let bestScore = -1;
  for (let i = text.indexOf(q.exact); i >= 0; i = text.indexOf(q.exact, i + 1)) {
    let s = 0;
    while (s < q.prefix.length && text[i - 1 - s] === q.prefix[q.prefix.length - 1 - s]) s++;
    const after = i + q.exact.length;
    let t = 0;
    while (t < q.suffix.length && text[after + t] === q.suffix[t]) t++;
    if (s + t > bestScore) (best = i), (bestScore = s + t);
  }
  return best;
}
