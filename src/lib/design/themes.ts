// Built-in themes, custom-theme derivation and runtime application.
import { contrast, ensureContrast, isHex, luminance, mix, onColor, parseHex, toHex } from './color';

import type { Theme } from '../engines/types';

export type { Theme };
/** Names for Theme.highlight indices 0..3 (also the CSS vars --hl-yellow ... --hl-pink). */
export const highlightColors = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof highlightColors)[number];

/** Theme (engine-facing, all colours #rrggbb) plus UI-only roles. This is what the app stores and applies. */
export interface AppTheme extends Theme {
  /** Window Mica backdrop variant to request from the native side */
  mica: 'light' | 'dark';
  /** raised surface: menus, inputs, hovered rows */
  surface2: string;
  /** hairline borders and dividers */
  border: string;
  /** text/icon colour on an accent fill */
  onAccent: string;
  /** Blend mode for highlight overlays drawn over fixed-layout pages (PDF/comic) */
  highlightBlend: 'multiply' | 'screen';
  danger: string;
  success: string;
  builtin: boolean;
}

export type BuiltinThemeId = 'dark' | 'solarized-light' | 'light' | 'sepia' | 'oled';

const dark: AppTheme = {
  id: 'dark',
  name: 'Dark',
  dark: true,
  mica: 'dark',
  bg: '#1b1c1f',
  surface: '#222327',
  surface2: '#2a2b30',
  border: '#34353b',
  text: '#e8e4dc',
  muted: '#a19d95',
  accent: '#e2a85e',
  onAccent: '#1b1c1f',
  link: '#8fb8e8',
  selection: '#3a4b66',
  highlight: ['#5f4c1c', '#2c4f36', '#284563', '#5c2f47'],
  highlightBlend: 'screen',
  shadow: '#000000',
  danger: '#ef8a80',
  success: '#8cc79b',
  builtin: true,
};

/** Canonical Solarized: base3 background, base00 body text (by request; 4.1:1, see DESIGN.md). */
const solarizedLight: AppTheme = {
  id: 'solarized-light',
  name: 'Solarized Light',
  dark: false,
  mica: 'light',
  bg: '#fdf6e3', // base3
  surface: '#f6efda',
  surface2: '#eee8d5', // base2
  border: '#e2dbc5',
  text: '#657b83', // base00
  muted: '#7a8c92', // between base00 and base0, keeps >= 3:1
  accent: '#cb4b16', // orange
  onAccent: '#fdf6e3',
  link: '#268bd2', // blue
  selection: '#e4dcc3',
  highlight: ['#f6e3a1', '#dbe8b9', '#cfe2ef', '#f6d3d9'],
  highlightBlend: 'multiply',
  shadow: '#586e75',
  danger: '#dc322f',
  success: '#859900',
  builtin: true,
};

const light: AppTheme = {
  id: 'light',
  name: 'Light',
  dark: false,
  mica: 'light',
  bg: '#fbfaf8',
  surface: '#f4f3f0',
  surface2: '#ecebe7',
  border: '#e3e1dc',
  text: '#1e1d1b',
  muted: '#67645e',
  accent: '#a6521b',
  onAccent: '#ffffff',
  link: '#1f5bb5',
  selection: '#cfe0f8',
  highlight: ['#fbe7a1', '#cfeccf', '#cde3fb', '#f9d2df'],
  highlightBlend: 'multiply',
  shadow: '#1e1d1b',
  danger: '#b3261e',
  success: '#2e7d32',
  builtin: true,
};

const sepia: AppTheme = {
  id: 'sepia',
  name: 'Sepia',
  dark: false,
  mica: 'light',
  bg: '#f3ead6',
  surface: '#ece2cc',
  surface2: '#e4d9c0',
  border: '#dccfb3',
  text: '#3f3121',
  muted: '#715f4a',
  accent: '#9a4a1c',
  onAccent: '#fbf5e8',
  link: '#2e5a86',
  selection: '#e0cfa6',
  highlight: ['#f0d98a', '#d3dfae', '#cbd9e0', '#efcbc6'],
  highlightBlend: 'multiply',
  shadow: '#3f3121',
  danger: '#a1301f',
  success: '#4f6f1f',
  builtin: true,
};

