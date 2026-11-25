/** Find in book (stories 46, 47): streaming search, all hits decorated, step with Enter/Shift+Enter. */
import type { Decoration, Locator, SearchHit } from '../engines/types';
import type { ReaderSession } from './session.svelte';
import { locatorFraction } from './progress';

const MAX_HITS = 2000;

export class FindState {
  open = $state(false);
  query = $state('');
  hits = $state.raw<SearchHit[]>([]);
  index = $state(-1);
  searching = $state(false);
  expanded = $state(false);
  /** bumps when the bar should (re)focus its input */
  focusRev = $state(0);
  #abort: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #session: ReaderSession;
  #ran = '';
  #steps = 0;

  constructor(session: ReaderSession) {
    this.#session = session;
  }

  show(query?: string): void {
    this.open = true;
    this.focusRev++;
    if (query !== undefined && query !== this.query) {
      this.query = query;
      this.run(query, 0);
    }
  }

  close(): void {
    this.open = false;
    this.cancel();
    this.hits = [];
    this.index = -1;
    this.#ran = '';
    this.#session.decorate('search', []);
  }

  cancel(): void {
    clearTimeout(this.#timer);
    this.#abort?.abort();
    this.#abort = null;
    this.searching = false;
  }

  /** Called on every keystroke: aborts the running search, starts a new one after a short pause. */
  run(query: string, delay = 160): Promise<void> {
    this.cancel();
    const q = query.trim();
    if (!q) {
      this.hits = [];
      this.index = -1;
      this.#ran = '';
      this.#session.decorate('search', []);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.#timer = setTimeout(() => void this.#search(q).finally(resolve), delay);
    });
  }

  async #search(q: string): Promise<void> {
    const engine = this.#session.engine;
    if (!engine || !this.#session.handle?.capabilities.search) return;
    const ac = (this.#abort = new AbortController());
    this.searching = true;
    this.#ran = q;
    this.#steps = 0;
    this.index = -1;
    const found: SearchHit[] = [];
    let lastPaint = 0;
    try {
      for await (const hit of engine.search(q, { signal: ac.signal })) {
        if (ac.signal.aborted) return;
        found.push(hit);
        if (found.length >= MAX_HITS) break;
        const now = performance.now();
        if (now - lastPaint > 120) {
          lastPaint = now;
          this.#publish(found, false);
        }
      }
      if (!ac.signal.aborted) this.#publish(found, true);
    } catch (e) {
      if ((e as { code?: string })?.code !== 'aborted' && !ac.signal.aborted) console.warn('[find]', e);
    } finally {
      if (this.#abort === ac) {
        this.#abort = null;
        this.searching = false;
      }
    }
  }

  #publish(found: SearchHit[], done: boolean): void {
    this.hits = found.slice();
    if (this.index < 0 && found.length) {
      // start at the first hit after the current position, without moving the page
      const here = this.#session.location?.locator;
      const n = this.#session.handle?.pageCount ?? 1;
      const at = here ? locatorFraction(here, n) : 0;
      const i = found.findIndex((h) => locatorFraction(h.locator, n) >= at - 1e-6);
      if (i >= 0 || done) this.index = i >= 0 ? i : 0;
    }
    this.decorate();
  }

  decorate(): void {
    const items: Decoration[] = this.hits.map((h, i) => ({ id: String(i), anchor: h.anchor, style: { type: 'search-hit', current: i === this.index } }));
    this.#session.decorate('search', items);
  }

  /** Step to the next/previous hit (wraps). Re-runs the search first when the query changed. */
  async step(dir: 1 | -1): Promise<void> {
    if (this.query.trim() !== this.#ran) await this.run(this.query, 0);
    const n = this.hits.length;
    if (!n) return;
    this.index = this.index < 0 ? (dir > 0 ? 0 : n - 1) : (this.index + dir + n) % n;
    await this.goToCurrent();
  }

  async select(i: number): Promise<void> {
    if (i < 0 || i >= this.hits.length) return;
    this.index = i;
    await this.goToCurrent();
  }

  async goToCurrent(): Promise<void> {
    const hit = this.hits[this.index];
    if (!hit) return;
    this.decorate();
    // only the first step of a search is a history entry; stepping through hits is not
    await this.#session.jump(hit.locator as Locator, this.#steps++ === 0);
  }
}
