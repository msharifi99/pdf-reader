<script lang="ts" module>
  let systemFonts: Promise<string[]> | null = null;
</script>

<script lang="ts">
  // "Aa": live typography for reflowable books (stories 71–76). Changes keep the reading position
  // (the engine re-lays-out around the current CFI).
  import { core } from '../core/core';
  import { bundledFonts, defaultTypography, resolveFont, typographyLimits as L } from '../design/fonts';
  import type { PublisherOverride, TypographyProfile } from '../engines/types';
  import { settings } from '../stores/settings.svelte';
  import { Button, SegmentedControl, Select, Slider, Switch } from '../ui';
  import type { ReaderSession } from './session.svelte';
  import { setTypography } from './commands';

  interface Props {
    session: ReaderSession;
  }
  let { session }: Props = $props();

  const t = $derived(session.typography);
  let installed = $state<string[]>([]);
  systemFonts ??= core.listSystemFonts().catch(() => []);
  void systemFonts.then((l) => (installed = l));

  const set = <K extends keyof TypographyProfile>(k: K, v: TypographyProfile[K]) => setTypography(session, { [k]: v } as Partial<TypographyProfile>);

  function toggleOverride(on: boolean) {
    if (on) session.setBookSetting({ typography: $state.snapshot(settings.value.typography) as TypographyProfile });
    else session.setBookSetting({ typography: null });
  }

  const profileOptions = $derived([{ value: '', label: 'Default' }, ...settings.value.typographyProfiles.map((p) => ({ value: p.id, label: p.name }))]);
  function pickProfile(id: string) {
    const p = settings.value.typographyProfiles.find((x) => x.id === id);
    const profile = p ? structuredClone($state.snapshot(p.profile)) : { ...defaultTypography };
    if (session.typographyOverride) session.setBookSetting({ typography: profile as TypographyProfile });
    else {
      settings.set('activeTypographyProfile', p ? p.id : null);
      settings.set('typography', profile as TypographyProfile);
    }
  }

  const fonts = $derived([
    { id: 'publisher', label: 'Book’s own font', stack: 'inherit', group: '' },
    ...bundledFonts.filter((f) => f.category !== 'mono').map((f) => ({ id: f.id, label: f.label, stack: f.stack, group: 'Bundled' })),
    ...installed.map((name) => ({ id: name, label: name, stack: resolveFont(name)?.stack ?? name, group: 'Installed' })),
  ]);
  let fontList: HTMLElement | undefined = $state();
  $effect(() => {
    void t.fontFamily;
    fontList?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  });
  function fontKey(e: KeyboardEvent) {
    const i = fonts.findIndex((f) => f.id === t.fontFamily);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: fonts.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const f = fonts[Math.max(0, Math.min(fonts.length - 1, to))];
    if (f) set('fontFamily', f.id);
  }

  const overrides: { value: PublisherOverride; label: string }[] = [
    { value: 'off', label: 'Keep' },
    { value: 'fonts', label: 'Fonts' },
    { value: 'all', label: 'All' },
  ];
</script>

<div class="typo" data-testid="typography-panel" data-keynav>
  <div class="head">
    <Select label="Profile" hideLabel options={profileOptions} value={session.typographyOverride ? '' : (settings.value.activeTypographyProfile ?? '')} onchange={pickProfile} />
    <Switch label="This book only" checked={session.typographyOverride} onchange={toggleOverride} />
  </div>

  <div class="fonts" role="listbox" aria-label="Font" tabindex="0" bind:this={fontList} onkeydown={fontKey}>
    {#each fonts as f, i (f.id)}
      {#if f.group && f.group !== fonts[i - 1]?.group}<div class="group" role="presentation">{f.group}</div>{/if}
      <div
        role="option"
        class="font"
        aria-selected={t.fontFamily === f.id}
        style:font-family={f.stack}
        tabindex="-1"
        onclick={() => set('fontFamily', f.id)}
        onkeydown={(e) => e.key === 'Enter' && set('fontFamily', f.id)}
      >
        {f.label}
      </div>
    {/each}
  </div>

  <div class="sliders">
    <Slider label="Size" {...L.fontSize} value={t.fontSize} format={(v) => `${v} px`} oninput={(v) => set('fontSize', v)} />
    <Slider label="Line spacing" {...L.lineHeight} value={t.lineHeight} format={(v) => v.toFixed(2)} oninput={(v) => set('lineHeight', v)} />
    <Slider label="Paragraph spacing" {...L.paragraphSpacing} value={t.paragraphSpacing} format={(v) => `${v.toFixed(1)} em`} oninput={(v) => set('paragraphSpacing', v)} />
    <Slider label="Margins" {...L.marginX} value={t.marginX} format={(v) => `${v}%`} oninput={(v) => set('marginX', v)} />
    <Slider label="Line width" {...L.maxLineWidth} value={t.maxLineWidth} format={(v) => `${v} ch`} oninput={(v) => set('maxLineWidth', v)} />
  </div>

  <div class="rows">
    <div class="row">
      <span>Alignment</span>
      <SegmentedControl label="Alignment" size="sm" options={[{ value: 'start', label: 'Left' }, { value: 'justify', label: 'Justified' }]} value={t.textAlign} onchange={(v) => set('textAlign', v)} />
    </div>
    <div class="row"><Switch label="Hyphenation" checked={t.hyphenation} onchange={(v) => set('hyphenation', v)} /></div>
    <div class="row">
      <span>Override publisher styles</span>
      <SegmentedControl label="Override publisher styles" size="sm" options={overrides} value={t.overridePublisher} onchange={(v) => set('overridePublisher', v)} />
    </div>
  </div>

  <div class="foot">
    <Button variant="subtle" size="sm" icon="undo" onclick={() => setTypography(session, { ...defaultTypography })}>Reset</Button>
  </div>
</div>

<style>
  .typo {
    width: 340px;
    padding: var(--space-4);
    display: grid;
    gap: var(--space-4);
  }
  .head {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-3);
    align-items: center;
  }
  .fonts {
    max-height: 176px;
    overflow: auto;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
    background: var(--surface-2);
    outline: none;
  }
  .fonts:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .group {
    padding: var(--space-2) var(--space-2) var(--space-1);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    font-weight: var(--weight-semibold);
    color: var(--muted);
    font-family: var(--font-ui);
  }
  .font {
    padding: 6px var(--space-2-5);
    border-radius: var(--radius-sm);
    font-size: 15px;
    color: var(--text);
    cursor: default;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .font:hover {
    background: var(--hover);
  }
  .font[aria-selected='true'] {
    background: var(--selected);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .sliders {
    display: grid;
    gap: var(--space-3);
  }
  .rows {
    display: grid;
    gap: var(--space-2-5);
    padding-top: var(--space-1);
    border-top: 1px solid var(--border-soft);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 32px;
    font-size: var(--text-sm);
  }
  .row > :global(label) {
    flex: 1;
  }
  .foot {
    display: flex;
    justify-content: flex-end;
  }
</style>
