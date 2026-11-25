import type { DictResult } from '../core/bindings';
import type { Rect } from '../engines/types';
import { lookup, type LookupResult } from './lookup';
import { fetchWikipedia, WikiError, type WikiResult } from './wikipedia';

export type WikiState =
  | { status: 'idle' }
  | { status: 'loading'; term: string }
  | { status: 'ready'; result: WikiResult }
  | { status: 'error'; code: WikiError['code']; message: string; term: string };

/** Popover state for the UI. `show()` opens and resolves the offline dictionary; Wikipedia only on `askWikipedia()`. */
class LookupStore {
  open = $state(false);
  status = $state<'idle' | 'loading' | 'ready'>('idle');
  /** Selection rect in viewport coordinates, for positioning. */
  anchor = $state.raw<Rect | null>(null);
  lang = $state<string | null>(null);
  result = $state.raw<LookupResult | null>(null);
  wiki = $state.raw<WikiState>({ status: 'idle' });
  #seq = 0;
  #abort: AbortController | null = null;

  get dictionary(): DictResult | null {
    return this.result?.dictionary ?? null;
  }

  async show(text: string, opts: { lang?: string | null; rect?: Rect | null } = {}): Promise<void> {
    const seq = ++this.#seq;
    this.#abort?.abort();
    this.lang = opts.lang ?? null;
    this.anchor = opts.rect ?? null;
    this.wiki = { status: 'idle' };
    this.result = null;
    this.open = true;
    this.status = 'loading';
    const r = await lookup(text);
    if (seq !== this.#seq) return;
    if (!r) return this.close();
    this.result = r;
    this.status = 'ready';
  }

  /** Explicit user action: sends the term (or a chosen title) to Wikipedia. */
  async askWikipedia(term?: string): Promise<void> {
    const t = term ?? this.result?.query;
    if (!t) return;
    this.#abort?.abort();
    const ctl = (this.#abort = new AbortController());
    const seq = this.#seq;
    this.wiki = { status: 'loading', term: t };
    try {
      const result = await fetchWikipedia(t, { lang: this.lang, signal: ctl.signal });
      if (seq === this.#seq && !ctl.signal.aborted) this.wiki = { status: 'ready', result };
    } catch (e) {
      if (seq !== this.#seq || ctl.signal.aborted) return;
      const err = e instanceof WikiError ? e : new WikiError('http', 'Something went wrong.');
      this.wiki = { status: 'error', code: err.code, message: err.message, term: t };
    }
  }

  close(): void {
    this.#seq++;
    this.#abort?.abort();
    this.open = false;
    this.status = 'idle';
    this.result = null;
    this.wiki = { status: 'idle' };
  }
}

export const lookupPopover = new LookupStore();
