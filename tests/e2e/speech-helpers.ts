import { expect, type Page } from '@playwright/test';

// Helpers for the read-aloud and lookup specs (T13).
// Fake speechSynthesis: Injected with page.addInitScript before the app boots.
// Drive it from the page: __fakeSpeech.word() fires the next word boundary, .end() ends the current utterance.
export function installFakeSpeech() {
  type U = SpeechSynthesisUtterance & { __w?: number };
  const voices = [
    ['Microsoft Aria Online (Natural) - English (United States)', 'en-US', false, false],
    ['Microsoft David - English (United States)', 'en-US', true, true],
    ['Microsoft Zira - English (United States)', 'en-US', true, false],
    ['Microsoft Hazel - English (United Kingdom)', 'en-GB', true, false],
    ['Microsoft Hortense - French (France)', 'fr-FR', true, false],
    ['Microsoft Katja - German (Germany)', 'de-DE', true, false],
  ].map(([name, lang, localService, def]) => ({ name, voiceURI: name, lang, localService, default: def }) as unknown as SpeechSynthesisVoice);
  let queue: U[] = [];
  let current: U | null = null;
  const fake = {
    spoken: [] as string[],
    paused: false,
    get speaking() {
      return !!current;
    },
    get pending() {
      return queue.length > 0;
    },
    getVoices: () => voices,
    addEventListener() {},
    removeEventListener() {},
    speak(u: U) {
      queue.push(u);
      if (!current) setTimeout(next, 5);
    },
    cancel() {
      const all = [current, ...queue].filter(Boolean) as U[];
      queue = [];
      current = null;
      all.forEach((u) => u.onerror?.({ error: 'canceled' } as SpeechSynthesisErrorEvent));
    },
    pause() {
      fake.paused = true;
    },
    resume() {
      fake.paused = false;
    },
    /** next word boundary of the current utterance */
    word() {
      const u = current;
      if (!u) return false;
      const words = [...u.text.matchAll(/[\p{L}\p{N}'’-]+/gu)];
      const m = words[u.__w ?? 0];
      if (!m) return false;
      u.__w = (u.__w ?? 0) + 1;
      u.onboundary?.({ name: 'word', charIndex: m.index, charLength: m[0].length } as unknown as SpeechSynthesisEvent);
      return m[0];
    },
    end() {
      const u = current;
      if (!u) return;
      current = null;
      u.onend?.({} as SpeechSynthesisEvent);
      next();
    },
    get text() {
      return current?.text ?? null;
    },
  };
  function next() {
    if (current || !queue.length) return;
    current = queue.shift()!;
    fake.spoken.push(current.text);
    current.onstart?.({} as SpeechSynthesisEvent);
  }
  class FakeUtterance {
    text: string;
    rate = 1;
    voice: SpeechSynthesisVoice | null = null;
    lang = '';
    onstart: ((e: unknown) => void) | null = null;
    onend: ((e: unknown) => void) | null = null;
    onboundary: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true });
  (window as unknown as { __fakeSpeech: typeof fake }).__fakeSpeech = fake;
}

/** Select `word` (whole word) in the visible EPUB section, turning pages until it is on screen. */
export async function selectWord(page: Page, word: string) {
  for (let i = 0; i < 12; i++) {
    const ok = await page.evaluate((w) => {
      const r = (globalThis as any).__QUIRE_READER__;
      for (const { doc } of r.session.engine.getContents()) {
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          const m = new RegExp(`\\b${w}\\b`).exec(n.data);
          if (!m) continue;
          const range = doc.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + w.length);
          const b = range.getBoundingClientRect();
          const f = doc.defaultView.frameElement.getBoundingClientRect();
          if (b.width === 0 || f.left + b.left < 0 || f.left + b.right > innerWidth) continue;
          const s = doc.getSelection();
          s.removeAllRanges();
          s.addRange(range);
          return true;
        }
      }
      return false;
    }, word);
    if (ok) {
      await expect.poll(() => page.evaluate(() => (globalThis as any).__QUIRE_READER__.session.selection?.text ?? '')).toContain(word);
      return;
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
  }
  throw new Error(`"${word}" not found`);
}

