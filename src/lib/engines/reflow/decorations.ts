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
const softAccent = (rects: R[], o: { color: string; padding?: number }): SVGElement => {
  const g = Overlayer.highlight(rects, o) as SVGElement;
  g.style.opacity = '.4';
  return g;
};

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
        : { draw: Overlayer.outline, options: { color: theme.accent, width: 1.5, padding: 1, radius: 3 } };
    case 'speech-word':
      return { draw: softAccent, options: { color: theme.accent, padding: 1 } };
    case 'speech-sentence':
      return { draw: Overlayer.highlight, options: { color: theme.highlight[2] } };
  }
}
