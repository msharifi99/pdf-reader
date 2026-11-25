/**
 * Pure builders: Theme + TypographyProfile -> the user stylesheet injected into every section
 * iframe, and -> the paginator's layout attributes. No DOM here so it unit-tests in node.
 *
 * Override levels (TypographyProfile.overridePublisher)
 *   off    soft defaults on html/body and bare tags, placed AFTER the book's CSS with no
 *          !important: they win over a book's tag selectors but lose to its classes. Page-level
 *          layout (margins, columns) always applies.
 *   fonts  + family, size, weight, letter/word spacing become !important.
 *   all    + line-height, alignment, paragraph spacing/indent, colours and backgrounds.
 * Text and link colours always follow the theme; dark themes also flatten backgrounds (publishers tune them for white pages).
 * Fonts: with override off the publisher's families win, except generic body fonts (Georgia, serif, Times...), which
 * are stripped from the book's CSS (stripGenericFontFamilies) so the user's font shows wherever the publisher chose none.
 * Images, tables, code blocks, superscripts and poetry/indented blocks are never reset.
 */
import type { Flow, PublisherOverride, Spread, Theme, TypographyProfile } from '../types';
import { MONO_STACK, stackFor } from './fontfaces';

// Class names match as whole words: a substring match caught prose classes such as "monologue", "decode"
// or "barcode" and typeset those paragraphs in the mono face.
const MONO_SEL = 'code, pre, kbd, samp, tt, var, [class~="mono" i], [class~="monospace" i], [class~="code" i], [class~="codeblock" i]';
const TEXT_BLOCKS = 'p, li, dd, dt, td, th, blockquote, figcaption';
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
/** Containers whose paragraphs keep the book's own indents/alignment (verse, quotes, notes). */
const KEEP_FORMATTING =
  ':is(blockquote, pre, figure, table, aside, [class*="poem" i], [class*="verse" i], [class*="stanza" i], [class*="epigraph" i], [class*="lyric" i])';
const KEEP_OWN =
  ':not([align]):not([style*="text-align" i]):not([class*="center" i]):not([class*="right" i]):not([class*="epigraph" i])';

/** `font-family` values made only of generic/default families say "no particular font": the user's font replaces them. */
const GENERIC = /^(serif|sans-serif|georgia|times|times new roman|timesnewroman|palatino|palatino linotype|book antiqua|garamond|cambria|arial|helvetica|verdana|tahoma|trebuchet ms|system-ui|inherit|initial)$/i;
export function stripGenericFontFamilies(css: string): string {
  return css.replace(/(^|[{;\s])font-family\s*:\s*([^;}]*?)\s*(!important)?\s*(?=[;}]|$)/gi, (m, pre: string, value: string) => {
    const fams = value.split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, ''));
    return fams.length && fams.every((f) => GENERIC.test(f)) ? pre : m;
  });
}

export interface StyleInput {
  theme: Theme;
  typography: TypographyProfile;
  /** Slightly dim bitmaps in dark themes. */
  dimImages?: boolean;
  /** @font-face rules (absolute URLs), from fontFaceCss(). */
  fontCss?: string;
}

const em = (n: number) => `${+n.toFixed(3)}em`;

