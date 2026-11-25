import { OPS } from 'pdfjs-dist';
import type { NormRect } from './tint';

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
];

/** Rotate a normalised top-left-origin rect clockwise by `deg` (0/90/180/270). */
export function rotateNormRect(r: NormRect, deg: number): NormRect {
  switch (((deg % 360) + 360) % 360) {
    case 90: return [1 - r[3], r[0], 1 - r[1], r[2]];
    case 180: return [1 - r[2], 1 - r[3], 1 - r[0], 1 - r[1]];
    case 270: return [r[1], 1 - r[2], r[3], 1 - r[0]];
    default: return r;
  }
}

/**
 * Bounding boxes of the raster images drawn by an operator list, as 0..1 rects of the page
 * (origin top-left, page as displayed at `rotate` degrees). Image masks (stencils, usually text) are skipped.
 * If images cover most of the page it is a scan: no exemption, so Smart tint remaps the whole page.
 */
export function imageRects(ops: { fnArray: number[]; argsArray: unknown[] }, view: number[], rotate: number): NormRect[] {
  const W = view[2] - view[0];
  const H = view[3] - view[1];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const out: NormRect[] = [];
  const add = (m: Matrix) => {
    const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]];
    const ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
    const r: NormRect = [
      (Math.min(...xs) - view[0]) / W,
      1 - (Math.max(...ys) - view[1]) / H,
      (Math.max(...xs) - view[0]) / W,
      1 - (Math.min(...ys) - view[1]) / H,
    ];
    const c: NormRect = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(1, r[2]), Math.min(1, r[3])];
    if (c[2] - c[0] > 0.005 && c[3] - c[1] > 0.005) out.push(rotateNormRect(c, rotate));
  };
  const { fnArray, argsArray } = ops;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, argsArray[i] as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      const m = (argsArray[i] as [Matrix | null, unknown])[0];
      if (m) ctm = mul(ctm, m);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) add(ctm);
  }
  const area = out.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0);
  return area > 0.85 ? [] : out;
}
