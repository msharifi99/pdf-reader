<script lang="ts">
  // Read-aloud + lookup for one open book (mounted through addReaderOverlay, so it lives exactly as long
  // as the book): registers the commands, the selection-menu "Define" action, and renders the UI.
  import { onMount } from 'svelte';
  import { readerApi } from '../../reader/slots.svelte';
  import { addSelectionAction } from '../../annotations/selection.svelte';
  import { keyState } from '../../commands';
  import { lookupPopover, registerLookupCommands } from '../../lookup';
  import LookupPopover from '../../lookup/ui/LookupPopover.svelte';
  import { registerSpeechCommands, speech } from '..';
  import ReadAloudPlayer from './ReadAloudPlayer.svelte';

  const lang = () => readerApi.session?.handle?.metadata.language ?? null;

  onMount(() => {
    const session = readerApi.session;
    const engine = session?.engine;
    const close = () => lookupPopover.open && lookupPopover.close();
    const offs = [
      registerSpeechCommands(() => readerApi.session?.engine ?? null, () => ({ lang: lang() })),
      registerLookupCommands(() => {
        const s = readerApi.session?.selection;
        return s ? { text: s.text, rect: readerApi.selectionRect() ?? undefined, lang: lang() } : null;
      }),
      addSelectionAction({
        id: 'lookup.define',
        label: 'Define',
        icon: 'dictionary',
        get shortcut() {
          return keyState.shortcut('lookup.define');
        },
        run: (sel) => void lookupPopover.show(sel.text, { lang: lang(), rect: sel.rect }),
      }),
      // reflow pages live in iframes, where the popover's light dismiss can't see clicks
      engine?.on('pointer', close) ?? (() => {}),
      engine?.on('relocated', close) ?? (() => {}),
    ];
    return () => {
      offs.forEach((f) => f());
      lookupPopover.close();
      speech.error = null;
    };
  });
</script>

<ReadAloudPlayer />
<LookupPopover />

<style>
  /* PDF spoken word / sentence (the engine draws boxes inline): the same soft accent wash and underline as reflow */
  :global(.q-d.q-d-speech-word) {
    background: color-mix(in srgb, var(--accent) 26%, transparent) !important;
    border-radius: 3px;
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--accent) 85%, transparent);
  }
  :global(.q-d.q-d-speech-sentence) {
    background: color-mix(in srgb, var(--accent) 9%, transparent) !important;
    border-radius: 3px;
  }
</style>
