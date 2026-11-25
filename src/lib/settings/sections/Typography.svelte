<script lang="ts">
  // Global Typography Profile + named profiles (story 75). Per-book overrides live in the reader (T8).
  import { Button, Dialog, SegmentedControl, Select, Slider, Switch, TextField } from '../../ui';
  import { bundledFonts, defaultTypography, typographyLimits as L, typographyStyle } from '../../design/fonts';
  import type { PublisherOverride, TypographyProfile } from '../../engines/types';
  import { settings } from '../../stores/settings.svelte';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';
  import { useSearch } from '../search.svelte';

  const search = useSearch();

  const s = $derived(settings.value);
  const t = $derived(s.typography);
  const active = $derived(s.typographyProfiles.find((p) => p.id === s.activeTypographyProfile) ?? null);

  function set<K extends keyof TypographyProfile>(key: K, v: TypographyProfile[K]) {
    const next = { ...$state.snapshot(settings.value.typography), [key]: v };
    settings.set('typography', next);
    // a named profile is a saved copy: editing while it is active keeps it in step
    const id = settings.value.activeTypographyProfile;
    if (id) settings.update('typographyProfiles', (list) => list.map((p) => (p.id === id ? { ...p, profile: next } : p)));
  }

  const profileOptions = $derived([
    { value: '', label: 'Default' },
    ...s.typographyProfiles.map((p) => ({ value: p.id, label: p.name })),
  ]);
  function switchTo(id: string) {
    const p = s.typographyProfiles.find((x) => x.id === id);
    settings.set('activeTypographyProfile', p ? p.id : null);
    settings.set('typography', p ? structuredClone($state.snapshot(p.profile)) : { ...defaultTypography });
  }

  let naming = $state<{ mode: 'new' | 'rename'; name: string } | null>(null);
  let confirmDelete = $state(false);
  const namingOpen = {
    get value() { return naming !== null; },
    set value(v: boolean) { if (!v) naming = null; },
  };
  function commitName() {
    if (!naming) return;
    const name = naming.name.trim();
    if (!name) return;
    if (naming.mode === 'new') {
      const id = `tp-${Date.now().toString(36)}`;
      settings.update('typographyProfiles', (l) => [...l, { id, name, profile: $state.snapshot(settings.value.typography) }]);
      settings.set('activeTypographyProfile', id);
    } else if (active) {
      const id = active.id;
      settings.update('typographyProfiles', (l) => l.map((p) => (p.id === id ? { ...p, name } : p)));
    }
    naming = null;
  }
  function deleteActive() {
    if (!active) return;
    const id = active.id;
    settings.update('typographyProfiles', (l) => l.filter((p) => p.id !== id));
    settings.set('activeTypographyProfile', null);
    confirmDelete = false;
  }

  const fontOptions = bundledFonts.map((f) => ({ value: f.id, label: f.label }));
  const fontInfo = $derived(bundledFonts.find((f) => f.id === t.fontFamily));
  const overrides: { value: PublisherOverride; label: string }[] = [
    { value: 'off', label: 'Keep' },
    { value: 'fonts', label: 'Fonts' },
    { value: 'all', label: 'Everything' },
  ];
  const preview = $derived(typographyStyle({ ...t, marginX: 0 }));
</script>

