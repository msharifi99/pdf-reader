/**
 * Palette query parsing (pure). UI agents inject the providers for each mode.
 *   (none)  default  commands + recent
 *   >       commands
 *   @       TOC entries
 *   #       go to page (`#42`) or percentage (`#37%`)
 *   /       search in book
 */
export type PaletteMode = 'default' | 'commands' | 'toc' | 'goto' | 'search';

export type GotoTarget = { kind: 'page'; page: number } | { kind: 'percent'; percent: number };

export interface PaletteQuery {
  mode: PaletteMode;
  /** query text with the prefix (and its leading whitespace) removed */
  text: string;
  /** only for mode 'goto'; null when the text is not (yet) a valid target */
  goto?: GotoTarget | null;
}

export const PALETTE_PREFIXES: Readonly<Record<string, PaletteMode>> = { '>': 'commands', '@': 'toc', '#': 'goto', '/': 'search' };

/** Provider contract the UI layer implements per mode. */
export interface PaletteItem {
  id: string;
  title: string;
  detail?: string;
  /** shortcut label shown on the right */
  shortcut?: string;
  indices?: number[];
  run(): void | Promise<void>;
}
export interface PaletteProvider {
  mode: PaletteMode;
  query(q: PaletteQuery): PaletteItem[] | Promise<PaletteItem[]>;
}

export function parseGoto(text: string): GotoTarget | null {
  const t = text.trim();
  let m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) {
    const percent = parseFloat(m[1]!);
    return percent >= 0 && percent <= 100 ? { kind: 'percent', percent } : null;
  }
  m = /^(\d+)$/.exec(t);
  if (m) {
    const page = parseInt(m[1]!, 10);
    return page >= 1 ? { kind: 'page', page } : null;
  }
  return null;
}

export function parsePaletteQuery(input: string): PaletteQuery {
  const s = input.trimStart();
  const mode = PALETTE_PREFIXES[s[0] ?? ''];
  if (!mode) return { mode: 'default', text: s.trimEnd() };
  const text = s.slice(1).trim();
  return mode === 'goto' ? { mode, text, goto: parseGoto(text) } : { mode, text };
}

/** Prefix char for a mode ('' for default) — used when a Command opens the palette pre-filled (e.g. "Go to…" => '#'). */
export function prefixFor(mode: PaletteMode): string {
  return Object.entries(PALETTE_PREFIXES).find(([, m]) => m === mode)?.[0] ?? '';
}
