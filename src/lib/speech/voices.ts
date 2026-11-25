/** Voice listing and choice. Pure, so it is testable without a speech engine. */
export interface VoiceInfo {
  /** Stable id (`voiceURI`); what `speech.voice` holds. */
  uri: string;
  name: string;
  /** BCP-47, e.g. "en-US". */
  lang: string;
  /** Installed on this machine (works offline). Online "Natural" voices are not. */
  local: boolean;
  isDefault: boolean;
  /** Neural / "Natural" voice (nicer, but online-only voices need a connection). */
  natural: boolean;
}

export function toVoiceInfo(v: SpeechSynthesisVoice): VoiceInfo {
  return { uri: v.voiceURI || v.name, name: v.name, lang: v.lang, local: v.localService, isDefault: v.default, natural: /natural|neural/i.test(v.name) };
}

/** How well a voice fits: book language first, then works offline, then quality. */
export function voiceScore(v: VoiceInfo, lang?: string | null): number {
  const want = (lang ?? '').toLowerCase().replace('_', '-');
  const have = v.lang.toLowerCase().replace('_', '-');
  let s = 0;
  if (want) {
    if (have === want) s += 100;
    else if (have.split('-')[0] === want.split('-')[0]) s += 60;
  }
  if (v.local) s += 40;
  if (v.natural && v.local) s += 20; // online "natural" voices only count when they work offline
  if (v.isDefault) s += 5;
  return s;
}

/** Best voice first (stable for ties, keeping the system's order). */
export function rankVoices(voices: VoiceInfo[], lang?: string | null): VoiceInfo[] {
  return voices.map((v, i) => ({ v, i, s: voiceScore(v, lang) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.v);
}

/** The saved voice when it still exists and speaks the book's language, else the best match. */
export function pickVoice(voices: VoiceInfo[], savedUri: string | null, lang?: string | null): VoiceInfo | null {
  const saved = voices.find((v) => v.uri === savedUri);
  const primary = (l: string) => l.toLowerCase().split(/[-_]/)[0];
  if (saved && (!lang || primary(saved.lang) === primary(lang))) return saved;
  return rankVoices(voices, lang)[0] ?? null;
}