/** `[before, after]`: `before` is prepended to the book's CSS, `after` appended. */
export function buildStyles({ theme, typography: t, dimImages = false, fontCss = '' }: StyleInput): [string, string] {
  const level: PublisherOverride = t.overridePublisher;
  const fonts = level !== 'off';
  const all = level === 'all';
  const imp = (on: boolean) => (on ? ' !important' : '');
  const stack = stackFor(t.fontFamily);
  const justify = t.textAlign === 'justify';
  const hyph = t.hyphenation ? 'auto' : 'manual';

  // Runs BEFORE the book's CSS: @namespace must come first; fonts; heading alignment default.
  const before = `@namespace epub "http://www.idpf.org/2007/ops";
${fontCss}
${HEADINGS}{text-align:start}
`;

  const css: string[] = [];
  const push = (s: string) => css.push(s);

  // --- theme: paper, ink, links, selection (always) -----------------------------------------
  push(`:root{--theme-bg-color:${theme.bg};color-scheme:${theme.dark ? 'dark' : 'light'}}`);
  push(`html,body{background:${theme.bg} !important;color:${theme.text} !important}`);
  push(`::selection{background:${theme.selection} !important}`);
  // Text and link colours always come from the theme: publisher colours are tuned for white paper and make books
  // unreadable on dark, sepia and solarized pages. (Backgrounds are only flattened on dark themes, or at 'all'.)
  push(`a:any-link{color:${theme.link} !important}`);
  push(`body *:not(a:any-link, a:any-link *, img, svg, svg *, video, canvas, picture, hr, ${MONO_SEL}){color:inherit !important}`);
  push(`pre, code, kbd, samp{color:inherit !important}`);
  if (theme.dark || all) {
    push(`body *:not(a:any-link, a:any-link *, img, svg, svg *, video, canvas, picture, hr, ${MONO_SEL}){background-color:transparent !important}`);
    push(`pre, code, kbd, samp{background-color:color-mix(in srgb, ${theme.text} 9%, transparent) !important}`);
    push(`hr{border-color:color-mix(in srgb, ${theme.text} 30%, transparent) !important}`);
  }
  if (theme.dark && dimImages) push('img, video{filter:brightness(.88)}');

  // --- typography: html/body defaults, soft unless override is on ---------------------------
  push(`html{font-size:${t.fontSize}px !important;-webkit-text-size-adjust:none}`);
  const base = [
    stack && `font-family:${stack}`,
    `font-size:1rem`,
    `font-weight:${t.fontWeight}`,
    `line-height:${t.lineHeight}`,
    `letter-spacing:${em(t.letterSpacing)}`,
    `word-spacing:${em(t.wordSpacing)}`,
    `hyphens:${hyph}`,
    `-webkit-hyphens:${hyph}`,
    `text-align:${justify ? 'justify' : 'start'}`,
    'widows:2',
    'orphans:2',
    'overflow-wrap:break-word',
    'text-rendering:optimizeLegibility',
    '-webkit-font-smoothing:antialiased',
  ].filter(Boolean);
  push(`body{${base.join(';')}}`);
  push(`p, li, dd, dt, blockquote, div{hyphens:${hyph};-webkit-hyphens:${hyph}}`);
  push(`html{-webkit-hyphenate-limit-before:3;-webkit-hyphenate-limit-after:2;hanging-punctuation:allow-end last}`);
  // Soft layer: bare tags later in the cascade beat a book's own bare-tag rules.
  if (stack) push(`p, li, dd, dt, td, th, blockquote, ${HEADINGS}, div{font-family:${stack}}`);
  push(`p, li, dd, dt, blockquote{line-height:${t.lineHeight};text-align:${justify ? 'justify' : 'start'}}`);
  push(`${HEADINGS}{text-align:start;hyphens:manual}`);
  push(
    `[align="left"]{text-align:left}[align="right"]{text-align:right}[align="center"]{text-align:center}[align="justify"]{text-align:justify}`,
  );

  // Code is always the mono face (and never reflowed into the column).
  push(`${MONO_SEL}{font-family:${MONO_STACK}${imp(fonts)}}`);
  push(`pre{white-space:pre-wrap !important;overflow-wrap:anywhere;font-size:.9em}`);
  push(`code, kbd, samp{font-size:.92em}`);
  push(`sup, sub{line-height:0}`);
  push(`img, svg, video{max-width:100%}`);
  push(`table{max-width:100%}`);
  push(
    `aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"], aside[epub|type~="note"]{display:none}`,
  );

  // --- override: fonts ------------------------------------------------------------------------
  if (fonts) {
    if (stack) push(`body, body *:not(${MONO_SEL}, svg, svg *, math, math *){font-family:${stack} !important}`);
    push(
      `body{font-weight:${t.fontWeight} !important;letter-spacing:${em(t.letterSpacing)} !important;word-spacing:${em(t.wordSpacing)} !important}`,
    );
    push(
      `${TEXT_BLOCKS}{font-size:1em !important;font-weight:${t.fontWeight} !important;letter-spacing:inherit !important;word-spacing:inherit !important}`,
    );
    push(`body{font-size:1rem !important}`);
  }

  // --- override: everything else --------------------------------------------------------------
  if (all) {
    push(`body, p, li, dd, dt, blockquote{line-height:${t.lineHeight} !important}`);
    push(`p${KEEP_OWN}:not(${KEEP_FORMATTING} p), li, dd{text-align:${justify ? 'justify' : 'left'} !important}`);
    const para = `p:not(${KEEP_FORMATTING} p):not(${KEEP_FORMATTING})`;
    push(
      `${para}{margin-top:0 !important;margin-bottom:${em(t.paragraphSpacing)} !important;margin-left:0 !important;margin-right:0 !important;text-indent:${em(t.textIndent)} !important}`,
    );
    // Classic typesetting: no indent right after a heading or at a section start.
    push(`${HEADINGS.replace(/(h\d)/g, '$1 + p')}, hr + p{text-indent:0 !important}`);
    push(`${HEADINGS}{margin-left:0 !important;margin-right:0 !important;text-indent:0 !important}`);
    push(
      `div, section, article, body{margin-left:0 !important;margin-right:0 !important;padding-left:0 !important;padding-right:0 !important}`,
    );
  }

  return [before, css.join('\n')];
}

