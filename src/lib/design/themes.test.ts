import { describe, expect, it } from 'vitest';
import { contrast, ensureContrast, fromOklab, hexToHsv, hsvToHex, luminance, mix, parseHex, toHex, toOklab } from './color';
import { auditTheme, builtinThemes, deriveTheme, highlightColors, isDark, themeVars } from './themes';
import { parseShortcut } from '../ui/kbd';

describe('color', () => {
  it('parses and formats hex', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(toHex(parseHex('#1B1C1F'))).toBe('#1b1c1f');
    expect(() => parseHex('nope')).toThrow();
  });
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
  it('round-trips OKLab', () => {
    for (const c of ['#1b1c1f', '#fdf6e3', '#cb4b16', '#268bd2']) expect(fromOklab(toOklab(c))).toBe(c);
  });
  it('round-trips HSV', () => {
    for (const c of ['#1b1c1f', '#fdf6e3', '#cb4b16', '#268bd2', '#ffffff', '#000000']) {
      const { h, s, v } = hexToHsv(c);
      expect(hsvToHex(h, s, v)).toBe(c);
    }
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
  });
  it('mixes endpoints exactly', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
  it('ensureContrast reaches the target and leaves passing colours alone', () => {
    expect(ensureContrast('#000000', '#ffffff', 4.5)).toBe('#000000');
    const fixed = ensureContrast('#bbbbbb', '#ffffff', 4.5);
    expect(contrast(fixed, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    const onDark = ensureContrast('#333333', '#1b1c1f', 4.5);
    expect(contrast(onDark, '#1b1c1f')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('built-in themes', () => {
  for (const t of builtinThemes) {
    // Solarized Light is canonical by request: base00 on base3 is 4.1:1.
    const canonical = t.id === 'solarized-light';
    const textMin = canonical ? 4.0 : 4.5;
    const mutedMin = canonical ? 3.0 : 4.5;
    const fillMin = canonical ? 3.2 : 4.5; // text over selection / highlight fills
    it(`${t.name}: text, muted, link, focus and highlights are legible`, () => {
      const a = auditTheme(t);
      expect(a.text).toBeGreaterThanOrEqual(textMin);
      expect(a.muted).toBeGreaterThanOrEqual(mutedMin);
      expect(a.mutedOnSurface).toBeGreaterThanOrEqual(canonical ? 2.8 : 4.0);
      expect(a.accent).toBeGreaterThanOrEqual(3); // focus ring + non-text UI (WCAG 1.4.11)
      expect(a.onAccent).toBeGreaterThanOrEqual(canonical ? 4.0 : 4.5);
      expect(a.link).toBeGreaterThanOrEqual(canonical ? 3.0 : 4.5);
      expect(a.selection).toBeGreaterThanOrEqual(fillMin);
      for (const c of highlightColors) expect(a.highlights[c], c).toBeGreaterThanOrEqual(fillMin);
    });
    it(`${t.name}: kind, mica and blend agree with the background`, () => {
      expect(isDark(t)).toBe(t.dark);
      expect(t.mica).toBe(t.dark ? 'dark' : 'light');
      expect(t.highlightBlend).toBe(t.dark ? 'screen' : 'multiply');
    });
  }
  it('Dark and Solarized match the spec', () => {
    const dark = builtinThemes.find((t) => t.id === 'dark')!;
    const sol = builtinThemes.find((t) => t.id === 'solarized-light')!;
    expect(dark.bg).toBe('#1b1c1f');
    expect(sol.bg).toBe('#fdf6e3');
    expect(sol.text).toBe('#657b83');
  });
  it('exposes every role as a CSS variable', () => {
    const v = themeVars(builtinThemes[0]!);
    for (const k of ['--bg', '--surface', '--surface-2', '--text', '--muted', '--accent', '--on-accent', '--link', '--selection', '--hl-yellow', '--hl-pink', '--border', '--shadow'])
      expect(v[k], k).toMatch(/^#/);
  });
});

describe('deriveTheme', () => {
  const seeds = [
    { name: 'Low-contrast dark', bg: '#202020', text: '#555555', accent: '#333333', link: '#3344aa', selection: '#ffffff' },
    { name: 'Washed light', bg: '#ffffff', text: '#cccccc', accent: '#ffee88', link: '#99ccff', selection: '#000000' },
    { name: 'Mint', bg: '#e8f5ee', text: '#1d3b2a', accent: '#2f8f5b', link: '#1f6f9f', selection: '#bfe3cf' },
    { name: 'Navy', bg: '#0f1a2b', text: '#dfe7f2', accent: '#ffb454', link: '#7fc4ff', selection: '#24406a' },
    { name: 'Mid grey', bg: '#808080', text: '#909090', accent: '#8a8a8a', link: '#858585', selection: '#7a7a7a' },
  ];
  for (const seed of seeds) {
    it(`${seed.name}: every derived role meets WCAG AA`, () => {
      const t = deriveTheme(seed);
      const a = auditTheme(t);
      expect(a.text).toBeGreaterThanOrEqual(4.5);
      expect(a.muted).toBeGreaterThanOrEqual(4.5);
      expect(a.link).toBeGreaterThanOrEqual(4.5);
      expect(a.accent).toBeGreaterThanOrEqual(3);
      expect(a.onAccent).toBeGreaterThanOrEqual(4.5);
      expect(a.selection).toBeGreaterThanOrEqual(4.5);
      for (const c of highlightColors) expect(a.highlights[c], c).toBeGreaterThanOrEqual(4.5);
      expect(t.dark).toBe(isDark(t));
    });
  }
  it('keeps colours that already pass', () => {
    const t = deriveTheme(seeds[3]!);
    expect(t.text).toBe('#dfe7f2');
    expect(t.accent).toBe('#ffb454');
  });
  it('muted sits between text and background', () => {
    const t = deriveTheme(seeds[2]!);
    const [lt, lm, lb] = [t.text, t.muted, t.bg].map(luminance) as [number, number, number];
    expect(lm).toBeGreaterThan(lt);
    expect(lm).toBeLessThan(lb);
  });
  it('rejects non-hex input', () => {
    expect(() => deriveTheme({ ...seeds[0]!, bg: 'red' })).toThrow();
  });
});

describe('parseShortcut', () => {
  it('splits chords and sequences and prettifies keys', () => {
    expect(parseShortcut('Ctrl+K')).toEqual([['Ctrl', 'K']]);
    expect(parseShortcut('g g')).toEqual([['g'], ['g']]);
    expect(parseShortcut('ctrl+shift+p')).toEqual([['Ctrl', 'Shift', 'P']]);
    expect(parseShortcut('Shift+ArrowLeft')).toEqual([['Shift', '←']]);
    expect(parseShortcut('Ctrl++')).toEqual([['Ctrl', '+']]);
    expect(parseShortcut('?')).toEqual([['?']]);
  });
});
