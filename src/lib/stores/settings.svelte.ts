/**
 * App settings: typed, defaulted, persisted. One setting key per top-level field, so the core's
 * `get_setting(key)` / `set_setting(key, value)` map 1:1.
 *
 *   import { settings } from '../stores/settings.svelte';
 *   settings.value.theme                 // reactive read
 *   settings.set('theme', 'sepia')       // write + debounced persist
 *   settings.update('typography', (t) => ({ ...t, fontSize: 20 }))
 *   await settings.ready                 // after boot load
 *
 * Adapter: the core (`getAllSettings` / `setSetting`) when the bindings have it, else localStorage.
 * `settings.adapterKind` says which one is active.
 */
import type { Flow, TypographyProfile } from '../engines/types';
import type { KeymapDiff } from '../commands';
import type { ThemeSeed } from '../design/themes';
import { defaultTypography } from '../design/fonts';
import { core } from '../core/core';

export type PageTint = 'smart' | 'invert' | 'original';
export type ComicMode = 'single' | 'double' | 'webtoon';

export interface NamedTypography {
  id: string;
  name: string;
  profile: TypographyProfile;
}

export interface CustomThemeSeed extends ThemeSeed {
  id: string;
}

export interface Settings {
  /** theme id used when not following Windows */
  theme: string;
  followSystem: boolean;
  lightTheme: string;
  darkTheme: string;
  customThemes: CustomThemeSeed[];
  /** forces reduced motion on; off = follow Windows */
  reduceMotion: boolean;
  pageTint: PageTint;
  flowPdf: Flow;
  flowReflow: Flow;
  comicMode: ComicMode;
  pageAnimations: boolean;
  /** ms of idle before the reader chrome fades */
  chromeHideDelay: number;
  /** the global Typography Profile (what reflowable books use unless overridden per book) */
  typography: TypographyProfile;
  typographyProfiles: NamedTypography[];
  /** id of the named profile `typography` mirrors; null = unnamed "Default" */
  activeTypographyProfile: string | null;
  /** user keymap diff (KeymapDiff); null = shipped defaults */
  keymap: KeymapDiff | null;
  /** library home: cover grid or compact list, and the sort order (T7) */
  library: { view: 'grid' | 'list'; sort: 'recent' | 'added' | 'title' | 'author' | 'progress'; reverse: boolean };
  /** reader conveniences (T8): progress line, sidebar, ruler, auto-scroll */
  reader: ReaderPrefs;
}

export interface ReaderPrefs {
  /** keep the 2px progress line visible while the chrome is hidden */
  progressLine: boolean;
  sidebarWidth: number;
  sidebarTab: 'toc' | 'pages';
  /** reading ruler band height, px */
  rulerHeight: number;
  /** auto-scroll speed in scrolled flows, px/s */
  autoScrollSpeed: number;
  /** auto page-turn interval in paginated flows, s */
  autoTurnSeconds: number;
}

export const SETTINGS_DEFAULTS: Readonly<Settings> = Object.freeze({
  theme: 'dark',
  followSystem: false,
  lightTheme: 'solarized-light',
  darkTheme: 'dark',
  customThemes: [],
  reduceMotion: false,
  pageTint: 'smart',
  flowPdf: 'scrolled',
  flowReflow: 'paginated',
  comicMode: 'single',
  pageAnimations: true,
  chromeHideDelay: 2000,
  typography: defaultTypography,
  typographyProfiles: [],
  activeTypographyProfile: null,
  keymap: null,
  library: { view: 'grid' as const, sort: 'recent' as const, reverse: false },
  reader: { progressLine: true, sidebarWidth: 300, sidebarTab: 'toc' as const, rulerHeight: 84, autoScrollSpeed: 40, autoTurnSeconds: 20 },
});

export type SettingKey = keyof Settings;

export interface SettingsAdapter {
  readonly kind: 'core' | 'localStorage' | 'memory';
  loadAll(): Promise<Record<string, unknown>>;
  save(key: string, value: unknown): Promise<void>;
}

/** tauri-specta returns `{status, data|error}` for fallible commands; accept both shapes. */
function unwrap<T>(r: unknown): T {
  if (r && typeof r === 'object' && 'status' in r) {
    const o = r as { status: string; data?: T; error?: unknown };
    if (o.status === 'error') throw o.error;
    return o.data as T;
  }
  return r as T;
}

type LooseCore = Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined>;

