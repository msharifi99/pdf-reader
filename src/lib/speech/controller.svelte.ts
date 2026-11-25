import type { Anchor, Engine, Locator, TextChunk } from '../engines/types';
import { pickVoice, rankVoices, toVoiceInfo, type VoiceInfo } from './voices';

export type SpeechState = 'idle' | 'speaking' | 'paused';

/** What the controller needs from an engine; reflow adds `showSpeech`/`clearSpeech`. */
export type SpeechEngine = Pick<Engine, 'textStream' | 'setDecorations' | 'goTo' | 'getLocation'> & Partial<Pick<Engine, 'getSelection'>> & {
  showSpeech?(word: Anchor | null, sentence?: Anchor | null): Promise<void>;
  clearSpeech?(): void;
};

export interface SpeechStorage {
  load(): Promise<{ voice?: string | null; rate?: number } | null>;
  save(v: { voice: string | null; rate: number }): Promise<void>;
}

export interface SpeechDeps {
  synth?: SpeechSynthesis | null;
  Utterance?: typeof SpeechSynthesisUtterance;
  storage?: SpeechStorage | null;
}

export const RATE_MIN = 0.5;
export const RATE_MAX = 3;
const MAX_CHUNK_CHARS = 240; // WebView2 can drop long utterances, so stay sentence-sized
const AHEAD = 5; // text chunks pulled ahead of the one playing
const KEEP_BEHIND = 25; // sentences kept for "previous"
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const wordLenAt = (text: string, i: number) => text.slice(i).match(/^[\p{L}\p{N}'’-]+|^\S/u)?.[0].length ?? 1;

/**
 * Read-aloud. Sentence-sized utterances from `engine.textStream`, queued one ahead so there is no
 * gap, word boundaries drive the highlight. All races (late events from cancelled utterances, a
 * missing `end`, GC of utterances) are handled here; see the notes in `index.ts`.
 */
export class SpeechController {
  state = $state<SpeechState>('idle');
  /** Chosen voice (`voiceURI`); null = best match for the book's language. */
  voice = $state<string | null>(null);
  rate = $state(1);
  voices = $state.raw<VoiceInfo[]>([]);
  currentSentence = $state<string | null>(null);
  /** A calm, user-ready message when speech couldn't run; cleared on the next start. */
  error = $state<string | null>(null);
  readonly available: boolean;

  #synth: SpeechSynthesis | null;
  #Utterance: typeof SpeechSynthesisUtterance | null;
  #storage: SpeechStorage | null;
  #engine: SpeechEngine | null = null;
  #lang: string | null = null;
  #chunks: (TextChunk | undefined)[] = [];
  #done = true;
  #iter: AsyncIterator<TextChunk> | null = null;
  #abort: AbortController | null = null;
  #run = 0; // bumps on start/stop
  #epoch = 0; // bumps on every cancel: events from older utterances are ignored
  #playing = -1; // index of the utterance that has started
  #queuedTo = -1; // highest index handed to speechSynthesis
  #ended = -1; // highest index that finished
  #pumping = false;
  #live = new Set<SpeechSynthesisUtterance>(); // Chromium may GC an utterance (and its events) mid-speech
  #timer: ReturnType<typeof setTimeout> | undefined;
  #saveTimer: ReturnType<typeof setTimeout> | undefined;
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #hl = 0; // highlight sequence: drop stale async anchors
  #sentenceAnchor: Promise<Anchor | null> | null = null;
  #nav = { page: -1, y: 0 };
  #failures = 0;
  #retries = 0;
  #listeners: (() => void)[] = [];

  constructor(deps: SpeechDeps = {}) {
    this.#synth = deps.synth !== undefined ? deps.synth : typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    this.#Utterance = deps.Utterance ?? (typeof SpeechSynthesisUtterance !== 'undefined' ? SpeechSynthesisUtterance : null);
    this.#storage = deps.storage ?? null;
    this.available = !!this.#synth && !!this.#Utterance;
    if (this.#synth) {
      const refresh = () => this.#loadVoices();
      this.#synth.addEventListener?.('voiceschanged', refresh);
      this.#listeners.push(() => this.#synth?.removeEventListener?.('voiceschanged', refresh));
      this.#loadVoices();
      if (typeof document !== 'undefined') {
        const vis = () => document.visibilityState === 'visible' && this.#recover();
        document.addEventListener('visibilitychange', vis);
        this.#listeners.push(() => document.removeEventListener('visibilitychange', vis));
      }
    }
  }

  /** Load the saved voice and rate. Call once at boot (after the core is up). */
  async init(): Promise<void> {
    try {
      const s = await this.#storage?.load();
      if (s && typeof s === 'object') {
        if (typeof s.rate === 'number') this.rate = clamp(s.rate, RATE_MIN, RATE_MAX);
        if (typeof s.voice === 'string' || s.voice === null) this.voice = s.voice ?? null;
      }
    } catch {
      /* defaults */
    }
  }

  // ---- voices ------------------------------------------------------------------------------

  /** Voices ranked for `lang` (book language): matching + offline first. */
  voicesFor(lang?: string | null): VoiceInfo[] {
    return rankVoices(this.voices, lang);
  }

  #loadVoices(): void {
    const list = this.#synth?.getVoices?.() ?? [];
    if (list.length || !this.voices.length) this.voices = list.map(toVoiceInfo);
  }

  // ---- settings ----------------------------------------------------------------------------

  setRate(rate: number): void {
    this.rate = Math.round(clamp(rate, RATE_MIN, RATE_MAX) * 20) / 20;
    this.#persist();
    this.#restartSoon();
  }

  setVoice(uri: string | null): void {
    this.voice = uri;
    this.#persist();
    this.#restartSoon();
  }

  #persist(): void {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => void this.#storage?.save({ voice: this.voice, rate: this.rate }).catch(() => {}), 400);
  }

  /** Utterance rate/voice are fixed at creation: re-speak the current sentence once the user stops dragging. */
  #restartSoon(): void {
    if (this.state === 'idle') return;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = setTimeout(() => this.#jump(Math.max(this.#playing, 0)), 250);
  }

  // ---- transport ---------------------------------------------------------------------------

  /** Start reading at `from` (default: the engine's current position). */
  start(engine: SpeechEngine, opts: { from?: Locator; lang?: string | null } = {}): void {
    this.stop();
    if (!this.available) {
      this.error = "This system can't read aloud.";
      return;
    }
    this.#engine = engine;
    this.#lang = opts.lang ?? null;
    this.#chunks = [];
    this.#done = false;
    this.#playing = this.#queuedTo = this.#ended = -1;
    this.#failures = this.#retries = 0;
    this.error = null;
    const loc = engine.getLocation()?.locator;
    this.#nav = loc?.kind === 'fixed' ? { page: loc.page, y: loc.y ?? 0 } : { page: -1, y: 0 };
    const run = ++this.#run;
    const ctl = (this.#abort = new AbortController());
    this.#iter = engine.textStream(opts.from, { signal: ctl.signal, maxChunkChars: MAX_CHUNK_CHARS })[Symbol.asyncIterator]();
    this.state = 'speaking';
    void this.#pump(run);
  }

  pause(): void {
    if (this.state !== 'speaking') return;
    this.state = 'paused';
    clearTimeout(this.#timer);
    this.#synth?.pause();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'speaking';
    this.#synth?.resume();
    // A pause that outlived the utterance (or a dropped one) would stay silent forever.
    if (!this.#synth?.speaking && !this.#synth?.pending) this.#jump(Math.max(this.#playing, 0));
    else this.#arm(this.#estimate(this.#chunks[this.#playing]?.text ?? '') + 2000);
  }

  stop(): void {
    const had = this.state !== 'idle';
    this.#run++;
    this.#epoch++;
    clearTimeout(this.#timer);
    clearTimeout(this.#restartTimer);
    this.#abort?.abort();
    void this.#iter?.return?.();
    this.#iter = null;
    this.#abort = null;
    this.#live.clear();
    this.#hl++;
    this.#sentenceAnchor = null;
    this.#chunks = [];
    this.#done = true;
    if (had) {
      this.#synth?.cancel();
      if (this.#engine?.clearSpeech) this.#engine.clearSpeech();
      else this.#engine?.setDecorations('speech', []);
    }
    this.state = 'idle';
    this.currentSentence = null;
    this.#engine = null;
  }

  nextSentence(): void {
    if (this.state !== 'idle') this.#jump(this.#playing + 1);
  }

  prevSentence(): void {
    if (this.state !== 'idle') this.#jump(Math.max(0, this.#playing - 1));
  }

  /** Speak chunk `i` now, dropping everything queued. */
  #jump(i: number): void {
    if (this.state === 'idle') return;
    const first = this.#chunks.findIndex((c) => c);
    i = Math.max(i, first < 0 ? 0 : first);
    this.#epoch++;
    clearTimeout(this.#timer);
    this.#live.clear();
    this.#hl++;
    this.#synth?.cancel();
    if (this.state === 'paused') this.state = 'speaking';
    this.#synth?.resume(); // a cancel while paused leaves the engine paused in Chromium
    this.#playing = this.#ended = this.#queuedTo = i - 1;
    this.#sentenceAnchor = null;
    this.#fill();
    void this.#pump(this.#run);
    this.#maybeFinish();
  }

  // ---- the queue ---------------------------------------------------------------------------

  async #pump(run: number): Promise<void> {
    if (this.#pumping || this.#done || !this.#iter) return;
    this.#pumping = true;
    try {
      while (!this.#done && run === this.#run && this.#chunks.length - Math.max(this.#playing, 0) < AHEAD) {
        const r = await this.#iter!.next();
        if (run !== this.#run) return;
        if (r.done) this.#done = true;
        else {
          this.#chunks.push(r.value);
          this.#fill();
        }
      }
    } catch (e) {
      if (run === this.#run) {
        this.#done = true;
        if (!(e instanceof Error && /abort/i.test(e.name + e.message))) this.error = "Couldn't read the text here.";
      }
    } finally {
      this.#pumping = false;
    }
    if (run === this.#run) this.#maybeFinish();
  }

  /** Keep the next utterance queued behind the current one (no gap between sentences). */
  #fill(): void {
    while (this.state !== 'idle' && this.#queuedTo + 1 < this.#chunks.length && this.#queuedTo - this.#playing < 1) this.#enqueue(this.#queuedTo + 1);
  }

  #enqueue(i: number): void {
    const chunk = this.#chunks[i];
    const synth = this.#synth;
    const U = this.#Utterance;
    if (!chunk || !synth || !U) return;
    this.#queuedTo = i;
    const epoch = this.#epoch;
    const u = new U(chunk.text);
    u.rate = this.rate;
    const voice = this.#resolveVoice();
    if (voice) {
      u.voice = (synth.getVoices?.() ?? []).find((v) => (v.voiceURI || v.name) === voice.uri) ?? null;
      u.lang = voice.lang;
    } else if (this.#lang) u.lang = this.#lang;
    const live = (fn: () => void) => () => epoch === this.#epoch && fn();
    u.onstart = live(() => this.#onStart(i));
    u.onboundary = (e) => epoch === this.#epoch && this.#onBoundary(i, e);
    u.onend = live(() => this.#onEnd(i, u));
    u.onerror = (e) => epoch === this.#epoch && this.#onError(i, u, e.error);
    this.#live.add(u);
    if (i === this.#playing + 1 && this.#playing === this.#ended) this.#arm(this.#estimate(chunk.text) + 5000);
    synth.speak(u);
  }

  #resolveVoice(): VoiceInfo | null {
    if (!this.voices.length) this.#loadVoices();
    return pickVoice(this.voices, this.voice, this.#lang);
  }

  // ---- utterance events --------------------------------------------------------------------

  #onStart(i: number): void {
    this.#playing = i;
    this.#failures = this.#retries = 0;
    const chunk = this.#chunks[i];
    if (!chunk) return;
    this.currentSentence = chunk.text;
    this.#arm(this.#estimate(chunk.text) * 2 + 4000);
    this.#sentenceAnchor = chunk.anchorFor(0, chunk.text.length).catch(() => null);
    void this.#draw(i, null);
    if (i >= KEEP_BEHIND) this.#chunks[i - KEEP_BEHIND] = undefined;
    this.#fill();
    void this.#pump(this.#run);
  }

  #onBoundary(i: number, e: SpeechSynthesisEvent): void {
    if (this.state === 'paused' || (e.name && e.name !== 'word')) return;
    const chunk = this.#chunks[i];
    if (!chunk || i !== this.#playing) return;
    this.#arm(5000);
    const start = clamp(e.charIndex, 0, chunk.text.length);
    const len = (e as { charLength?: number }).charLength || wordLenAt(chunk.text, start);
    if (typeof document !== 'undefined' && document.hidden) return; // nobody is looking: skip the drawing work
    void this.#draw(i, [start, Math.min(chunk.text.length, start + len)]);
  }

  #onEnd(i: number, u: SpeechSynthesisUtterance): void {
    this.#live.delete(u);
    this.#ended = Math.max(this.#ended, i);
    if (this.#playing < i) this.#playing = i;
    clearTimeout(this.#timer);
    if (!this.#maybeFinish()) {
      this.#fill();
      void this.#pump(this.#run);
      const next = this.#chunks[this.#ended + 1];
      if (next && this.#queuedTo > this.#ended) this.#arm(this.#estimate(next.text) + 4000); // the queued one must start
    }
  }

  #onError(i: number, u: SpeechSynthesisUtterance, error: string): void {
    this.#live.delete(u);
    if (error === 'not-allowed') return this.#fail('Speech was blocked. Press the read-aloud button again.');
    // Same epoch, so we didn't cancel it: something else stopped speech.
    if (error === 'canceled' || error === 'interrupted') return this.stop();
    if (++this.#failures >= 3) return this.#fail("The voice couldn't speak this text. Try another voice.");
    this.#onEnd(i, u);
  }

  /** The utterance never ended (or never started): move on rather than hang. */
  #onWatchdog = (): void => {
    if (this.state !== 'speaking') return;
    if (this.#playing < 0 || this.#playing === this.#ended) {
      // never started: one retry of the same sentence, then give up
      if (++this.#retries > 1) return this.#fail("Speech didn't start. Check the Windows voice settings.");
      return this.#jump(Math.max(this.#ended + 1, 0));
    }
    this.#jump(this.#playing + 1);
  };

  #fail(message: string): void {
    this.stop();
    this.error = message;
  }

  /** Finish when the stream is exhausted and everything spoke. Returns true when it did. */
  #maybeFinish(): boolean {
    if (this.state === 'idle' || !this.#done) return false;
    if (this.#chunks.length === 0) {
      this.stop();
      this.error = "There's no text to read aloud here.";
      return true;
    }
    if (this.#ended >= this.#chunks.length - 1) {
      this.stop();
      return true;
    }
    return false;
  }

  #arm(ms: number): void {
    clearTimeout(this.#timer);
    if (this.state === 'speaking') this.#timer = setTimeout(this.#onWatchdog, ms);
  }

  /** Rough speaking time for a sentence at the current rate. */
  #estimate(text: string): number {
    return (text.length / (13 * this.rate)) * 1000;
  }

  /** The window came back: if speech died while hidden, pick up at the current sentence. */
  #recover(): void {
    if (this.state === 'speaking' && !this.#synth?.speaking && !this.#synth?.pending && this.#chunks.length) this.#jump(Math.max(this.#playing, 0));
  }

  // ---- highlight and page following -----------------------------------------------------------

  /** Draw the sentence (and `range` inside it as the word), and keep it on screen. */
  async #draw(i: number, range: [number, number] | null): Promise<void> {
    const engine = this.#engine;
    const chunk = this.#chunks[i];
    const sentencePromise = this.#sentenceAnchor;
    if (!engine || !chunk) return;
    const seq = ++this.#hl;
    try {
      const [word, sentence] = await Promise.all([range ? chunk.anchorFor(range[0], range[1]).catch(() => null) : null, sentencePromise]);
      if (seq !== this.#hl || engine !== this.#engine) return;
      if (engine.showSpeech) await engine.showSpeech(word, sentence);
      else {
        engine.setDecorations('speech', [
          ...(sentence ? [{ id: 'sentence', anchor: sentence, style: { type: 'speech-sentence' as const } }] : []),
          ...(word ? [{ id: 'word', anchor: word, style: { type: 'speech-word' as const } }] : []),
        ]);
        await this.#follow(word?.locator ?? sentence?.locator ?? chunk.locator);
      }
    } catch {
      /* a page that left the DOM must never stop the reading */
    }
  }

  /** Fixed layouts: go to the spoken page when it changes (or the spoken line moves well down a tall page). */
  async #follow(l: Locator): Promise<void> {
    if (l.kind !== 'fixed' || !this.#engine) return;
    const y = l.y ?? 0;
    if (l.page === this.#nav.page && Math.abs(y - this.#nav.y) < 0.35) return;
    this.#nav = { page: l.page, y };
    await this.#engine.goTo(l);
  }

  dispose(): void {
    this.stop();
    clearTimeout(this.#saveTimer);
    this.#listeners.forEach((f) => f());
    this.#listeners = [];
  }
}
