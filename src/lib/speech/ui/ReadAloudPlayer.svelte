<script lang="ts">
  // Read-aloud player: a quiet pill docked bottom-centre over the page while reading. It is not chrome:
  // it stays when the chrome fades, but drops to a whisper until the pointer comes back.
  import { commands, keyState } from '../../commands';
  import { Icon, IconButton, Popover, Tooltip } from '../../ui';
  import { fadeScale } from '../../design/motion';
  import { chrome } from '../../shell/chrome.svelte';
  import { readerApi } from '../../reader/slots.svelte';
  import { pickVoice } from '../voices';
  import { speech } from '..';
  import VoicePicker, { voiceParts } from './VoicePicker.svelte';
  import SpeedControl from './SpeedControl.svelte';

  const run = (id: string) => () => void commands.execute(id);
  const active = $derived(speech.state !== 'idle');
  const speaking = $derived(speech.state === 'speaking');
  const lang = $derived(readerApi.session?.handle?.metadata.language ?? null);
  const voice = $derived(pickVoice(speech.voices, speech.voice, lang));
  const voiceName = $derived(voice ? voiceParts(voice).name : 'Voice');
  const rate = $derived(`${Number(speech.rate.toFixed(2))}×`);

  let speedOpen = $state(false);
  let voiceOpen = $state(false);
  const dim = $derived(chrome.hidden && !speedOpen && !voiceOpen);

  // A calm error fades by itself after a while (it is also dismissable).
  $effect(() => {
    if (!speech.error || active) return;
    const t = setTimeout(() => (speech.error = null), 8000);
    return () => clearTimeout(t);
  });
</script>

{#if active}
  <div
    class="player"
    class:dim
    role="toolbar"
    aria-label="Read aloud"
    data-testid="speech-player"
    data-state={speech.state}
    transition:fadeScale={{ from: 'bottom' }}
  >
    <IconButton icon="skip-back" label="Previous sentence" size="sm" tooltipPlacement="top" shortcut={keyState.shortcut('speech.prev')} onclick={run('speech.prev')} data-testid="speech-prev" />
    <span class="main">
      <IconButton
        icon={speaking ? 'pause' : 'play'}
        label={speaking ? 'Pause' : 'Resume'}
        size="sm"
        tooltipPlacement="top"
        shortcut={keyState.shortcut('reader.readAloud')}
        onclick={run('reader.readAloud')}
        data-testid="speech-toggle"
      />
    </span>
    <IconButton icon="skip-forward" label="Next sentence" size="sm" tooltipPlacement="top" shortcut={keyState.shortcut('speech.next')} onclick={run('speech.next')} data-testid="speech-next" />
    <span class="sep" aria-hidden="true"></span>
    <Popover label="Reading speed" bind:open={speedOpen} placement="top">
      {#snippet trigger(attrs)}
        <Tooltip text="Reading speed" placement="top" disabled={speedOpen}>
          <button {...attrs} class="text-btn tabular" aria-label="Reading speed {rate}" data-testid="speech-speed">{rate}</button>
        </Tooltip>
      {/snippet}
      <SpeedControl />
    </Popover>
    <Popover label="Voice" bind:open={voiceOpen} placement="top">
      {#snippet trigger(attrs)}
        <Tooltip text="Voice" placement="top" disabled={voiceOpen}>
          <button {...attrs} class="text-btn voice" aria-label="Voice: {voiceName}" data-testid="speech-voice">
            <Icon name="speaker" size={16} /><span class="vname">{voiceName}</span>
          </button>
        </Tooltip>
      {/snippet}
      <VoicePicker {lang} onpick={() => (voiceOpen = false)} />
    </Popover>
    <span class="sep" aria-hidden="true"></span>
    <IconButton icon="close" label="Stop reading" size="sm" tooltipPlacement="top" shortcut={keyState.shortcut('speech.stop')} onclick={run('speech.stop')} data-testid="speech-stop" />
    <span class="progress" aria-hidden="true"><span class="fill" style:scale="{speech.sentenceProgress} 1"></span></span>
  </div>
{:else if speech.error}
  <div class="player note" role="status" data-testid="speech-error" transition:fadeScale={{ from: 'bottom' }}>
    <span class="icon"><Icon name="speaker" size={16} /></span>
    <span class="msg">{speech.error}</span>
    <IconButton icon="close" label="Dismiss" size="sm" tooltipPlacement="top" onclick={() => (speech.error = null)} />
  </div>
{/if}

<style>
  .player {
    position: absolute;
    left: 50%;
    bottom: 2px; /* sits in the bottom bar's empty centre, never over the text */
    translate: -50% 0;
    z-index: var(--z-chrome);
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: var(--chrome-bg);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-2);
    color: var(--muted);
    overflow: hidden;
    transition: opacity var(--dur-chrome) var(--ease-in), box-shadow var(--dur-chrome) var(--ease-in), border-color var(--dur-chrome) var(--ease-in);
  }
  /* chrome hidden: a whisper of the controls, the progress line still reads */
  .player.dim:not(:hover):not(:focus-within) {
    opacity: 0.45;
    box-shadow: none;
    border-color: transparent;
  }
  .player:hover, .player:focus-within { opacity: 1; transition-duration: var(--dur-fast); transition-timing-function: var(--ease-out); }
  .main :global(button) { color: var(--text); }
  .sep { width: 1px; height: 16px; margin: 0 var(--space-1); background: var(--border); }
  .text-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .text-btn:hover, .text-btn[aria-expanded='true'] { background: var(--hover); color: var(--text); }
  .text-btn:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  .tabular { min-width: 44px; justify-content: center; }
  .vname { max-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 0;
    height: 2px;
    border-radius: var(--radius-full);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    opacity: 0.7;
    transform-origin: left;
    transition: scale var(--dur-base) var(--ease-out);
  }
  .note { gap: var(--space-2); padding: 0 var(--space-1-5) 0 var(--space-4); color: var(--text); font-size: var(--text-sm); }
  .note .icon { display: flex; color: var(--muted); }
  .msg { max-width: 48ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (forced-colors: active) {
    .player { border-color: CanvasText; }
    .fill { background: Highlight; }
  }
</style>
