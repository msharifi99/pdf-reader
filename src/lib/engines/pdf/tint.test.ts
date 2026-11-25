import { describe, expect, it } from 'vitest';
import { inRects, parseCssColor, smartTintImageData, smartTintPixel } from './tint';

const BG: [number, number, number] = [30, 32, 36];
const FG: [number, number, number] = [220, 220, 215];

describe('smart tint math', () => {
  it('maps white paper to the theme bg and black ink to the theme text', () => {
    expect(smartTintPixel(255, 255, 255, BG, FG).map(Math.round)).toEqual(BG);
    expect(smartTintPixel(0, 0, 0, BG, FG).map(Math.round)).toEqual(FG);
  });
  it('is monotonic in luminance for greys', () => {
    const a = smartTintPixel(60, 60, 60, BG, FG)[0];
    const b = smartTintPixel(200, 200, 200, BG, FG)[0];
    expect(a).toBeGreaterThan(b); // darker ink -> brighter output on a dark theme
  });
  it('keeps some chroma and clamps', () => {
    const [r, g, b] = smartTintPixel(0, 0, 255, BG, FG);
    expect(b).toBeGreaterThan(r);
    for (const v of [r, g, b]) expect(v >= 0 && v <= 255).toBe(true);
  });
  it('CPU pass agrees with the pixel function and skips image rects', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const img = { data, width: 4, height: 1 };
    smartTintImageData(img, BG, FG, [[0.5, 0, 0.75, 1]]); // third pixel is an "image"
    expect([...data.slice(0, 3)]).toEqual(smartTintPixel(255, 255, 255, BG, FG).map(Math.round));
    expect([...data.slice(8, 11)]).toEqual([0, 0, 0]);
    expect([...data.slice(12, 15)]).toEqual(smartTintPixel(0, 0, 0, BG, FG).map(Math.round));
  });
  it('inRects and parseCssColor', () => {
    expect(inRects(0.5, 0.5, [[0, 0, 1, 1]])).toBe(true);
    expect(inRects(1, 0.5, [[0, 0, 1, 1]])).toBe(false);
    expect(parseCssColor('#1e2024')).toEqual([30, 32, 36]);
    expect(parseCssColor('#fff')).toEqual([255, 255, 255]);
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual([1, 2, 3]);
  });
});
