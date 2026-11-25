/**
 * Theme management: resolves the active theme from settings (fixed or following Windows), applies it
 * with the design system's cross-fade, keeps the native Mica variant in sync, and caches the last
 * theme so the next boot paints the right background before any JS runs (index.html).
 *
 *   import { allThemes, themeById, activeTheme, installThemeManager } from '../shell/theme.svelte';
 */
import { applyTheme, builtinThemes, deriveTheme, themeVars, type AppTheme } from '../design/themes';
import { settings, type CustomThemeSeed } from '../stores/settings.svelte';
import { isTauri } from '../core/core';

export const BOOT_KEY = 'quire.boot';

const derived = new Map<string, { key: string; theme: AppTheme }>();

export function themeFromSeed(seed: CustomThemeSeed): AppTheme {
  const key = JSON.stringify(seed);
  const hit = derived.get(seed.id);
  if (hit?.key === key) return hit.theme;
  const theme = deriveTheme(seed);
  derived.set(seed.id, { key, theme });
  return theme;
}

/** Built-in themes followed by the user's own (reactive through settings). */
export function allThemes(): AppTheme[] {
  const custom: AppTheme[] = [];
  for (const s of settings.value.customThemes) {
    try {
      custom.push(themeFromSeed(s));
    } catch {
      /* a malformed stored seed is skipped, never fatal */
    }
  }
  return [...builtinThemes, ...custom];
}

export function themeById(id: string): AppTheme | undefined {
  return allThemes().find((t) => t.id === id);
}

const systemDark = $state({ value: typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches });

/** The theme that should be showing right now. */
export function activeTheme(): AppTheme {
  const s = settings.value;
  const id = s.followSystem ? (systemDark.value ? s.darkTheme : s.lightTheme) : s.theme;
  return themeById(id) ?? builtinThemes[0]!;
}

/** Ask the native window for the matching Mica tint. Needs `core:window:allow-set-theme` (see report). */
async function setMica(variant: 'light' | 'dark') {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(variant);
  } catch (err) {
    console.debug('[theme] Mica variant not set', err);
  }
}

function remember(t: AppTheme) {
  try {
    const mica = document.documentElement.hasAttribute('data-mica');
    localStorage.setItem(BOOT_KEY, JSON.stringify({ id: t.id, kind: t.dark ? 'dark' : 'light', vars: themeVars(t), mica }));
  } catch {
    /* storage unavailable: next boot just starts on Dark */
  }
}

/** Apply the cached boot theme synchronously (main.ts, before mount). */
export function applyBootTheme(): void {
  try {
    const raw = localStorage.getItem(BOOT_KEY);
    if (!raw) return;
    const b = JSON.parse(raw) as { id: string; kind: string; vars: Record<string, string> };
    const root = document.documentElement;
    for (const [k, v] of Object.entries(b.vars)) {
      if (k === 'color-scheme') root.style.colorScheme = v;
      else root.style.setProperty(k, v);
    }
    root.dataset.theme = b.id;
    root.dataset.themeKind = b.kind;
  } catch {
    /* ignore */
  }
}

/** Reactive theme application. Call once inside the root component (needs an effect owner). */
export function installThemeManager(): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => (systemDark.value = mq.matches);
  mq.addEventListener('change', onScheme);
  let first = true;
  let lastId = '';
  let lastKey = '';

  const stop = $effect.root(() => {
    $effect(() => {
      const t = activeTheme();
      const key = JSON.stringify(themeVars(t));
      if (t.id === lastId && key === lastKey) return;
      lastId = t.id;
      lastKey = key;
      const animate = !first;
      first = false;
      void applyTheme(t, { animate }).then((mica) => {
        void setMica(mica);
        remember(t);
      });
    });
    $effect(() => {
      const root = document.documentElement;
      if (settings.value.reduceMotion) root.dataset.reduceMotion = 'on';
      else delete root.dataset.reduceMotion;
    });
  });
  return () => {
    stop();
    mq.removeEventListener('change', onScheme);
  };
}

/** Cycle to the next theme (fixes the choice: following Windows turns off). */
export function nextTheme(): void {
  const list = allThemes();
  const cur = activeTheme();
  const i = list.findIndex((t) => t.id === cur.id);
  setTheme(list[(i + 1) % list.length]!.id);
}

export function setTheme(id: string): void {
  if (settings.value.followSystem) settings.set('followSystem', false);
  settings.set('theme', id);
}
