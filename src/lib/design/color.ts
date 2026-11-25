// Small colour toolkit: hex <-> sRGB <-> OKLab, WCAG contrast, perceptual mixing.
// Kept dependency-free so engines (Page Tint) and the theme editor can share it.

export type RGB = { r: number; g: number; b: number; a: number }; // r,g,b 0..255, a 0..1

export function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) throw new Error(`Invalid hex colour: ${hex}`);
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

export function isHex(s: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s.trim());
}

export function toHex({ r, g, b, a = 1 }: Partial<RGB> & { r: number; g: number; b: number }): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}${a < 1 ? c(a * 255) : ''}`;
}

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/** WCAG 2.x relative luminance, 0..1 */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. Alpha in fg is composited over bg first. */
export function contrast(fg: string, bg: string): number {
  const f = parseHex(fg);
  const fgHex = f.a < 1 ? mix(bg, toHex({ ...f, a: 1 }), f.a, 'srgb') : fg;
  const a = luminance(fgHex) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

export type OKLab = { L: number; a: number; b: number };

export function toOklab(hex: string): OKLab {
  const { r, g, b } = parseHex(hex);
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function fromOklab({ L, a, b }: OKLab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return toHex({
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  });
}

/** Mix `b` into `a` by t (0 = a, 1 = b). OKLab by default: perceptually even, no muddy midpoints. */
export function mix(a: string, b: string, t: number, space: 'oklab' | 'srgb' = 'oklab'): string {
  if (space === 'srgb') {
    const x = parseHex(a), y = parseHex(b);
    return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
  }
  const x = toOklab(a), y = toOklab(b);
  return fromOklab({ L: x.L + (y.L - x.L) * t, a: x.a + (y.a - x.a) * t, b: x.b + (y.b - x.b) * t });
}

/**
 * Return `fg` (or the closest colour on the line from fg toward black/white, whichever is
 * further from bg) that reaches `min` contrast on `bg`. Hue is preserved as much as possible.
 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (contrast(fg, bg) >= min) return fg;
  const target = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(fg, target, mid), bg) >= min) hi = mid;
    else lo = mid;
  }
  return mix(fg, target, hi);
}

/** HSV (h 0..360, s,v 0..1) for the colour picker's 2D area. */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return toHex({ r: f(5), g: f(3), b: f(1) });
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = parseHex(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/** Black or white text, whichever reads better on `bg`; prefers the theme's own ink if it passes. */
export function onColor(bg: string, preferred?: string[]): string {
  for (const p of preferred ?? []) if (contrast(p, bg) >= 4.5) return p;
  return contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111';
}
