import { describe, expect, it } from 'vitest';
import type { Theme, TypographyProfile } from '../types';
import { fontFaceCss, FONT_FILES, stackFor } from './fontfaces';
import { stripGenericFontFamilies, buildStyles, columnCount, layoutAttrs, SPREAD_MIN_WIDTH } from './stylesheet';

const light: Theme = {
  id: 'light', name: 'Light', dark: false, bg: '#faf7f0', surface: '#fff', text: '#1d1b17', muted: '#666', accent: '#a8651c',
  link: '#2a5a9a', selection: '#cfe0f5', highlight: ['#f6e08a', '#bfe3b4', '#b6d4f2', '#f2bdd6'], shadow: '#000',
};
const dark: Theme = { ...light, id: 'dark', dark: true, bg: '#1b1c1f', text: '#e8e4dc' };
const typo: TypographyProfile = {
  fontFamily: 'literata', fontSize: 19, fontWeight: 400, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 0.6,
  textIndent: 0, textAlign: 'start', hyphenation: true, marginX: 6, marginY: 5, maxLineWidth: 66, columns: 'auto', overridePublisher: 'off',
};
const css = (t: Partial<TypographyProfile> = {}, theme = light) => buildStyles({ theme, typography: { ...typo, ...t } })[1];

describe('stripGenericFontFamilies', () => {
  it('drops generic-only font-family declarations and keeps real choices', () => {
    const c = 'body { font-family: Georgia, serif; color: #222 } p.a{font-family:"Times New Roman",serif !important;margin:0} p.b { font-family: "Courier New", monospace } h1{font-family:"EmbeddedFace", sans-serif}';
    const out = stripGenericFontFamilies(c);
    expect(out).not.toMatch(/Georgia|Times/);
    expect(out).toContain('color: #222');
    expect(out).toContain('margin:0');
    expect(out).toContain('"Courier New"');
    expect(out).toContain('EmbeddedFace');
  });
});

describe('buildStyles', () => {
  it('text and link colours always follow the theme, even with override off', () => {
    const c = css({ overridePublisher: 'off' });
    expect(c).toMatch(/body \*:not\([^)]*\)\{color:inherit !important\}/);
    expect(c).toContain('a:any-link{color:#2a5a9a !important}');
  });

  it('mono selector matches whole class words only (not "monologue", "decode", "barcode")', () => {
    const c = css({ overridePublisher: 'fonts' });
    expect(c).not.toMatch(/\[class\*=/);
    expect(c).toContain('[class~="code" i]');
  });

  it('puts @namespace and font faces before the book CSS, user rules after', () => {
    const [before, after] = buildStyles({ theme: light, typography: typo, fontCss: '@font-face{font-family:X}' });
    expect(before.startsWith('@namespace epub')).toBe(true);
    expect(before).toContain('@font-face{font-family:X}');
    expect(after).not.toContain('@font-face');
  });

  it('always paints the theme: html/body paper and ink, selection, links, --theme-bg-color', () => {
    const c = css();
    expect(c).toContain('--theme-bg-color:#faf7f0');
    expect(c).toContain('html,body{background:#faf7f0 !important;color:#1d1b17 !important}');
    expect(c).toContain('::selection{background:#cfe0f5 !important}');
    expect(c).toContain('a:any-link{color:#2a5a9a !important}');
    expect(css({}, dark)).toContain('color-scheme:dark');
  });

  it('off: soft defaults only, nothing forces the book font', () => {
    const c = css();
    expect(c).toContain("font-family:'Literata Variable'");
    expect(c).not.toMatch(/font-family:'Literata Variable'[^;}]*!important/);
    expect(c).not.toContain('background-color:transparent');
    expect(c).not.toContain('text-indent');
    expect(c).not.toContain('margin-bottom');
    // base font size is the root rem, always enforced
    expect(c).toContain('html{font-size:19px !important');
  });

  it('fonts: family/size/weight become !important, colours and spacing do not', () => {
    const c = css({ overridePublisher: 'fonts' });
    expect(c).toMatch(/body \*:not\([^)]*\)\{font-family:'Literata Variable'[^}]*!important\}/);
    expect(c).toContain('font-size:1em !important');
    expect(c).not.toContain('text-indent');
    expect(c).not.toMatch(/background-color:transparent/); // backgrounds stay the publisher's at 'fonts' on light themes
  });

  it('all: also line-height, alignment, paragraph spacing/indent, colours — but protects poetry/quotes/code', () => {
    const c = css({ overridePublisher: 'all', paragraphSpacing: 0.8, textIndent: 1.5, textAlign: 'justify' });
    expect(c).toContain('line-height:1.6 !important');
    expect(c).toContain('margin-bottom:0.8em !important');
    expect(c).toContain('text-indent:1.5em !important');
    expect(c).toContain('text-align:justify !important');
    expect(c).toContain('color:inherit !important');
    expect(c).toMatch(/p:not\(:is\(blockquote, pre, figure/);
    expect(c).toContain('[class*="poem" i]');
    expect(c).toContain('pre{white-space:pre-wrap !important');
    expect(c).toContain("JetBrains Mono Variable");
    // images and svg are excluded from the colour flattening
    expect(c).toMatch(/body \*:not\([^)]*img, svg, svg \*/);
  });

  it('dark themes flatten colours at every level; dimming is opt-in', () => {
    expect(css({}, dark)).toContain('background-color:transparent !important');
    expect(buildStyles({ theme: dark, typography: typo, dimImages: true })[1]).toContain('filter:brightness(.88)');
    expect(css({}, dark)).not.toContain('brightness');
    expect(buildStyles({ theme: light, typography: typo, dimImages: true })[1]).not.toContain('brightness');
  });

  it("'publisher' font emits no family; hyphenation and justify follow the profile", () => {
    const c = css({ fontFamily: 'publisher', overridePublisher: 'fonts', hyphenation: false, textAlign: 'justify' });
    expect(c).not.toContain("font-family:'Literata");
    expect(c).not.toMatch(/body \*:not\([^)]*\)\{font-family/);
    expect(c).toContain('hyphens:manual');
    expect(c).toContain('text-align:justify');
    expect(css({ hyphenation: true })).toContain('hyphens:auto');
  });

  it('system fonts are quoted and escaped', () => {
    expect(stackFor("system:Bookerly'x")).toContain("'Bookerlyx'");
    expect(stackFor('publisher')).toBeNull();
    expect(stackFor('inter')).toContain('Inter Variable');
  });
});

