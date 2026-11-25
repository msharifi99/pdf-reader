<script lang="ts">
  // Settings → Reading → Read aloud: default voice, default speed, word highlight. Stored by the speech
  // controller (core setting "speech"); changes apply from the next sentence when reading.
  import { Popover, Slider, Switch, Icon } from '../../ui';
  import SettingGroup from '../../settings/SettingGroup.svelte';
  import SettingRow from '../../settings/SettingRow.svelte';
  import { pickVoice } from '../voices';
  import { speech, RATE_MAX, RATE_MIN } from '..';
  import VoicePicker, { voiceParts, languageName } from './VoicePicker.svelte';

  let open = $state(false);
  // svelte-ignore state_referenced_locally (local slider value; written back on input)
  let rate = $state(speech.rate);
  $effect(() => {
    rate = speech.rate;
  });
  const chosen = $derived(speech.voices.find((v) => v.uri === speech.voice) ?? null);
  const auto = $derived(pickVoice(speech.voices, null, navigator.language));
  const label = $derived(chosen ? voiceParts(chosen).name : 'Automatic');
  const sub = $derived(chosen ? languageName(chosen.lang) : auto ? `Matches each book · ${voiceParts(auto).name}` : 'Matches each book');
</script>

<SettingGroup title="Read aloud">
  {#if !speech.available}
    <SettingRow label="Read aloud" description="This system has no speech engine, so Quire can’t read aloud here." keywords="speech voice tts">
      <span class="muted">Unavailable</span>
    </SettingRow>
  {:else}
    <SettingRow label="Voice" description="Automatic picks an installed voice in each book’s language. Add voices in Windows Settings → Time & language → Speech." keywords="speech voice tts read aloud narrator">
      <Popover label="Voice" bind:open placement="bottom-end">
        {#snippet trigger(attrs)}
          <button {...attrs} class="voice-btn" data-testid="settings-voice">
            <Icon name="speaker" size={16} />
            <span class="txt"><span class="name">{label}</span><span class="sub">{sub}</span></span>
            <Icon name="chevron-down" size={16} />
          </button>
        {/snippet}
        <VoicePicker onpick={() => (open = false)} />
      </Popover>
    </SettingRow>
    <SettingRow label="Speed" description="Change it while listening from the player, too." keywords="speech rate speed tts read aloud">
      <div class="slider">
        <Slider label="Read-aloud speed" hideLabel min={RATE_MIN} max={RATE_MAX} step={0.05} bind:value={rate} format={(v) => `${Number(v.toFixed(2))}×`} oninput={(v) => speech.setRate(v)} />
      </div>
    </SettingRow>
    <SettingRow label="Highlight each word" description="Underline the word being spoken. When off, only the sentence is softly tinted." keywords="speech highlight follow word tts read aloud">
      <Switch label="Highlight each word" hideLabel checked={speech.highlight} onchange={(v) => speech.setHighlight(v)} />
    </SettingRow>
  {/if}
</SettingGroup>

<style>
  .slider { width: 240px; }
  .muted { font-size: var(--text-sm); color: var(--muted); }
  .voice-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    width: 240px;
    height: 40px;
    padding: 0 var(--space-2-5);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border-soft);
    color: var(--muted);
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .voice-btn:hover { background: color-mix(in oklab, var(--surface-2), var(--text) 5%); }
  .voice-btn:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  .txt { flex: auto; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
  .name { font-size: var(--text-sm); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: var(--text-xs); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
