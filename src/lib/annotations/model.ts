/** Annotation shapes the UI works with: the core record with its anchor parsed, plus small helpers. */
import type { Annotation, AnnotationKind } from '../core/bindings';
import type { Anchor, Locator } from '../engines/types';
import { highlightColors, type HighlightColor } from '../design/themes';

export type Ann = Omit<Annotation, 'anchor'> & { anchor: Anchor };
export type { AnnotationKind, HighlightColor };
export { highlightColors };

export const COLOR_LABEL: Record<HighlightColor, string> = { yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' };

export const asColor = (c: string | null | undefined): HighlightColor => (highlightColors.includes(c as HighlightColor) ? (c as HighlightColor) : 'yellow');
export const colorIndex = (c: string | null | undefined): 0 | 1 | 2 | 3 => highlightColors.indexOf(asColor(c)) as 0 | 1 | 2 | 3;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function parseLocator(v: unknown): Locator {
  if (isObj(v) && v.kind === 'reflow') return { kind: 'reflow', cfi: String(v.cfi ?? ''), fraction: Number(v.fraction) || 0 };
  if (isObj(v) && v.kind === 'fixed') return { kind: 'fixed', page: Math.max(0, Math.floor(Number(v.page) || 0)), ...(v.y != null ? { y: Number(v.y) || 0 } : {}) };
  return { kind: 'fixed', page: 0 };
}

/** Anchor JSON from the core, made safe to hand to an engine (never throws). */
export function parseAnchor(j: unknown): Anchor {
  const o = isObj(j) ? j : {};
  const q = isObj(o.quote) ? o.quote : {};
  const a: Anchor = {
    locator: parseLocator(o.locator),
    quote: { exact: String(q.exact ?? ''), prefix: String(q.prefix ?? ''), suffix: String(q.suffix ?? '') },
  };
  if (Array.isArray(o.pdfQuads)) a.pdfQuads = o.pdfQuads.filter((x): x is number[] => Array.isArray(x) && x.length === 4 && x.every((n) => typeof n === 'number'));
  if (typeof o.cfiRange === 'string') a.cfiRange = o.cfiRange;
  return a;
}

/** '' means "cleared" in the core (its patch treats null as "unchanged"). */
export const toAnn = (a: Annotation): Ann => ({ ...a, anchor: parseAnchor(a.anchor), note: a.note?.trim() ? a.note : null, label: a.label?.trim() ? a.label : null });

export const isMark = (a: Pick<Ann, 'type'>): boolean => a.type !== 'bookmark';

/** 0..1 position in the book, for sorting and grouping. */
export function position(l: Locator, pageCount = 1): number {
  return l.kind === 'reflow' ? l.fraction : (l.page + Math.min(0.999, Math.max(0, l.y ?? 0))) / Math.max(1, pageCount);
}

/** "p. 12" (fixed, printed labels when known) or "34%" (reflowable). */
export function whereLabel(l: Locator, pageLabels?: string[]): string {
  if (l.kind === 'fixed') return `p. ${pageLabels?.[l.page] ?? l.page + 1}`;
  return `${Math.round(l.fraction * 100)}%`;
}

/** The passage text an annotation shows: the quote, or for bookmarks the text that follows the position. */
export const passage = (a: Ann): string => (a.type === 'bookmark' ? a.anchor.quote.suffix : a.anchor.quote.exact).replace(/\s+/g, ' ').trim();
