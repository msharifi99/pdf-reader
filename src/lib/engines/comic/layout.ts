import type { Fit } from '../types';

export interface Size {
  w: number;
  h: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface SpreadLayout {
  /** Effective scale (1 = natural pixels of the tallest page). */
  scale: number;
  /** Display size of each page in CSS px (all share one height). */
  pages: Size[];
  width: number;
  height: number;
}

/** Lay out one or two pages side by side at a common height, then fit the pair into the viewport. */
export function layoutSpread(sizes: Size[], viewW: number, viewH: number, fit: Fit, zoom: number): SpreadLayout {
  const H = Math.max(...sizes.map((s) => s.h));
  const natural = sizes.map((s) => (s.w * H) / s.h);
  const W = natural.reduce((a, b) => a + b, 0);
  const byHeight = viewH / H;
  const byWidth = viewW / W;
  const raw = fit === 'height' ? byHeight : fit === 'width' ? byWidth : fit === 'actual' ? 1 : fit === 'custom' ? zoom : Math.min(byHeight, byWidth);
  const scale = clamp(raw, MIN_SCALE, MAX_SCALE);
  return { scale, pages: natural.map((w) => ({ w: w * scale, h: H * scale })), width: W * scale, height: H * scale };
}

/** Webtoon geometry: page heights at width `w`, cumulative tops, total height. */
export function stackLayout(aspects: number[], w: number, gap: number): { heights: number[]; tops: number[]; total: number } {
  const heights = aspects.map((a) => a * w);
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return { heights, tops, total: Math.max(0, y - gap) };
}

/** Index of the page whose box contains `y` (last page whose top <= y). */
export function pageAtY(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
