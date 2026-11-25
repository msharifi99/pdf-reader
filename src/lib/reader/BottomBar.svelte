<script lang="ts">
  // Bottom status (fades with the chrome) and the 2px progress line (stays, unless turned off or in focus mode).
  import { settings } from '../stores/settings.svelte';
  import { ProgressBar } from '../ui';
  import type { ReaderSession } from './session.svelte';
  import type { ReadingTools } from './tools.svelte';
  import { chapterTicks, timeLeft, timeLeftLabel } from './progress';
  import { readerApi } from './slots.svelte';

  interface Props {
    session: ReaderSession;
    tools: ReadingTools;
    ocrProgress: { done: number; total: number } | null;
  }
  let { session, tools, ocrProgress }: Props = $props();

  const loc = $derived(session.location);
  const p = $derived(loc?.progress);
  const h = $derived(session.handle);
  const ticks = $derived(chapterTicks(session.flat, h?.pageCount ?? 1));
  const pct = $derived(p ? Math.round(p.fraction * 1000) / 10 : 0);

  const position = $derived.by(() => {
    if (!p) return '';
    if (p.page) {
      const label = p.page.label && p.page.label !== String(p.page.index + 1) ? `${p.page.label} · ` : '';
      return `${label}${p.page.index + 1} of ${p.page.count}`;
    }
    if (p.location) return `Location ${p.location.index + 1} of ${p.location.count}`;
    return '';
  });

  const left = $derived.by(() => {
    if (!loc || !p) return '';
    return timeLeftLabel(
      timeLeft({ progress: p, locator: loc.locator, flat: session.flat, wordCount: h?.wordCount, pageCount: h?.pageCount, ...session.speed }),
    );
  });
  const always = $derived(settings.value.reader.progressLine && !tools.focus);
</script>

<div class="bar" data-chrome="bottom" data-testid="reader-status">
  <div class="start">
    {#each readerApi.bottom as item, i (i)}{@render item()}{/each}
    {#if ocrProgress}
      <span class="ocr" data-testid="ocr-progress">
        Making searchable · {ocrProgress.done} of {ocrProgress.total}
        <span class="ocr-bar"><ProgressBar label="Making this book searchable" value={ocrProgress.total ? ocrProgress.done / ocrProgress.total : undefined} /></span>
      </span>
    {/if}
  </div>
  <div class="end">
    {#if left}<span class="left" data-testid="time-left">{left}</span>{/if}
    {#if position}<span class="tabular" data-testid="reader-position">{position}</span>{/if}
    {#if p}<span class="tabular pct">{pct}%</span>{/if}
  </div>
</div>

<div class="line" class:always data-chrome={always ? undefined : 'bottom'} data-testid="progress-line">
  <ProgressBar variant="line" label="Book progress" value={p?.fraction ?? 0} marks={ticks} valueText="{pct}% through the book" />
</div>

<style>
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
    height: 32px;
    padding: 0 var(--space-5);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: var(--text-xs);
    color: var(--muted);
    z-index: var(--z-chrome);
    background: var(--chrome-bg);
    backdrop-filter: blur(20px);
  }
  .start,
  .end {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .end > span + span::before {
    content: '·';
    margin-right: var(--space-3);
    color: var(--faint);
  }
  .left {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pct {
    min-width: 4ch;
    text-align: right;
  }
  .ocr {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ocr-bar {
    width: 96px;
  }
  .line {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: var(--z-chrome);
  }
  .line:not(.always) {
    transition: opacity var(--dur-chrome) var(--ease-in);
  }
  :global(:root[data-reader-focus]) .line {
    opacity: 0;
  }
</style>
