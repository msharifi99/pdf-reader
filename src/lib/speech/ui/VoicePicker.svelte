<script lang="ts" module>
  import type { VoiceInfo } from '../voices';

  const names = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      return null;
    }
  })();

  /** "en-US" -> "English (United States)" style label, falling back to the tag. */
  export function languageName(tag: string): string {
    try {
      return names?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  }

  /** "Microsoft Aria Online (Natural) - English (United States)" -> { name: "Aria", detail: "Natural · Online" } */
  export function voiceParts(v: VoiceInfo): { name: string; detail: string } {
    const name = v.name
      .replace(/\s+-\s+.*$/, '')
      .replace(/^(Microsoft|Google)\s+/i, '')
      .replace(/\s*\b(Online|Desktop)\b/gi, '')
      .replace(/\s*\((Natural|Neural)\)/gi, '')
      .trim();
    const detail = [v.natural ? 'Natural' : '', v.local ? '' : 'Online'].filter(Boolean).join(' · ');
    return { name: name || v.name, detail };
  }

  const primary = (l: string | null | undefined) => (l ?? '').toLowerCase().split(/[-_]/)[0] ?? '';

  /** Voices grouped by language tag: the book's language first (exact tag, then same language), then A-Z. */
  export function groupVoices(ranked: VoiceInfo[], lang: string | null | undefined): { tag: string; label: string; voices: VoiceInfo[] }[] {
    const map = new Map<string, VoiceInfo[]>();
    for (const v of ranked) (map.get(v.lang) ?? map.set(v.lang, []).get(v.lang)!).push(v);
    const want = (lang ?? '').toLowerCase();
    const rank = (tag: string) => (want && tag.toLowerCase() === want ? 0 : want && primary(tag) === primary(want) ? 1 : 2);
    return [...map]
      .map(([tag, voices]) => ({ tag, label: languageName(tag), voices }))
      .sort((a, b) => rank(a.tag) - rank(b.tag) || a.label.localeCompare(b.label));
  }
</script>

<script lang="ts">
  // Voice list for the read-aloud player and settings: grouped by language, the book's language first.
  // Arrow keys move between voices, Enter picks, "Preview" speaks a sample.
  import { Icon, IconButton, SearchField } from '../../ui';
  import { pickVoice } from '../voices';
  import { speech } from '..';

  interface Props {
    /** book language (BCP-47) or null */
    lang?: string | null;
    onpick?: (uri: string | null) => void;
  }
  let { lang = null, onpick }: Props = $props();

  let query = $state('');
  let list: HTMLElement | undefined = $state();

  const ranked = $derived(speech.voicesFor(lang));
  const auto = $derived(pickVoice(speech.voices, null, lang));
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter((v) => `${v.name} ${v.lang} ${languageName(v.lang)}`.toLowerCase().includes(q));
  });
  const groups = $derived(groupVoices(filtered, lang));

  function pick(uri: string | null) {
    speech.setVoice(uri);
    onpick?.(uri);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = [...(list?.querySelectorAll<HTMLElement>('button.pick') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1);
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions (arrow keys move between the voice buttons) -->
<div class="picker" {onkeydown} data-testid="voice-picker">
  {#if speech.voices.length > 10}
    <div class="search"><SearchField bind:value={query} label="Filter voices" placeholder="Filter voices" /></div>
  {/if}
  <div class="list" bind:this={list} role="group" aria-label="Voices">
    {#if !query}
      <div class="row">
        <button class="pick" aria-pressed={speech.voice === null} onclick={() => pick(null)} data-testid="voice-auto">
          <span class="text">
            <span class="name">Automatic</span>
            <span class="detail">{auto ? `Best match for this book · ${voiceParts(auto).name}` : 'Best match for this book'}</span>
          </span>
          {#if speech.voice === null}<span class="check"><Icon name="check" size={16} /></span>{/if}
        </button>
      </div>
    {/if}
    {#each groups as g (g.tag)}
      <div class="group" role="group" aria-label={g.label}>
        <div class="label">{g.label}</div>
        {#each g.voices as v (v.uri)}
          {@const p = voiceParts(v)}
          <div class="row">
            <button class="pick" aria-pressed={speech.voice === v.uri} onclick={() => pick(v.uri)} data-voice={v.uri}>
              <span class="text">
                <span class="name">{p.name}</span>
                {#if p.detail}<span class="detail">{p.detail}</span>{/if}
              </span>
              {#if speech.voice === v.uri}<span class="check"><Icon name="check" size={16} /></span>{/if}
            </button>
            <span class="preview">
              <IconButton icon="speaker" label="Preview {p.name}" size="sm" tabindex={-1} tooltipPlacement="left" onclick={() => speech.preview(v.uri)} />
            </span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">
        {#if query}No voices match “{query}”.{:else}No voices are installed. Add one in Windows Settings → Time &amp; language → Speech.{/if}
      </p>
    {/each}
  </div>
  {#if speech.voices.length}
    <div class="foot">
      <button class="sample" onclick={() => speech.preview(speech.voice)} data-testid="voice-preview">
        <Icon name="speaker" size={16} />Preview voice
      </button>
      <span class="hint">{speech.state === 'idle' ? 'Speaks a short sample' : 'Pauses reading for a sample'}</span>
    </div>
  {/if}
</div>

<style>
  .picker { width: 300px; display: flex; flex-direction: column; }
  .search { padding: var(--space-2) var(--space-2) 0; }
  .list { max-height: min(360px, 50vh); overflow: auto; padding: var(--space-1); overscroll-behavior: contain; }
  .label {
    position: sticky;
    top: calc(-1 * var(--space-1));
    z-index: 1;
    padding: var(--space-3) var(--space-2) var(--space-1);
    background: var(--flyout-bg);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .row { position: relative; }
  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 36px;
    padding: var(--space-1-5) 36px var(--space-1-5) var(--space-2-5);
    border-radius: var(--radius-sm);
    text-align: left;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .pick:hover { background: var(--hover); }
  .pick:focus-visible { outline: var(--focus-ring); outline-offset: -2px; }
  .pick[aria-pressed='true'] { background: var(--selected); }
  .text { display: flex; flex-direction: column; min-width: 0; flex: auto; }
  .name { font-size: var(--text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .detail { font-size: var(--text-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .check { color: var(--accent); display: flex; }
  .pick[aria-pressed='true'] { padding-right: 60px; }
  .pick[aria-pressed='true'] .check { position: absolute; right: 34px; }
  .preview {
    position: absolute;
    right: var(--space-1);
    top: 50%;
    translate: 0 -50%;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .row:hover .preview, .preview:focus-within { opacity: 1; }
  .empty { padding: var(--space-4) var(--space-3); font-size: var(--text-sm); color: var(--muted); max-width: 32ch; }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-2);
    border-top: 1px solid var(--border-soft);
  }
  .sample {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: var(--control-sm);
    padding: 0 var(--space-2-5);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--text);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--border-soft);
  }
  .sample:hover { background: var(--hover); }
  .sample:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  .hint { font-size: var(--text-xs); color: var(--muted); }
</style>