const oled: AppTheme = {
  id: 'oled',
  name: 'OLED Black',
  dark: true,
  mica: 'dark',
  bg: '#000000',
  surface: '#0c0c0e',
  surface2: '#17171a',
  border: '#232327',
  text: '#d9d5cd', // a touch dimmer than Dark: avoids halation on true black
  muted: '#918d86',
  accent: '#e2a85e',
  onAccent: '#000000',
  link: '#8fb8e8',
  selection: '#2b3a52',
  highlight: ['#4d3e14', '#1f3d28', '#1d3550', '#4a2238'],
  highlightBlend: 'screen',
  shadow: '#000000',
  danger: '#ef8a80',
  success: '#8cc79b',
  builtin: true,
};

export const themes: Record<BuiltinThemeId, AppTheme> = {
  dark,
  'solarized-light': solarizedLight,
  light,
  sepia,
  oled,
};

/** Display order for pickers: headline themes first. */
export const builtinThemes: AppTheme[] = [dark, solarizedLight, light, sepia, oled];

export const defaultLightTheme = solarizedLight;
export const defaultDarkTheme = dark;

export function isDark(theme: Pick<Theme, 'bg'>): boolean {
  return luminance(theme.bg) < 0.18;
}

/** What the custom theme editor lets you choose. */
export interface ThemeSeed {
  id?: string;
  name: string;
  bg: string;
  text: string;
  accent: string;
  link: string;
  selection: string;
}

/**
 * Build a full AppTheme from five colours. Text and muted text are guaranteed WCAG AA (4.5:1)
 * on bg, the accent reaches 3:1 (non-text UI), link reaches 4.5:1. Highlights are tuned per
 * light/dark so text under them stays at AA.
 */
export function deriveTheme(seed: ThemeSeed): AppTheme {
  for (const [k, v] of Object.entries(seed)) {
    if (k !== 'id' && k !== 'name' && !isHex(v)) throw new Error(`deriveTheme: ${k} is not a hex colour`);
  }
  const bg = toHex({ ...parseHex(seed.bg), a: 1 }); // normalise to #rrggbb, opaque
  const darkBg = isDark({ bg });
  const text = ensureContrast(seed.text, bg, 4.5);
  const muted = ensureContrast(mix(text, bg, 0.38), bg, 4.5);
  const accent = ensureContrast(seed.accent, bg, 3);
  const link = ensureContrast(seed.link, bg, 4.5);
  const hl = (hue: string) => {
    // light themes: pastel tint of the hue; dark themes: deep, low-luminance version
    return readableUnder(mix(bg, hue, darkBg ? 0.32 : 0.38), bg, text);
  };
  return {
    id: seed.id ?? `custom-${Math.random().toString(36).slice(2, 8)}`,
    name: seed.name,
    dark: darkBg,
    mica: darkBg ? 'dark' : 'light',
    bg,
    surface: mix(bg, text, darkBg ? 0.035 : 0.03),
    surface2: mix(bg, text, darkBg ? 0.07 : 0.06),
    border: mix(bg, text, darkBg ? 0.12 : 0.1),
    text,
    muted,
    accent,
    onAccent: onColor(accent, [bg, text]),
    link,
    selection: readableUnder(seed.selection, bg, text),
    highlight: [
      hl(darkBg ? '#d4a52a' : '#f5c518'),
      hl(darkBg ? '#4caf6a' : '#7ccf7c'),
      hl(darkBg ? '#4a8fd6' : '#6aaef5'),
      hl(darkBg ? '#d05a92' : '#f08cb0'),
    ],
    highlightBlend: darkBg ? 'screen' : 'multiply',
    shadow: darkBg ? '#000000' : mix(text, '#000000', 0.3),
    danger: ensureContrast(darkBg ? '#ef8a80' : '#b3261e', bg, 4.5),
    success: ensureContrast(darkBg ? '#8cc79b' : '#2e7d32', bg, 4.5),
    builtin: false,
  };
}

