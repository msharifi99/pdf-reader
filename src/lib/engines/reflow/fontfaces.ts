/**
 * Bundled reading fonts, as @font-face rules for the section iframes. Iframes do not inherit the
 * app's @font-face, and their documents live at blob: URLs, so every src is an absolute URL
 * resolved against the app's own base (Vite hashes the files; `?url` gives the final path).
 */
import literataN from '@fontsource-variable/literata/files/literata-latin-opsz-normal.woff2?url';
import literataI from '@fontsource-variable/literata/files/literata-latin-opsz-italic.woff2?url';
import literataNx from '@fontsource-variable/literata/files/literata-latin-ext-opsz-normal.woff2?url';
import literataIx from '@fontsource-variable/literata/files/literata-latin-ext-opsz-italic.woff2?url';
import serifN from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2?url';
import serifI from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2?url';
import serifNx from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-opsz-normal.woff2?url';
import serifIx from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-opsz-italic.woff2?url';
import interN from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
import interI from '@fontsource-variable/inter/files/inter-latin-opsz-italic.woff2?url';
import interNx from '@fontsource-variable/inter/files/inter-latin-ext-opsz-normal.woff2?url';
import interIx from '@fontsource-variable/inter/files/inter-latin-ext-opsz-italic.woff2?url';
import monoN from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import monoI from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url';
import atk4 from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-normal.woff2?url';
import atk4i from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-400-italic.woff2?url';
import atk7 from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-normal.woff2?url';
import atk7i from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-700-italic.woff2?url';
import atk4x from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-400-normal.woff2?url';
import atk4ix from '@fontsource/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-400-italic.woff2?url';

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

export interface FontFile {
  family: string;
  url: string;
  style: 'normal' | 'italic';
  /** CSS font-weight (range for variable fonts). */
  weight: string;
  range: string;
  variable: boolean;
}

const v = (family: string, url: string, style: FontFile['style'], range: string, weight = '200 900'): FontFile => ({
  family, url, style, weight, range, variable: true,
});

export const FONT_FILES: FontFile[] = [
  v('Literata Variable', literataN, 'normal', LATIN),
  v('Literata Variable', literataI, 'italic', LATIN),
  v('Literata Variable', literataNx, 'normal', LATIN_EXT),
  v('Literata Variable', literataIx, 'italic', LATIN_EXT),
  v('Source Serif 4 Variable', serifN, 'normal', LATIN),
  v('Source Serif 4 Variable', serifI, 'italic', LATIN),
  v('Source Serif 4 Variable', serifNx, 'normal', LATIN_EXT),
  v('Source Serif 4 Variable', serifIx, 'italic', LATIN_EXT),
  v('Inter Variable', interN, 'normal', LATIN, '100 900'),
  v('Inter Variable', interI, 'italic', LATIN, '100 900'),
  v('Inter Variable', interNx, 'normal', LATIN_EXT, '100 900'),
  v('Inter Variable', interIx, 'italic', LATIN_EXT, '100 900'),
  v('JetBrains Mono Variable', monoN, 'normal', LATIN, '100 800'),
  v('JetBrains Mono Variable', monoI, 'italic', LATIN, '100 800'),
  { family: 'Atkinson Hyperlegible Next', url: atk4, style: 'normal', weight: '400', range: LATIN, variable: false },
  { family: 'Atkinson Hyperlegible Next', url: atk4i, style: 'italic', weight: '400', range: LATIN, variable: false },
  { family: 'Atkinson Hyperlegible Next', url: atk7, style: 'normal', weight: '700', range: LATIN, variable: false },
  { family: 'Atkinson Hyperlegible Next', url: atk7i, style: 'italic', weight: '700', range: LATIN, variable: false },
  { family: 'Atkinson Hyperlegible Next', url: atk4x, style: 'normal', weight: '400', range: LATIN_EXT, variable: false },
  { family: 'Atkinson Hyperlegible Next', url: atk4ix, style: 'italic', weight: '400', range: LATIN_EXT, variable: false },
];

/** Bundled font ids (same ids as src/lib/design/fonts.ts) -> CSS stack. */
export const FONT_STACKS: Record<string, string> = {
  literata: "'Literata Variable', Georgia, 'Times New Roman', serif",
  'source-serif-4': "'Source Serif 4 Variable', Georgia, 'Times New Roman', serif",
  inter: "'Inter Variable', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  'atkinson-hyperlegible': "'Atkinson Hyperlegible Next', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif",
  'jetbrains-mono': "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace",
};
export const MONO_STACK = FONT_STACKS['jetbrains-mono']!;

export function fontFaceCss(files: FontFile[], base: string): string {
  return files
    .map((f) => {
      const url = new URL(f.url, base).href;
      return `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url("${url}") format("woff2${f.variable ? '-variations' : ''}");unicode-range:${f.range}}`;
    })
    .join('\n');
}

/** CSS font stack for a FontChoice, or null for 'publisher'. Unknown ids are installed system families. */
export function stackFor(choice: string): string | null {
  if (choice === 'publisher') return null;
  const known = FONT_STACKS[choice];
  if (known) return known;
  const fam = choice.replace(/^system:/, '').replace(/['"\\]/g, '');
  return `'${fam}', Georgia, 'Times New Roman', serif`;
}
