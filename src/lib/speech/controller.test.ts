import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor, Locator, TextChunk } from '../engines/types';
import { SpeechController, type SpeechEngine } from './controller.svelte';
import { pickVoice, rankVoices, type VoiceInfo } from './voices';

class FakeUtterance {
  rate = 1;
  voice: unknown = null;
  lang = '';
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onboundary: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}

/** A scripted speechSynthesis: the first queued utterance starts on its own, the test ends it. */
class FakeSynth {
  queue: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  spoken: string[] = [];
  paused = false;
  calls: string[] = [];
  get speaking() {
    return !!this.current;
  }
  get pending() {
    return this.queue.length > 0;
  }
  addEventListener() {}
  removeEventListener() {}
  getVoices() {
    return [];
  }
  speak(u: FakeUtterance) {
    this.spoken.push(u.text);
    this.queue.push(u);
    if (!this.current) this.#advance();
  }
  #advance() {
    this.current = this.queue.shift() ?? null;
    const u = this.current;
    if (u) queueMicrotask(() => this.current === u && u.onstart?.());
  }
  cancel() {
    this.calls.push('cancel');
    const old = this.current;
    this.current = null;
    this.queue = [];
    if (old) queueMicrotask(() => old.onerror?.({ error: 'canceled' })); // real engines fire this late
  }
  pause() {
    this.calls.push('pause');
    this.paused = true;
  }
  resume() {
    this.calls.push('resume');
    this.paused = false;
  }
  /** The current utterance finished. */
  end() {
    const u = this.current!;
    this.current = null;
    u.onend?.();
    this.#advance();
  }
  boundary(charIndex: number, charLength?: number) {
    this.current!.onboundary?.({ name: 'word', charIndex, charLength });
  }
}

const anchor = (text: string, s: number, e: number, locator: Locator): Anchor => ({ locator, quote: { exact: text.slice(s, e), prefix: '', suffix: '' } });

