/**
 * Wikipedia summary lookup. Only ever called from an explicit user action, and only the selected
 * term leaves the machine (in the URL). Calm typed errors, an LRU cache, no personal data in headers.
 */

export type WikiErrorCode = 'offline' | 'timeout' | 'not-found' | 'http' | 'aborted';

export class WikiError extends Error {
  constructor(
    readonly code: WikiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WikiError';
  }
}

export interface WikiSummary {
  title: string;
  /** Plain-text summary paragraph. */
  extract: string;
  /** Short description ("American author"), if any. */
  description?: string;
  url: string;
  lang: string;
}

export interface WikiChoice {
  title: string;
  description?: string;
}

export type WikiResult =
  | { kind: 'summary'; summary: WikiSummary }
  /** A disambiguation page, or no exact page: the closest titles to pick from. */
  | { kind: 'choices'; reason: 'disambiguation' | 'not-found'; title: string; choices: WikiChoice[] };

export interface WikiOptions {
  /** Book language (BCP-47, e.g. "fr-FR"); unsupported languages fall back to English. */
  lang?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

export const WIKI_USER_AGENT = 'Quire/0.1 (desktop reader)';
const MAX_TERM = 200;

/** Wikipedia editions Quire will talk to (the 40-odd biggest). The CSP allows `https://*.wikipedia.org`. */
export const WIKI_LANGS: ReadonlySet<string> = new Set(
  'en de fr es it pt nl ru ja zh pl sv ar uk ca fi cs hu tr ko no da he id vi fa ro el bg sr hr sk lt sl et lv hi th eu gl'.split(' '),
);

export function wikiLang(bookLang?: string | null): string {
  const l = (bookLang ?? '').toLowerCase().split(/[-_]/)[0];
  return WIKI_LANGS.has(l) ? l : 'en';
}

// ---- LRU cache ---------------------------------------------------------------------------------
const CACHE_MAX = 60;
const cache = new Map<string, WikiResult>();
export function clearWikiCache(): void {
  cache.clear();
}

type Json = Record<string, any>;

async function getJson(url: string, o: WikiOptions): Promise<{ status: number; body: Json | null }> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new WikiError('offline', "You're offline. Wikipedia needs a connection.");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('timeout'), o.timeoutMs ?? 8000);
  const onAbort = () => ctl.abort('user');
  o.signal?.addEventListener('abort', onAbort);
  if (o.signal?.aborted) onAbort();
  try {
    const res = await (o.fetch ?? fetch)(url, { signal: ctl.signal, headers: { 'Api-User-Agent': WIKI_USER_AGENT, Accept: 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (res.status === 404) return { status: 404, body: null };
    if (!res.ok) throw new WikiError('http', 'Wikipedia is having trouble right now. Try again in a moment.');
    return { status: res.status, body: (await res.json()) as Json };
  } catch (e) {
    if (e instanceof WikiError) throw e;
    if (ctl.signal.aborted) throw new WikiError(ctl.signal.reason === 'timeout' ? 'timeout' : 'aborted', ctl.signal.reason === 'timeout' ? 'Wikipedia took too long to answer.' : 'Cancelled.');
    throw new WikiError('offline', "Couldn't reach Wikipedia. Check your connection.");
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

/** Closest page titles to `term` (opensearch), for disambiguation pages and misses. */
async function related(term: string, lang: string, o: WikiOptions): Promise<WikiChoice[]> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=6&namespace=0&search=${encodeURIComponent(term)}`;
  const { body } = await getJson(url, o);
  const arr = body as unknown as [string, string[], string[]] | null;
  const titles = Array.isArray(arr) ? arr[1] : [];
  return titles.map((title, i) => ({ title, description: arr![2]?.[i] || undefined }));
}

/**
 * Fetch the summary for `term`. Redirects are followed by Wikipedia. A disambiguation page or a
 * miss resolves with `kind: 'choices'`; offline / timeout / server errors reject with a `WikiError`.
 */
export async function fetchWikipedia(term: string, o: WikiOptions = {}): Promise<WikiResult> {
  const t = term.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM);
  if (!t) throw new WikiError('not-found', 'Nothing to look up.');
  const lang = wikiLang(o.lang);
  const key = `${lang}:${t.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const { body } = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}?redirect=true`, o);
  let result: WikiResult;
  if (!body) {
    const choices = await related(t, lang, o);
    if (!choices.length) throw new WikiError('not-found', `Wikipedia has no page for “${t}”.`);
    result = { kind: 'choices', reason: 'not-found', title: t, choices };
  } else if (body.type === 'disambiguation') {
    const title = String(body.title ?? t);
    result = { kind: 'choices', reason: 'disambiguation', title, choices: (await related(title, lang, o)).filter((c) => c.title !== title) };
  } else {
    result = {
      kind: 'summary',
      summary: {
        title: String(body.title ?? t),
        extract: String(body.extract ?? ''),
        description: typeof body.description === 'string' ? body.description : undefined,
        url: String(body.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`),
        lang,
      },
    };
  }
  cache.set(key, result);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return result;
}
