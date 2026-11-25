/**
 * Lookup (stories 84, 85): offline WordNet dictionary + on-demand Wikipedia summary.
 *
 *   import { lookupPopover, lookup, fetchWikipedia, registerLookupCommands, wikiLang } from '../lookup';
 *
 * Popover state (Svelte runes, bind the UI to it):
 *   lookupPopover.open / .status ('idle'|'loading'|'ready') / .anchor (viewport Rect | null)
 *   lookupPopover.result    -> LookupResult | null   { query, words, dictionary, suggestions, wikipedia, dictionaryError? }
 *   lookupPopover.dictionary-> DictResult | null     { lemma, form, entries: [{ lemma, pos, definitions: [{ text, examples }], synonyms }] }
 *   lookupPopover.wiki      -> { status: 'idle' } | { status: 'loading', term }
 *                            | { status: 'ready', result: WikiResult } | { status: 'error', code, message, term }
 *   await lookupPopover.show(selectionText, { lang: bookLanguage, rect })   // dictionary only (offline)
 *   await lookupPopover.askWikipedia()          // explicit user click: sends only the term
 *   await lookupPopover.askWikipedia(title)     // a title picked from a `choices` result
 *   lookupPopover.close()
 *
 * Pure functions:
 *   lookup(text) -> LookupResult | null           // dictionary only; single word first, else phrase
 *   fetchWikipedia(term, { lang, signal }) -> WikiResult
 *       { kind: 'summary', summary: { title, extract, description?, url, lang } }
 *     | { kind: 'choices', reason: 'disambiguation' | 'not-found', title, choices: [{ title, description? }] }
 *     throws WikiError with code 'offline' | 'timeout' | 'not-found' | 'http' | 'aborted' (message is user-ready)
 *   wikiLang(bookLanguage) -> supported Wikipedia edition or 'en'
 *   normalizeSelection(text) -> { text, dictQuery, words, tooLong } | null
 *   core.suggestWords(prefix, limit)               // search-as-you-type headwords
 *
 * Commands: `registerLookupCommands(getSelection)` (call from the reader view; returns an unregister
 * function) registers `lookup.define` ("Look up selection") and `lookup.wikipedia`.
 * `getSelection` returns `{ text, rect?, lang? } | null`. They have no default key binding.
 * Note: Wikipedia thumbnails are not exposed (the CSP's img-src does not allow upload.wikimedia.org).
 */
import { commands, type Command } from '../commands';
import type { Rect } from '../engines/types';
import { lookupPopover } from './store.svelte';

export { lookup, type LookupResult } from './lookup';
export { normalizeSelection, type Normalized } from './normalize';
export { fetchWikipedia, wikiLang, WikiError, WIKI_LANGS, clearWikiCache, type WikiResult, type WikiSummary, type WikiChoice, type WikiErrorCode } from './wikipedia';
export { lookupPopover, type WikiState } from './store.svelte';

export interface LookupSelection {
  text: string;
  rect?: Rect | null;
  /** Book language (BCP-47). */
  lang?: string | null;
}

export function registerLookupCommands(getSelection: () => LookupSelection | null): () => void {
  const base = { category: 'Reading', contexts: ['reader'] as Command['contexts'], enabled: () => !!getSelection()?.text.trim() };
  return commands.register([
    {
      ...base,
      id: 'lookup.define',
      title: 'Look up selection (dictionary)',
      keywords: ['define', 'dictionary', 'meaning', 'word'],
      run: () => {
        const s = getSelection();
        if (s) return lookupPopover.show(s.text, { lang: s.lang, rect: s.rect });
      },
    },
    {
      ...base,
      id: 'lookup.wikipedia',
      title: 'Look up selection on Wikipedia',
      keywords: ['wiki', 'encyclopedia', 'summary'],
      run: async () => {
        const s = getSelection();
        if (!s) return;
        await lookupPopover.show(s.text, { lang: s.lang, rect: s.rect });
        await lookupPopover.askWikipedia();
      },
    },
  ]);
}