function engineFor(sentences: string[], opts: { reflow?: boolean; pages?: number[] } = {}) {
  const calls = { show: [] as [string | undefined, string | undefined][], decorations: [] as unknown[], goTo: [] as Locator[], cleared: 0 };
  const locOf = (i: number): Locator => (opts.pages ? { kind: 'fixed', page: opts.pages[i] } : { kind: 'reflow', cfi: `c${i}`, fraction: i / sentences.length });
  const engine = {
    getLocation: () => null,
    setDecorations: (_l: string, items: unknown[]) => void calls.decorations.push(items),
    goTo: async (l: Locator) => void calls.goTo.push(l),
    textStream: async function* (): AsyncGenerator<TextChunk> {
      for (const [i, text] of sentences.entries()) {
        yield { text, locator: locOf(i), end: locOf(i), anchorFor: async (s, e) => anchor(text, s, e, locOf(i)) };
      }
    },
    ...(opts.reflow
      ? {
          showSpeech: async (w: Anchor | null, s?: Anchor | null) => void calls.show.push([w?.quote.exact, s?.quote.exact]),
          clearSpeech: () => void calls.cleared++,
        }
      : {}),
  } as unknown as SpeechEngine;
  return { engine, calls };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const S = ['First sentence here.', 'Second one follows.', 'Third and last.'];

let synth: FakeSynth;
let ctl: SpeechController;
beforeEach(() => {
  vi.useFakeTimers();
  synth = new FakeSynth();
  ctl = new SpeechController({ synth: synth as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance });
});
afterEach(() => {
  ctl.dispose();
  vi.useRealTimers();
});

describe('sequencing', () => {
  it('speaks sentence by sentence, queueing the next one ahead, and goes idle at the end', async () => {
    const { engine } = engineFor(S);
    ctl.start(engine);
    await flush();
    expect(ctl.state).toBe('speaking');
    expect(ctl.currentSentence).toBe(S[0]);
    expect(synth.spoken).toEqual([S[0], S[1]]); // one queued ahead
    synth.end();
    await flush();
    expect(ctl.currentSentence).toBe(S[1]);
    expect(synth.spoken).toEqual(S);
    synth.end();
    await flush();
    expect(ctl.currentSentence).toBe(S[2]);
    synth.end();
    await flush();
    expect(ctl.state).toBe('idle');
    expect(ctl.currentSentence).toBeNull();
  });

  it('reports a calm error when there is nothing to read', async () => {
    ctl.start(engineFor([]).engine);
    await flush();
    expect(ctl.state).toBe('idle');
    expect(ctl.error).toMatch(/no text/i);
  });
});

describe('highlighting', () => {
  it('draws the sentence at its start and the spoken word on boundary events (reflow showSpeech)', async () => {
    const { engine, calls } = engineFor(S, { reflow: true });
    ctl.start(engine);
    await flush();
    expect(calls.show.at(-1)).toEqual([undefined, S[0]]);
    synth.boundary(6, 8); // "sentence"
    await flush();
    expect(calls.show.at(-1)).toEqual(['sentence', S[0]]);
    synth.boundary(15); // no charLength: scans the word, "here"
    await flush();
    expect(calls.show.at(-1)?.[0]).toBe('here');
  });

  it('other engines: transient speech decorations, and goTo when the spoken page changes', async () => {
    const { engine, calls } = engineFor(S, { pages: [0, 0, 1] });
    ctl.start(engine);
    await flush();
    synth.boundary(0, 5);
    await flush();
    expect((calls.decorations.at(-1) as { style: { type: string } }[]).map((d) => d.style.type)).toEqual(['speech-sentence', 'speech-word']);
    expect(calls.goTo.map((l) => (l.kind === 'fixed' ? l.page : -1))).toEqual([0]);
    synth.end();
    await flush();
    synth.end();
    await flush();
    expect(calls.goTo.at(-1)).toEqual({ kind: 'fixed', page: 1 });
    ctl.stop();
    expect((calls.decorations.at(-1) as unknown[]).length).toBe(0);
  });
});

describe('transport', () => {
  it('pauses and resumes', async () => {
    ctl.start(engineFor(S).engine);
    await flush();
    ctl.pause();
    expect(ctl.state).toBe('paused');
    expect(synth.calls).toContain('pause');
    ctl.resume();
    expect(ctl.state).toBe('speaking');
    expect(synth.calls.at(-1)).toBe('resume');
  });

  it('skips to the next and previous sentence and ignores the cancelled utterance late events', async () => {
    ctl.start(engineFor(S).engine);
    await flush();
    const first = synth.current!;
    ctl.nextSentence();
    await flush();
    expect(ctl.currentSentence).toBe(S[1]);
    first.onend?.(); // a late `end` from the cancelled utterance must not advance anything
    await flush();
    expect(ctl.currentSentence).toBe(S[1]);
    expect(ctl.state).toBe('speaking');
    ctl.prevSentence();
    await flush();
    expect(ctl.currentSentence).toBe(S[0]);
  });

  it('skipping past the last sentence finishes', async () => {
    ctl.start(engineFor(['Only one.']).engine);
    await flush();
    ctl.nextSentence();
    await flush();
    expect(ctl.state).toBe('idle');
  });

  it('stop cancels speech and clears the highlight', async () => {
    const { engine, calls } = engineFor(S, { reflow: true });
    ctl.start(engine);
    await flush();
    ctl.stop();
    expect(ctl.state).toBe('idle');
    expect(synth.calls).toContain('cancel');
    expect(calls.cleared).toBe(1);
  });
});

describe('watchdog', () => {
  it('moves on when an utterance never ends', async () => {
    ctl.start(engineFor(S).engine);
    await flush();
    expect(ctl.currentSentence).toBe(S[0]);
    await vi.advanceTimersByTimeAsync(9000); // no `end` ever fires
    expect(ctl.currentSentence).toBe(S[1]);
  });

  it('retries a sentence that never starts, then gives up with a message', async () => {
    synth.speak = function (u: FakeUtterance) {
      this.spoken.push(u.text); // dropped: never starts
    };
    ctl.start(engineFor(S).engine);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ctl.state).toBe('idle');
    expect(ctl.error).toMatch(/didn.t start/i);
  });

  it('stops after repeated synthesis errors', async () => {
    ctl.start(engineFor(['a b c d.', 'e f g h.', 'i j k l.', 'm n o p.']).engine);
    await flush();
    for (let i = 0; i < 3; i++) {
      synth.current?.onerror?.({ error: 'synthesis-failed' });
      await flush();
    }
    expect(ctl.state).toBe('idle');
    expect(ctl.error).toMatch(/another voice/i);
  });
});

describe('settings', () => {
  it('clamps the rate, applies it to new utterances and saves it', async () => {
    const save = vi.fn(async () => {});
    ctl = new SpeechController({ synth: synth as unknown as SpeechSynthesis, Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance, storage: { load: async () => ({ rate: 1.5, voice: 'v1' }), save } });
    await ctl.init();
    expect([ctl.rate, ctl.voice]).toEqual([1.5, 'v1']);
    ctl.setRate(9);
    expect(ctl.rate).toBe(3);
    ctl.setRate(1.24);
    ctl.start(engineFor(S).engine);
    await flush();
    expect(synth.current && (synth.current as FakeUtterance).rate).toBe(1.25);
    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenLastCalledWith({ voice: 'v1', rate: 1.25, highlight: true });
  });
});

describe('voice choice', () => {
  const v = (uri: string, lang: string, local: boolean, natural = false, isDefault = false): VoiceInfo => ({ uri, name: uri, lang, local, natural, isDefault });
  const list = [v('online-en', 'en-US', false, true), v('local-fr', 'fr-FR', true), v('local-en', 'en-GB', true), v('local-en-us', 'en-US', true, false, true)];
  it('prefers the book language, then offline voices', () => {
    expect(rankVoices(list, 'en-US').map((x) => x.uri)).toEqual(['local-en-us', 'online-en', 'local-en', 'local-fr']);
    expect(pickVoice(list, null, 'fr')?.uri).toBe('local-fr');
  });
  it('keeps a saved voice only when it speaks the book language', () => {
    expect(pickVoice(list, 'local-en', 'en-US')?.uri).toBe('local-en');
    expect(pickVoice(list, 'local-en', 'fr-FR')?.uri).toBe('local-fr');
    expect(pickVoice(list, 'gone', null)?.uri).toBe('local-en-us');
  });
});