<div class="profiles" data-setting="Typography profile" hidden={!search.matches('typography profile named save switch')}>
  <Select label="Profile" options={profileOptions} value={s.activeTypographyProfile ?? ''} onchange={switchTo} />
  <Button size="sm" variant="secondary" icon="plus" onclick={() => (naming = { mode: 'new', name: '' })}>Save as profile</Button>
  {#if active}
    <Button size="sm" variant="ghost" icon="edit" onclick={() => (naming = { mode: 'rename', name: active.name })}>Rename</Button>
    <Button size="sm" variant="ghost" icon="trash" onclick={() => (confirmDelete = true)}>Delete</Button>
  {/if}
</div>

<div class="layout">
  <div class="controls">
    <SettingGroup title="Text">
      <SettingRow label="Font" description={fontInfo?.description} keywords="typeface family serif sans">
        <Select label="Font" hideLabel options={fontOptions} value={t.fontFamily} onchange={(v) => set('fontFamily', v)} />
      </SettingRow>
      <SettingRow label="Size" keywords="font size text bigger smaller" stacked>
        <Slider label="Size" hideLabel {...L.fontSize} value={t.fontSize} format={(v) => `${v} px`} oninput={(v) => set('fontSize', v)} />
      </SettingRow>
      <SettingRow label="Weight" keywords="bold light" stacked>
        <Slider label="Weight" hideLabel {...L.fontWeight} value={t.fontWeight} oninput={(v) => set('fontWeight', v)} />
      </SettingRow>
      <SettingRow label="Line spacing" keywords="line height leading" stacked>
        <Slider label="Line spacing" hideLabel {...L.lineHeight} value={t.lineHeight} format={(v) => v.toFixed(2)} oninput={(v) => set('lineHeight', v)} />
      </SettingRow>
      <SettingRow label="Paragraph spacing" keywords="gap between paragraphs" stacked>
        <Slider label="Paragraph spacing" hideLabel {...L.paragraphSpacing} value={t.paragraphSpacing} format={(v) => `${v.toFixed(1)} em`} oninput={(v) => set('paragraphSpacing', v)} />
      </SettingRow>
    </SettingGroup>
    <SettingGroup title="Page">
      <SettingRow label="Line width" description="The longest a line may get." keywords="measure max width characters" stacked>
        <Slider label="Line width" hideLabel {...L.maxLineWidth} value={t.maxLineWidth} format={(v) => `${v} ch`} oninput={(v) => set('maxLineWidth', v)} />
      </SettingRow>
      <SettingRow label="Side margins" keywords="margin padding" stacked>
        <Slider label="Side margins" hideLabel {...L.marginX} value={t.marginX} format={(v) => `${v}%`} oninput={(v) => set('marginX', v)} />
      </SettingRow>
      <SettingRow label="Alignment" keywords="justify left ragged">
        <SegmentedControl label="Alignment" options={[{ value: 'start', label: 'Left' }, { value: 'justify', label: 'Justified' }]} value={t.textAlign} onchange={(v) => set('textAlign', v)} />
      </SettingRow>
      <SettingRow label="Hyphenation" description="Break long words at line ends." keywords="hyphen">
        <Switch label="Hyphenation" hideLabel checked={t.hyphenation} onchange={(v) => set('hyphenation', v)} />
      </SettingRow>
      <SettingRow label="Publisher styles" description="Replace the book’s own fonts, or all of its styling, with yours." keywords="override css epub">
        <SegmentedControl label="Publisher styles" options={overrides} value={t.overridePublisher} onchange={(v) => set('overridePublisher', v)} />
      </SettingRow>
    </SettingGroup>
    <div class="reset">
      <Button variant="subtle" size="sm" icon="undo" onclick={() => settings.set('typography', { ...defaultTypography })}>Restore defaults</Button>
    </div>
  </div>

  <aside class="preview-col" aria-label="Typography preview">
    <div class="preview" data-testid="typography-preview">
      <div class="reading" style={preview}>
        <p class="chapter">Chapter one</p>
        <h4>The Lamplighter’s Year</h4>
        <p>
          Every evening at a quarter past six, Ilse climbed the hill with her ladder and her small brass key, and
          the street came on behind her one window at a time. People said they could set their clocks by her, though
          nobody in the village had owned a working clock since the flood.
        </p>
        <p>
          She liked the hour between lamps best: the light not yet lit, the light just left, and the long blue
          walk in the middle where she was, for a few minutes, the only person awake to it.
        </p>
      </div>
    </div>
    <p class="caption">{fontInfo?.label ?? t.fontFamily} · {t.fontSize}px · {t.lineHeight.toFixed(2)}</p>
  </aside>
</div>

<Dialog bind:open={namingOpen.value} title={naming?.mode === 'rename' ? 'Rename profile' : 'Save as profile'} size="sm">
  {#if naming}
    <form id="tp-name" onsubmit={(e) => { e.preventDefault(); commitName(); }}>
      <TextField label="Name" bind:value={naming.name} placeholder="Night novel" autofocus />
    </form>
  {/if}
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (naming = null)}>Cancel</Button>
    <Button variant="primary" type="submit" form="tp-name" disabled={!naming?.name.trim()}>Save</Button>
  {/snippet}
</Dialog>

<Dialog bind:open={confirmDelete} title="Delete “{active?.name}”?" description="Books that use the global profile switch to Default." size="sm">
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button variant="danger" onclick={deleteActive}>Delete profile</Button>
  {/snippet}
</Dialog>

<style>
  .profiles[hidden] { display: none; }
  .profiles { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-2); margin-bottom: var(--space-8); }
  .layout { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(300px, 1.1fr); gap: var(--space-10); align-items: start; }
  .preview-col { position: sticky; top: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .preview {
    max-height: 520px;
    overflow: hidden;
    padding: var(--space-8) var(--space-8) var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--bg);
    box-shadow: 0 0 0 1px var(--border-soft);
    -webkit-mask-image: linear-gradient(to bottom, #000 82%, transparent);
    mask-image: linear-gradient(to bottom, #000 82%, transparent);
  }
  .reading { color: var(--text); margin: 0 auto; }
  .reading p { margin-bottom: var(--para-spacing); text-indent: var(--para-indent); }
  .reading .chapter { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--muted); text-indent: 0; margin-bottom: var(--space-2); }
  .reading h4 { font-size: 1.45em; font-weight: 500; margin-bottom: 0.7em; line-height: 1.2; }
  .caption { font-size: var(--text-xs); color: var(--muted); text-align: center; }
  .reset { padding-top: var(--space-2); }
  @media (max-width: 1100px) {
    .layout { grid-template-columns: 1fr; }
    .preview-col { position: static; order: -1; }
  }
</style>
