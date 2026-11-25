import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearWikiCache, fetchWikipedia, WikiError, wikiLang, WIKI_USER_AGENT } from './wikipedia';
import { normalizeSelection } from './normalize';

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const fetchOf = (...responses: (Response | Error)[]) => {
  const fn = vi.fn(async (_u: string, _i?: RequestInit) => {
    const r = responses.shift();
    if (!r) throw new Error('unexpected request');
    if (r instanceof Error) throw r;
    return r;
  });
  return fn as typeof fn & typeof fetch;
};

beforeEach(() => clearWikiCache());

describe('normalizeSelection', () => {
  it('trims punctuation, whitespace and soft hyphens', () => {
    expect(normalizeSelection('  “Hello,”  ')?.text).toBe('Hello');
    expect(normalizeSelection('ice\n  cream.')).toMatchObject({ text: 'ice cream', words: 2, tooLong: false });
    expect(normalizeSelection('exam­ple')?.text).toBe('example');
  });
  it('keeps inner punctuation and strips possessives for the dictionary only', () => {
    expect(normalizeSelection('well-known')?.text).toBe('well-known');
    expect(normalizeSelection('dog’s')).toMatchObject({ text: 'dog’s', dictQuery: 'dog' });
  });
  it('rejects empty and over-long selections', () => {
    expect(normalizeSelection(' ,. ')).toBeNull();
    expect(normalizeSelection(null)).toBeNull();
    expect(normalizeSelection('one two three four five six seven')?.tooLong).toBe(true);
  });
});

describe('wikiLang', () => {
  it('uses the book language when supported, else English', () => {
    expect(wikiLang('fr-FR')).toBe('fr');
    expect(wikiLang('nl')).toBe('nl');
    expect(wikiLang('xx')).toBe('en');
    expect(wikiLang(null)).toBe('en');
  });
});

describe('fetchWikipedia', () => {
  it('returns a summary using only the term, a generic user agent and the book language', async () => {
    const f = fetchOf(json({ type: 'standard', title: 'Ada Lovelace', extract: 'English mathematician.', description: 'Mathematician', content_urls: { desktop: { page: 'https://fr.wikipedia.org/wiki/Ada_Lovelace' } } }));
    const r = await fetchWikipedia('Ada Lovelace', { lang: 'fr-CA', fetch: f });
    expect(r).toMatchObject({ kind: 'summary', summary: { title: 'Ada Lovelace', extract: 'English mathematician.', lang: 'fr', url: 'https://fr.wikipedia.org/wiki/Ada_Lovelace' } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://fr.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace?redirect=true');
    expect((init!.headers as Record<string, string>)['Api-User-Agent']).toBe(WIKI_USER_AGENT);
    expect(init!.credentials).toBe('omit');
  });

  it('offers related titles for a disambiguation page', async () => {
    const f = fetchOf(json({ type: 'disambiguation', title: 'Mercury' }), json(['Mercury', ['Mercury', 'Mercury (planet)', 'Mercury (element)'], ['', 'Smallest planet', 'Chemical element'], []]));
    const r = await fetchWikipedia('Mercury', { fetch: f });
    expect(r).toMatchObject({ kind: 'choices', reason: 'disambiguation', choices: [{ title: 'Mercury (planet)', description: 'Smallest planet' }, { title: 'Mercury (element)' }] });
  });

  it('suggests titles on a 404 and says not-found when there are none', async () => {
    const hit = await fetchWikipedia('Lovelac', { fetch: fetchOf(json({}, 404), json(['Lovelac', ['Ada Lovelace'], [''], []])) });
    expect(hit).toMatchObject({ kind: 'choices', reason: 'not-found', choices: [{ title: 'Ada Lovelace' }] });
    await expect(fetchWikipedia('qqzzxx', { fetch: fetchOf(json({}, 404), json(['qqzzxx', [], [], []])) })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reports offline, server trouble and timeouts calmly', async () => {
    await expect(fetchWikipedia('a', { fetch: fetchOf(new TypeError('Failed to fetch')) })).rejects.toMatchObject({ code: 'offline' });
    await expect(fetchWikipedia('b', { fetch: fetchOf(json({}, 503)) })).rejects.toMatchObject({ code: 'http' });
    await expect(fetchWikipedia('c', { fetch: fetchOf(json({}, 503)) })).rejects.toBeInstanceOf(WikiError);
  });

  it('times out and honours the caller abort', async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_u: string, i?: RequestInit) => new Promise<Response>((_, rej) => i!.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))) as unknown as typeof fetch;
    const p = fetchWikipedia('slow', { fetch: hang, timeoutMs: 1000 });
    const check = expect(p).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    const ctl = new AbortController();
    const q = fetchWikipedia('slow2', { fetch: hang, signal: ctl.signal });
    const check2 = expect(q).rejects.toMatchObject({ code: 'aborted' });
    ctl.abort();
    await check2;
    vi.useRealTimers();
  });

  it('caches results (LRU) so a repeat never hits the network', async () => {
    const f = fetchOf(json({ type: 'standard', title: 'Cat', extract: 'A cat.' }));
    const a = await fetchWikipedia('Cat', { fetch: f });
    const b = await fetchWikipedia('cat', { fetch: f });
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('lookup()', () => {
  afterEach(() => vi.resetModules());
  it('single word: dictionary first, with suggestions when missing; never touches Wikipedia', async () => {
    const lookupWord = vi.fn(async (w: string) => (w === 'run' ? { lemma: 'run', form: 'run', entries: [] } : null));
    const suggestWords = vi.fn(async () => ['running', 'runner', 'runt']);
    vi.doMock('../core/core', () => ({ core: { lookupWord, suggestWords } }));
    const { lookup } = await import('./lookup');
    expect((await lookup('“run,”'))?.dictionary?.lemma).toBe('run');
    const miss = await lookup('runz');
    expect(miss).toMatchObject({ dictionary: null, suggestions: ['running', 'runner', 'runt'], wikipedia: true });
    expect(suggestWords).toHaveBeenCalledWith('ru', 5);
    const phrase = await lookup('ice cream');
    expect(lookupWord).toHaveBeenLastCalledWith('ice cream');
    expect(phrase).toMatchObject({ words: 2, suggestions: [] });
    expect(await lookup('...')).toBeNull();
    const long = await lookup('one two three four five six seven eight');
    expect(long).toMatchObject({ dictionary: null, wikipedia: false });
    vi.doUnmock('../core/core');
  });

  it('survives a missing dictionary file', async () => {
    vi.doMock('../core/core', () => ({ core: { lookupWord: async () => Promise.reject({ code: 'NotFound', message: "The dictionary isn't installed." }), suggestWords: async () => [] } }));
    const { lookup } = await import('./lookup');
    expect(await lookup('word')).toMatchObject({ dictionary: null, dictionaryError: "The dictionary isn't installed.", wikipedia: true });
    vi.doUnmock('../core/core');
  });
});