/** A fill drawn under text (selection, highlight): pull it toward bg until text on it is AA. */
function readableUnder(fill: string, bg: string, text: string): string {
  let s = toHex({ ...parseHex(fill), a: 1 });
  for (let i = 0; i < 12 && contrast(text, s) < 4.5; i++) s = mix(s, bg, 0.25);
  return contrast(text, s) < 4.5 ? bg : s;
}

/** Contrast audit used by tests and the theme editor's warnings. */
export function auditTheme(t: AppTheme) {
  return {
    text: contrast(t.text, t.bg),
    muted: contrast(t.muted, t.bg),
    mutedOnSurface: contrast(t.muted, t.surface2),
    accent: contrast(t.accent, t.bg),
    onAccent: contrast(t.onAccent, t.accent),
    link: contrast(t.link, t.bg),
    selection: contrast(t.text, t.selection),
    highlights: Object.fromEntries(highlightColors.map((c, i) => [c, contrast(t.text, t.highlight[i]!)])) as Record<
      HighlightColor,
      number
    >,
  };
}

const kebab = (s: string) => s.replace(/[A-Z0-9]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for a theme. Usable on :root or any element (scoped previews). */
export function themeVars(t: AppTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of ['bg', 'surface', 'surface2', 'border', 'text', 'muted', 'accent', 'onAccent', 'link', 'selection', 'shadow', 'danger', 'success'] as const) {
    vars[`--${kebab(key)}`] = t[key];
  }
  highlightColors.forEach((c, i) => (vars[`--hl-${c}`] = t.highlight[i]!));
  vars['--hl-blend'] = t.highlightBlend;
  vars['color-scheme'] = t.dark ? 'dark' : 'light';
  return vars;
}

export function themeStyle(t: AppTheme): string {
  return Object.entries(themeVars(t))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

export function reducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  return (
    document.documentElement.dataset.reduceMotion === 'on' ||
    (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

let current: AppTheme | null = null;
export const currentTheme = () => current;

/**
 * Apply a theme to :root. Cross-fades with the View Transitions API when motion is allowed.
 * Resolves after the transition finishes. Returns the Mica variant for the native window.
 */
export async function applyTheme(t: AppTheme, opts: { animate?: boolean } = {}): Promise<AppTheme['mica']> {
  const root = document.documentElement;
  const write = () => {
    for (const [k, v] of Object.entries(themeVars(t))) {
      if (k === 'color-scheme') root.style.colorScheme = v;
      else root.style.setProperty(k, v);
    }
    root.dataset.theme = t.id;
    root.dataset.themeKind = t.dark ? 'dark' : 'light';
    current = t;
  };
  const animate = (opts.animate ?? current !== null) && !reducedMotion() && 'startViewTransition' in document;
  if (!animate) {
    write();
    return t.mica;
  }
  root.dataset.themeTransition = '';
  try {
    await document.startViewTransition(write).finished;
  } finally {
    delete root.dataset.themeTransition;
  }
  return t.mica;
}

/**
 * Follow the Windows light/dark setting. Applies immediately and on every change.
 * Returns an unsubscribe function.
 */
export function followSystem(
  lightTheme: AppTheme,
  darkTheme: AppTheme,
  onApplied?: (t: AppTheme, mica: AppTheme['mica']) => void,
): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const run = async (first: boolean) => {
    const t = mq.matches ? darkTheme : lightTheme;
    const mica = await applyTheme(t, { animate: !first });
    onApplied?.(t, mica);
  };
  const listener = () => void run(false);
  mq.addEventListener('change', listener);
  void run(true);
  return () => mq.removeEventListener('change', listener);
}
