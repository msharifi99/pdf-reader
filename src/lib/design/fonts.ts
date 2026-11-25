// Font registry + default Typography Profile. Import './fonts.css' once at app boot (tokens.css does).
import type { TypographyProfile } from '../engines/types';

export type FontCategory = 'serif' | 'sans' | 'legibility' | 'mono';

export interface FontInfo {
  id: string;
  label: string;
  /** CSS font-family name registered by fonts.css (or the system family name) */
  family: string;
  /** Full CSS stack with sensible fallbacks */
  stack: string;
  category: FontCategory;
  description: string;
  bundled: boolean;
}

const SERIF_FALLBACK = "Georgia, 'Times New Roman', serif";
const SANS_FALLBACK = "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";
const MONO_FALLBACK = "'Cascadia Mono', Consolas, monospace";

export const bundledFonts: FontInfo[] = [
  {
    id: 'literata',
    label: 'Literata',
    family: 'Literata Variable',
    stack: `'Literata Variable', ${SERIF_FALLBACK}`,
    category: 'serif',
    description: 'Designed for long-form screen reading. The default.',
    bundled: true,
  },
  {
    id: 'source-serif-4',
    label: 'Source Serif 4',
    family: 'Source Serif 4 Variable',
    stack: `'Source Serif 4 Variable', ${SERIF_FALLBACK}`,
    category: 'serif',
    description: 'Crisp transitional serif, a touch denser.',
    bundled: true,
  },
  {
    id: 'inter',
    label: 'Inter',
    family: 'Inter Variable',
    stack: `'Inter Variable', ${SANS_FALLBACK}`,
    category: 'sans',
    description: 'Neutral, open sans. Also the interface face.',
    bundled: true,
  },
  {
    id: 'atkinson-hyperlegible',
    label: 'Atkinson Hyperlegible',
    family: 'Atkinson Hyperlegible Next',
    stack: `'Atkinson Hyperlegible Next', ${SANS_FALLBACK}`,
    category: 'legibility',
    description: 'Distinct letterforms for low vision and dyslexia.',
    bundled: true,
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: 'JetBrains Mono Variable',
    stack: `'JetBrains Mono Variable', ${MONO_FALLBACK}`,
    category: 'mono',
    description: 'For code blocks.',
    bundled: true,
  },
];

/** Wrap an installed system font (listed by the core) in the same shape. */
export function systemFont(family: string, category: FontCategory = 'serif'): FontInfo {
  const fallback = category === 'mono' ? MONO_FALLBACK : category === 'serif' ? SERIF_FALLBACK : SANS_FALLBACK;
  return {
    id: `system:${family}`,
    label: family,
    family,
    stack: `'${family.replace(/'/g, "\\'")}', ${fallback}`,
    category,
    description: 'Installed on this PC',
    bundled: false,
  };
}

export function fontById(id: string): FontInfo | undefined {
  return bundledFonts.find((f) => f.id === id);
}

export type { TypographyProfile };

/** Tuned so an unstyled EPUB looks like a well-set book on a 1080p laptop. */
export const defaultTypography: TypographyProfile = {
  fontFamily: 'literata',
  fontSize: 19,
  fontWeight: 400,
  lineHeight: 1.6,
  letterSpacing: 0,
  wordSpacing: 0,
  paragraphSpacing: 0.6,
  textIndent: 0,
  textAlign: 'start',
  hyphenation: true,
  marginX: 6,
  marginY: 5,
  maxLineWidth: 66,
  columns: 'auto',
  overridePublisher: 'off',
};

/** Ranges for typography sliders (settings panel, live preview). */
export const typographyLimits = {
  fontSize: { min: 12, max: 36, step: 1 },
  fontWeight: { min: 300, max: 700, step: 50 },
  lineHeight: { min: 1.2, max: 2.2, step: 0.05 },
  letterSpacing: { min: -0.05, max: 0.1, step: 0.005 },
  wordSpacing: { min: -0.1, max: 0.4, step: 0.02 },
  paragraphSpacing: { min: 0, max: 2, step: 0.1 },
  textIndent: { min: 0, max: 3, step: 0.25 },
  marginX: { min: 0, max: 25, step: 1 },
  marginY: { min: 0, max: 15, step: 1 },
  maxLineWidth: { min: 40, max: 100, step: 1 },
} as const;

/** FontChoice -> FontInfo: a bundled id, or any installed family name. 'publisher' -> undefined. */
export function resolveFont(choice: string): FontInfo | undefined {
  if (choice === 'publisher') return undefined;
  return fontById(choice) ?? systemFont(choice);
}

/** Inline style for previews (settings, gallery). Engines build their own stylesheet from the profile. */
export function typographyStyle(p: TypographyProfile): string {
  const font = resolveFont(p.fontFamily);
  return [
    font && `font-family:${font.stack}`,
    `font-size:${p.fontSize}px`,
    `font-weight:${p.fontWeight}`,
    `line-height:${p.lineHeight}`,
    `letter-spacing:${p.letterSpacing}em`,
    `word-spacing:${p.wordSpacing}em`,
    `--para-spacing:${p.paragraphSpacing}em`,
    `--para-indent:${p.textIndent}em`,
    `padding-inline:${p.marginX}%`,
    p.maxLineWidth > 0 && `max-width:${p.maxLineWidth}ch`,
    `text-align:${p.textAlign}`,
    `hyphens:${p.hyphenation ? 'auto' : 'manual'}`,
  ]
    .filter(Boolean)
    .join(';');
}