// ---------------------------------------------------------------------------------------------
// Paginator layout
// ---------------------------------------------------------------------------------------------

export interface LayoutInput {
  typography: Pick<TypographyProfile, 'marginX' | 'marginY' | 'maxLineWidth' | 'columns' | 'fontSize'>;
  flow: Flow;
  spread: Spread;
  /** Host size in CSS px. */
  width: number;
  height: number;
  /** Measured width of "0" in px for the active font, if known (default 0.55em). */
  chPx?: number;
  animate: boolean;
}

export interface LayoutAttrs {
  flow: Flow;
  gap: string;
  margin: string;
  'max-inline-size': string;
  'max-column-count': string;
  animated: boolean;
  columns: 1 | 2;
}

/** Wide landscape windows switch to a two-page spread when spread/columns are 'auto'. */
export const SPREAD_MIN_WIDTH = 1100;

export function columnCount(spread: Spread, columns: 1 | 2 | 'auto', width: number, height: number): 1 | 2 {
  if (spread === 'single') return 1;
  if (spread === 'double') return 2;
  if (columns !== 'auto') return columns;
  return width >= SPREAD_MIN_WIDTH && width > height ? 2 : 1;
}

export function layoutAttrs(i: LayoutInput): LayoutAttrs {
  const t = i.typography;
  const columns = i.flow === 'scrolled' ? 1 : columnCount(i.spread, t.columns, i.width, i.height);
  const lineMax = t.maxLineWidth > 0 ? Math.round(t.maxLineWidth * (i.chPx ?? t.fontSize * 0.55)) : 0;
  // For a forced spread the column must be narrow enough that the paginator picks two.
  const half = Math.floor((i.width * 0.9) / 2);
  const maxInline = columns === 2 ? (lineMax ? Math.min(lineMax, half) : half) : lineMax || 100000;
  return {
    flow: i.flow,
    gap: `${Math.max(0, t.marginX)}%`,
    margin: `${Math.max(12, Math.round((i.height * Math.max(0, t.marginY)) / 100))}px`,
    'max-inline-size': `${maxInline}px`,
    'max-column-count': String(columns),
    animated: i.animate && i.flow === 'paginated',
    columns,
  };
}