describe('fontFaceCss', () => {
  it('emits absolute urls with unicode ranges for every bundled face', () => {
    const out = fontFaceCss(FONT_FILES, 'http://localhost:4173/');
    expect(out.split('@font-face').length - 1).toBe(FONT_FILES.length);
    expect(out).toMatch(/src:url\("http:\/\/localhost:4173\/[^"]+\.woff2"\)/);
    expect(out).not.toMatch(/url\("\//);
    expect(out).toContain('unicode-range:');
    for (const fam of ['Literata Variable', 'Source Serif 4 Variable', 'Inter Variable', 'JetBrains Mono Variable', 'Atkinson Hyperlegible Next'])
      expect(out).toContain(`font-family:'${fam}'`);
  });
});

describe('layout', () => {
  const base = { typography: typo, flow: 'paginated' as const, spread: 'auto' as const, width: 1400, height: 800, animate: true };

  it('columnCount: explicit spread beats columns beats auto-by-width', () => {
    expect(columnCount('single', 2, 2000, 800)).toBe(1);
    expect(columnCount('double', 1, 600, 800)).toBe(2);
    expect(columnCount('auto', 2, 600, 800)).toBe(2);
    expect(columnCount('auto', 1, 2000, 800)).toBe(1);
    expect(columnCount('auto', 'auto', SPREAD_MIN_WIDTH, 700)).toBe(2);
    expect(columnCount('auto', 'auto', SPREAD_MIN_WIDTH - 1, 700)).toBe(1);
    expect(columnCount('auto', 'auto', 1200, 1300)).toBe(1); // portrait
  });

  it('maps margins and measure to paginator attributes', () => {
    const a = layoutAttrs({ ...base, chPx: 10 });
    expect(a.gap).toBe('6%');
    expect(a.margin).toBe('40px'); // 5% of 800
    expect(a['max-column-count']).toBe('2');
    expect(a['max-inline-size']).toBe('630px'); // min(66ch = 660, 0.9*1400/2 = 630)
    expect(a.animated).toBe(true);
  });

  it('single column uses the full measure, unlimited when maxLineWidth is 0', () => {
    const a = layoutAttrs({ ...base, width: 900, chPx: 10 });
    expect(a['max-column-count']).toBe('1');
    expect(a['max-inline-size']).toBe('660px');
    expect(layoutAttrs({ ...base, width: 900, typography: { ...typo, maxLineWidth: 0 } })['max-inline-size']).toBe('100000px');
  });

  it('scrolled flow is one column and never animated', () => {
    const a = layoutAttrs({ ...base, flow: 'scrolled' });
    expect(a['max-column-count']).toBe('1');
    expect(a.animated).toBe(false);
  });

  it('animation can be turned off, and the vertical margin has a floor', () => {
    expect(layoutAttrs({ ...base, animate: false }).animated).toBe(false);
    expect(layoutAttrs({ ...base, typography: { ...typo, marginY: 0 } }).margin).toBe('12px');
  });
});
