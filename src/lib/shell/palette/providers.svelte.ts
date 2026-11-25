/**
 * Command palette state + provider API.
 *
 * Modes come from the query prefix (`>` commands, `@` TOC, `#` go to, `/` search in book) or from
 * a picker opened directly (Ctrl+P book switcher). The shell provides 'default' and 'commands';
 * other areas register the rest while they are relevant:
 *
 *   import { registerPaletteProvider, openPalette } from '../shell/palette/providers.svelte';
 *   const off = registerPaletteProvider({
 *     mode: 'toc',                       // 'toc' | 'goto' | 'search' | any picker id ('books', 'annotations')
 *     label: 'Headings',                 // footer chip / screen reader
 *     placeholder: 'Jump to a chapter',
 *     query: (q, signal) => toc.map(e => ({ id: e.id, title: e.title, detail: `p. ${e.page}`, run: () => go(e) })),
 *   });
 *   // in onDestroy: off()
 *   openPalette({ prefix: '#' })         // "Go to…" opens pre-filled
 *   openPalette({ mode: 'books' })       // a picker: no prefix, its own placeholder
 *
 * `query` may be async; it is called on every keystroke with an AbortSignal for the previous call.
 * Items can return `indices` (into `title`) to emphasise matched characters — `rankItems` gives them.
 */
import type { PaletteMode, PaletteQuery } from '../../commands';
import type { IconName } from '../../ui';
import { openOverlay } from '../overlays.svelte';

export interface PaletteItem {
  id: string;
  title: string;
  /** muted text after the title (page number, author, context) */
  detail?: string;
  /** group header (category); consecutive items with the same group share one header */
  group?: string;
  icon?: IconName;
  /** a small book cover instead of an icon (Ctrl+P switcher): image URL, or a tinted block of `hue` */
  thumb?: { src: string | null; hue: number };
  /** display label, e.g. "Ctrl+K" or "g g" */
  shortcut?: string;
  /** matched character indices into `title` */
  indices?: number[];
  run(): void | Promise<void>;
}

export interface PaletteProvider {
  /** a palette mode, or a picker id opened with `openPalette({ mode })` */
  mode: PaletteMode | (string & {});
  label: string;
  placeholder?: string;
  /** shown when the query matches nothing */
  emptyText?: string;
  query(q: PaletteQuery, signal: AbortSignal): PaletteItem[] | Promise<PaletteItem[]>;
}

const providers = $state<PaletteProvider[]>([]);

export const paletteState = $state<{ input: string; picker: string | null; openCount: number }>({
  input: '',
  picker: null,
  openCount: 0,
});

/** Register a provider; a later registration for the same mode wins until it unregisters. */
export function registerPaletteProvider(p: PaletteProvider): () => void {
  providers.push(p);
  return () => {
    const i = providers.lastIndexOf(p);
    if (i >= 0) providers.splice(i, 1);
  };
}

export function providerFor(mode: string): PaletteProvider | undefined {
  for (let i = providers.length - 1; i >= 0; i--) if (providers[i]!.mode === mode) return providers[i];
  return undefined;
}

export function openPalette(opts: { prefix?: string; mode?: string; text?: string } = {}): void {
  paletteState.picker = opts.mode && !['default', 'commands', 'toc', 'goto', 'search'].includes(opts.mode) ? opts.mode : null;
  paletteState.input = paletteState.picker ? (opts.text ?? '') : (opts.prefix ?? '') + (opts.text ?? '');
  paletteState.openCount++;
  openOverlay('palette');
}
