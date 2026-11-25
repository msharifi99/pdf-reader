import { core } from '../core/core';
import type { DictResult } from '../core/bindings';
import { normalizeSelection } from './normalize';

export interface LookupResult {
  /** Normalised term (also what Wikipedia would be asked for). */
  query: string;
  words: number;
  /** Offline dictionary hit (single words and phrases); null when there is none. */
  dictionary: DictResult | null;
  /** Near matches when a single word wasn't found (typos, odd inflections). */
  suggestions: string[];
  /** Offer a Wikipedia summary button (never fetched automatically). False for over-long selections. */
  wikipedia: boolean;
  /** The dictionary file is missing or unreadable. */
  dictionaryError?: string;
}

/** Offline part of a lookup. Null for an empty selection. Never touches the network. */
export async function lookup(selectionText: string): Promise<LookupResult | null> {
  const n = normalizeSelection(selectionText);
  if (!n) return null;
  const out: LookupResult = { query: n.text, words: n.words, dictionary: null, suggestions: [], wikipedia: !n.tooLong };
  if (n.tooLong) return out;
  try {
    out.dictionary = (await core.lookupWord(n.dictQuery)) ?? null;
    if (!out.dictionary && n.words === 1) {
      const prefix = n.dictQuery.slice(0, Math.max(2, n.dictQuery.length - 2));
      out.suggestions = (await core.suggestWords(prefix, 5)).filter((w) => w.toLowerCase() !== n.dictQuery.toLowerCase());
    }
  } catch (e) {
    out.dictionaryError = (e as { message?: string })?.message ?? 'The dictionary is unavailable.';
  }
  return out;
}