export function coreAdapter(): SettingsAdapter | null {
  const c = core as unknown as LooseCore;
  const getAll = c.getAllSettings;
  const set = c.setSetting;
  if (typeof getAll !== 'function' || typeof set !== 'function') return null;
  return {
    kind: 'core',
    loadAll: async () => unwrap<Record<string, unknown>>(await getAll()) ?? {},
    save: async (key, value) => void unwrap(await set(key, value)),
  };
}

export function localStorageAdapter(prefix = 'quire.setting.'): SettingsAdapter {
  return {
    kind: 'localStorage',
    loadAll: async () => {
      const out: Record<string, unknown> = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k?.startsWith(prefix)) continue;
          try {
            out[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k)!);
          } catch {
            /* one corrupt key never blocks the rest */
          }
        }
      } catch {
        /* storage unavailable */
      }
      return out;
    },
    save: async (key, value) => {
      localStorage.setItem(prefix + key, JSON.stringify(value));
    },
  };
}

export function memoryAdapter(initial: Record<string, unknown> = {}): SettingsAdapter {
  const data = { ...initial };
  return { kind: 'memory', loadAll: async () => ({ ...data }), save: async (k, v) => void (data[k] = v) };
}

/** Keep only stored values whose shape matches the default (storage is a trust boundary). */
export function sanitize(raw: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS_DEFAULTS) as SettingKey[]) {
    const def = SETTINGS_DEFAULTS[key] as unknown;
    const v = raw[key];
    if (v === undefined) continue;
    if (key === 'keymap' || key === 'activeTypographyProfile') {
      if (v === null || typeof v === (key === 'keymap' ? 'object' : 'string')) out[key] = v;
    } else if (Array.isArray(def)) {
      if (Array.isArray(v)) out[key] = v.filter((x) => x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string');
    } else if (def && typeof def === 'object') {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[key] = { ...(def as object), ...(v as object) };
    } else if (typeof v === typeof def) out[key] = v;
  }
  return out as Partial<Settings>;
}

const clone = <T>(v: T): T => structuredClone(v);

class SettingsStore {
  value = $state<Settings>(clone(SETTINGS_DEFAULTS) as Settings);
  adapterKind = $state<SettingsAdapter['kind']>('memory');
  ready: Promise<void>;
  #adapter: SettingsAdapter = memoryAdapter();
  #timers = new Map<string, ReturnType<typeof setTimeout>>();
  #resolve!: () => void;

  constructor() {
    this.ready = new Promise((r) => (this.#resolve = r));
  }

  /** Load once at boot. Falls back to localStorage if the core adapter fails. */
  async init(adapter?: SettingsAdapter): Promise<void> {
    const chosen = adapter ?? coreAdapter() ?? localStorageAdapter();
    let raw: Record<string, unknown> = {};
    try {
      raw = await chosen.loadAll();
      this.#adapter = chosen;
    } catch (err) {
      console.warn('[settings] core load failed, using localStorage', err);
      this.#adapter = localStorageAdapter();
      raw = await this.#adapter.loadAll();
    }
    this.adapterKind = this.#adapter.kind;
    Object.assign(this.value, sanitize(raw));
    this.#resolve();
  }

  get<K extends SettingKey>(key: K): Settings[K] {
    return this.value[key];
  }

  set<K extends SettingKey>(key: K, v: Settings[K]): void {
    this.value[key] = v;
    this.#schedule(key);
  }

  update<K extends SettingKey>(key: K, fn: (v: Settings[K]) => Settings[K]): void {
    this.set(key, fn($state.snapshot(this.value[key]) as Settings[K]));
  }

  reset(key: SettingKey): void {
    this.set(key, clone(SETTINGS_DEFAULTS[key]) as never);
  }

  /** Persist everything pending now (page hide, tests). */
  async flush(): Promise<void> {
    const keys = [...this.#timers.keys()];
    for (const k of keys) clearTimeout(this.#timers.get(k));
    this.#timers.clear();
    await Promise.all(keys.map((k) => this.#persist(k as SettingKey)));
  }

  #schedule(key: SettingKey) {
    clearTimeout(this.#timers.get(key));
    // sliders fire continuously; one write per pause
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        void this.#persist(key);
      }, 150),
    );
  }

  async #persist(key: SettingKey) {
    try {
      await this.#adapter.save(key, $state.snapshot(this.value[key]));
    } catch (err) {
      console.error(`[settings] could not save "${key}"`, err);
    }
  }
}

export const settings = new SettingsStore();
