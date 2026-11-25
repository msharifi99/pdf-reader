/** Settings search: rows hide themselves when they don't match; sections with no visible row hide via CSS :has(). */
import { getContext, setContext } from 'svelte';

const KEY = Symbol('settings-search');

export class SettingsSearch {
  query = $state('');
  /** every word of the query appears somewhere in the texts (word-prefix friendly, not fuzzy: settings should feel exact) */
  matches(...texts: (string | undefined)[]): boolean {
    const terms = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const hay = texts.filter(Boolean).join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  }
  get active(): boolean {
    return this.query.trim().length > 0;
  }
}

export function provideSearch(s: SettingsSearch): void {
  setContext(KEY, s);
}

export function useSearch(): SettingsSearch {
  return getContext<SettingsSearch>(KEY) ?? new SettingsSearch();
}
