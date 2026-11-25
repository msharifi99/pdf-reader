/**
 * Read-aloud (stories 82, 83): Web Speech API in WebView2 (the installed Windows voices).
 *
 *   import { speech, registerSpeechCommands } from '../speech';
 *
 * Reactive state (Svelte runes; bind the controls to it):
 *   speech.state            'idle' | 'speaking' | 'paused'
 *   speech.currentSentence  text being spoken, or null
 *   speech.rate             0.5..3 (step 0.05), remembered
 *   speech.voice            chosen voiceURI, or null = best match for the book's language, remembered
 *   speech.voices           VoiceInfo[] { uri, name, lang, local, isDefault, natural } (fills in async)
 *   speech.voicesFor(lang)  voices ranked for a book language: matching + offline first
 *   speech.error            calm message when speech could not run ("There's no text to read aloud here.")
 *   speech.available        false when the webview has no speechSynthesis
 *
 * Actions:
 *   speech.start(engine, { from?: Locator, lang?: string })   // from = selection/position; default current position
 *   speech.pause() / speech.resume() / speech.stop()
 *   speech.nextSentence() / speech.prevSentence()
 *   speech.setRate(1.25) / speech.setVoice(uri | null)         // applied from the current sentence
 *   await speech.init()     // once at boot: loads the saved voice + rate (stored via core setting "speech")
 *
 * Commands: `registerSpeechCommands(getEngine, getContext?)` from the reader view; returns an unregister
 * function that also stops speech. Registers `reader.readAloud` (toggle: start / pause / resume, Ctrl+Shift+S;
 * starts at the selection when there is one) plus `speech.next`, `speech.prev`, `speech.stop`,
 * `speech.faster`, `speech.slower` (no default keys). Call `speech.stop()` when the book closes.
 *
 * Highlighting: reflow engines get `showSpeech(word, sentence)` (which also turns the page); other engines get
 * `setDecorations('speech', ...)` and `goTo` when the spoken page changes.
 *
 * Quirks handled: events from cancelled utterances are ignored (epoch token); a watchdog advances when `end` never
 * arrives or an utterance never starts; utterances are kept referenced so Chromium can't GC them mid-speech;
 * sentence-sized (<= 240 char) utterances with the next one queued ahead (no gaps); `cancel()` while paused;
 * a window that was hidden is recovered on `visibilitychange`; word drawing is skipped while hidden;
 * `charLength` missing on `boundary` falls back to scanning the word.
 */
import { core } from '../core/core';
import { commands, defineCommand, type Command } from '../commands';
import type { Locator } from '../engines/types';
import { SpeechController, RATE_MAX, RATE_MIN, type SpeechEngine, type SpeechStorage } from './controller.svelte';

export { SpeechController, RATE_MIN, RATE_MAX, type SpeechEngine, type SpeechState, type SpeechStorage } from './controller.svelte';
export { pickVoice, rankVoices, voiceScore, type VoiceInfo } from './voices';

/** Persisted through the core's settings table under the key "speech". */
const coreStorage: SpeechStorage = {
  load: async () => (await core.getSetting('speech')) as { voice?: string | null; rate?: number; highlight?: boolean } | null,
  save: async (v) => void (await core.setSetting('speech', v)),
};

export const speech = new SpeechController({ storage: coreStorage });

export interface SpeechContext {
  /** Book language (BCP-47) to pick a matching voice. */
  lang?: string | null;
  /** Override where reading starts (default: the selection, else the current position). */
  from?: Locator;
}

export function registerSpeechCommands(getEngine: () => SpeechEngine | null, getContext: () => SpeechContext = () => ({})): () => void {
  const hasEngine = () => !!getEngine();
  const toggle = () => {
    if (speech.state === 'speaking') return speech.pause();
    if (speech.state === 'paused') return speech.resume();
    const engine = getEngine();
    if (!engine) return;
    const ctx = getContext();
    speech.start(engine, { from: ctx.from ?? engine.getSelection?.()?.anchor.locator, lang: ctx.lang });
  };
  const base = { category: 'Reading', contexts: ['reader'] as Command['contexts'] };
  const playing = () => speech.state !== 'idle';
  const off = commands.register([
    defineCommand('reader.readAloud', toggle, hasEngine),
    { ...base, id: 'speech.next', title: 'Read aloud: next sentence', enabled: playing, repeatable: true, keywords: ['skip'], run: () => speech.nextSentence() },
    { ...base, id: 'speech.prev', title: 'Read aloud: previous sentence', enabled: playing, repeatable: true, keywords: ['back'], run: () => speech.prevSentence() },
    { ...base, id: 'speech.stop', title: 'Stop reading aloud', enabled: playing, run: () => speech.stop() },
    { ...base, id: 'speech.faster', title: 'Read aloud: faster', repeatable: true, run: () => speech.setRate(speech.rate + 0.1) },
    { ...base, id: 'speech.slower', title: 'Read aloud: slower', repeatable: true, run: () => speech.setRate(speech.rate - 0.1) },
  ]);
  return () => {
    off();
    speech.stop();
  };
}
