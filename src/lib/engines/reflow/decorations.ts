/** Decoration styles -> foliate Overlayer draw functions (SVG drawn over the section iframe). */
import { Overlayer } from 'foliate-js/overlayer.js';
import type { DecorationStyle, Theme } from '../types';

export interface DrawSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draw: (rects: any[], options?: any) => SVGElement;
  options: Record<string, unknown>;
}

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag: string) => document.createElementNS(SVG, tag);

interface R {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Highlight plus a small dot at the end of the span: "this one has a note". */
function noteMarker(rects: R[], o: { color: string; marker: string }): SVGElement {
  const g = Overlayer.highlight(rects, { color: o.color }) as SVGElement;
  const last = rects[rects.length - 1];
  if (last) {
    const c = el('circle');
    c.setAttribute('cx', String(last.right + 5));
    c.setAttribute('cy', String(last.top + 4));
    c.setAttribute('r', '3');
    c.setAttribute('fill', o.marker);
    c.style.opacity = '.9';
    g.append(c);
  }
  return g;
}

/** A small ribbon at the top-right of the first line of the span. */
function bookmark(rects: R[], o: { color: string }): SVGElement {
  const g = el('g');
  const first = rects[0];
  if (first) {
    const p = el('path');
    const x = first.left;
    const y = first.top;
    p.setAttribute('d', `M${x - 4} ${y - 2}h8v12l-4-3-4 3z`);
    p.setAttribute('fill', o.color);
    g.append(p);
  }
  return g;
}

/** Accent-coloured highlight that must not hide the text under it. */
const softAccent = (rects: R[], o: { color: string; padding?: number; opacity?: number }): SVGElement => {
  const g = Overlayer.highlight(rects, o) as SVGElement;
  g.style.opacity = String(o.opacity ?? 0.4);
  return g;
};

/** Read-aloud (T13): accent wash, rounded, plus a 2px underline for the word. Never a highlight colour, so it can't be mistaken for one. */
function speechMark(rects: R[], o: { color: string; fill: number; underline: boolean }): SVGElement {
  const g = el('g');
  g.setAttribute('fill', o.color);
  for (const r of rects) {
    const bg = el('rect');
    for (const [k, v] of Object.entries({ x: r.left - 1.5, y: r.top, width: r.width + 3, height: r.height, rx: 3, 'fill-opacity': o.fill })) bg.setAttribute(k, String(v));
    g.append(bg);
    if (!o.underline) continue;
    const u = el('rect');
    for (const [k, v] of Object.entries({ x: r.left - 1.5, y: r.bottom - 2, width: r.width + 3, height: 2, rx: 1, 'fill-opacity': 0.85 })) u.setAttribute(k, String(v));
    g.append(u);
  }
  return g;
}

export function drawFor(style: DecorationStyle, theme: Theme): DrawSpec {
  switch (style.type) {
    case 'highlight':
      return { draw: Overlayer.highlight, options: { color: theme.highlight[style.color] } };
    case 'underline':
      return { draw: Overlayer.underline, options: { color: theme.highlight[style.color], width: 2, padding: 1 } };
    case 'note':
      return { draw: noteMarker, options: { color: theme.highlight[style.color], marker: theme.accent } };
    case 'bookmark':
      return { draw: bookmark, options: { color: theme.accent } };
    case 'search-hit':
      return style.current
        ? { draw: softAccent, options: { color: theme.accent, padding: 1 } }
        : { draw: softAccent, options: { color: theme.accent, padding: 1, opacity: 0.16 } }; // a faint wash: every match visible, none shouting
    case 'speech-word':
      return { draw: speechMark, options: { color: theme.accent, fill: 0.26, underline: true } };
    case 'speech-sentence':
      return { draw: speechMark, options: { color: theme.accent, fill: 0.09, underline: false } };
  }
}
