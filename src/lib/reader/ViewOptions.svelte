<script lang="ts">
  // View options: flow, spread, fit / zoom / rotate, Page Tint, comic mode and direction, reader extras.
  // Shown per engine capability, never per format. Everything is remembered per book.
  import { commands } from '../commands';
  import type { BookHandle, Fit, PageTint } from '../engines/types';
  import { settings, type ComicMode } from '../stores/settings.svelte';
  import { IconButton, SegmentedControl, Slider, Switch } from '../ui';
  import type { ReaderSession } from './session.svelte';
  import type { ReadingTools } from './tools.svelte';

  interface Props {
    session: ReaderSession;
    tools: ReadingTools;
    handle: BookHandle;
  }
  let { session, tools, handle }: Props = $props();

  const caps = $derived(handle.capabilities);
  const comic = $derived(session.kind === 'comic');
  const run = (id: string) => () => void commands.execute(id);
  const zoomPct = $derived(`${Math.round(session.zoom * 100)}%`);

  const fitOptions = $derived<{ value: Fit; label: string }[]>(
    comic
      ? [
          { value: 'height', label: 'Height' },
          { value: 'width', label: 'Width' },
          { value: 'page', label: 'Screen' },
        ]
      : [
          { value: 'width', label: 'Width' },
          { value: 'page', label: 'Page' },
          { value: 'actual', label: 'Actual' },
        ],
  );
  const tintOptions: { value: PageTint; label: string }[] = [
    { value: 'smart', label: 'Smart' },
    { value: 'invert', label: 'Invert' },
    { value: 'original', label: 'Original' },
  ];
  const modes: { value: ComicMode; label: string }[] = [
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
    { value: 'webtoon', label: 'Webtoon' },
  ];
  const prefs = $derived(settings.value.reader);
</script>

<div class="view" data-testid="view-options" data-keynav>
  {#if comic}
    <div class="row">
      <span>Pages</span>
      <SegmentedControl label="Comic mode" size="sm" options={modes} value={session.comicMode} onchange={(v) => session.setBookSetting({ comicMode: v })} />
    </div>
    <div class="row">
      <span>Reading direction</span>
      <SegmentedControl label="Reading direction" size="sm" options={[{ value: 'ltr', label: 'Left to right' }, { value: 'rtl', label: 'Right to left' }]} value={session.direction} onchange={(v) => session.setBookSetting({ direction: v })} />
    </div>
  {:else}
    {#if caps.flows}
      <div class="row">
        <span>Layout</span>
        <SegmentedControl label="Layout" size="sm" options={[{ value: 'paginated', label: 'Pages', icon: 'paginate' }, { value: 'scrolled', label: 'Scroll', icon: 'scroll' }]} value={session.flow} onchange={(v) => session.setBookSetting({ flow: v })} />
      </div>
    {/if}
    {#if caps.spreads}
      <div class="row">
        <span>Two-page spread</span>
        <SegmentedControl
          label="Two-page spread"
          size="sm"
          options={[{ value: 'single', label: 'Off' }, { value: 'auto', label: 'When wide' }, { value: 'double', label: 'On' }]}
          value={session.spread}
          onchange={(v) => session.setBookSetting({ spread: v })}
        />
      </div>
    {/if}
  {/if}

  {#if caps.zoom}
    <div class="row">
      <span>Fit</span>
      <SegmentedControl label="Fit" size="sm" options={fitOptions} value={session.fit} onchange={(v) => session.setBookSetting({ fit: v, zoom: null })} />
    </div>
    <div class="row">
      <span>Zoom</span>
      <div class="zoom">
        <IconButton icon="zoom-out" label="Zoom out" size="sm" onclick={run('reader.zoomOut')} />
        <output class="tabular" data-testid="zoom-readout" aria-live="polite">{zoomPct}</output>
        <IconButton icon="zoom-in" label="Zoom in" size="sm" onclick={run('reader.zoomIn')} />
        {#if session.kind === 'pdf'}
          <IconButton icon="rotate" label="Rotate page" size="sm" onclick={run('reader.rotate')} />
        {/if}
      </div>
    </div>
  {/if}

  {#if caps.pageTint}
    <div class="row">
      <span>Page tint</span>
      <SegmentedControl label="Page tint" size="sm" options={tintOptions} value={session.pageTint} onchange={(v) => session.setBookSetting({ pageTint: v })} />
    </div>
  {/if}

  <div class="rule"></div>
  <Switch label="Progress line while reading" checked={prefs.progressLine} onchange={(v) => settings.update('reader', (r) => ({ ...r, progressLine: v }))} />
  <Switch label="Page-turn animation" checked={settings.value.pageAnimations} onchange={(v) => settings.set('pageAnimations', v)} />
  {#if tools.ruler}
    <Slider label="Ruler height" min={28} max={320} step={4} value={tools.rulerHeight} format={(v) => `${v} px`} oninput={(v) => tools.setRulerHeight(v)} />
  {/if}
</div>

<style>
  .view {
    width: 360px;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 32px;
  }
  .row > span {
    color: var(--text);
  }
  .zoom {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  output {
    min-width: 48px;
    text-align: center;
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .rule {
    height: 1px;
    background: var(--border-soft);
    margin: var(--space-1) 0;
  }
</style>
