<script lang="ts">
  // Custom theme editor (story 61): five colours in, a full AA-checked theme out (deriveTheme).
  import { Button, ColorPicker, Dialog, Popover, TextField } from '../ui';
  import { contrast } from '../design/color';
  import { deriveTheme, themeStyle, type AppTheme } from '../design/themes';
  import { settings, type CustomThemeSeed } from '../stores/settings.svelte';
  import { setTheme } from '../shell/theme.svelte';

  interface Props {
    /** start from this theme (editing a custom one, or a built-in as the base for a new one) */
    base: AppTheme;
    /** the custom theme being edited; absent for a new theme */
    editing?: CustomThemeSeed;
    onclose: () => void;
  }
  let { base, editing, onclose }: Props = $props();

  // svelte-ignore state_referenced_locally (seeded once from the props when the editor opens)
  let seed = $state<CustomThemeSeed>(
    editing
      ? { ...editing }
      : {
          id: `custom-${Date.now().toString(36)}`,
          name: `${base.name} variant`,
          bg: base.bg,
          text: base.text,
          accent: base.accent,
          link: base.link,
          selection: base.selection,
        },
  );
  let confirmDelete = $state(false);

  const theme = $derived.by(() => {
    try {
      return deriveTheme(seed);
    } catch {
      return null;
    }
  });
  const adjusted = $derived(
    theme ? (['text', 'accent', 'link'] as const).filter((k) => theme[k].toLowerCase() !== seed[k].toLowerCase()) : [],
  );
  const nameOk = $derived(seed.name.trim().length > 0);

  function save() {
    if (!theme || !nameOk) return;
    const clean = { ...seed, name: seed.name.trim() };
    settings.update('customThemes', (list) => {
      const i = list.findIndex((t) => t.id === clean.id);
      if (i >= 0) list[i] = clean;
      else list.push(clean);
      return list;
    });
    setTheme(clean.id);
    onclose();
  }

  function remove() {
    if (!editing) return;
    const id = editing.id;
    settings.update('customThemes', (list) => list.filter((t) => t.id !== id));
    const s = settings.value;
    if (s.theme === id) settings.set('theme', 'dark');
    if (s.lightTheme === id) settings.set('lightTheme', 'solarized-light');
    if (s.darkTheme === id) settings.set('darkTheme', 'dark');
    confirmDelete = false;
    onclose();
  }

  const fields = [
    { key: 'bg', label: 'Background' },
    { key: 'text', label: 'Text' },
    { key: 'accent', label: 'Accent' },
    { key: 'link', label: 'Links' },
    { key: 'selection', label: 'Selection' },
  ] as const;
  const presets: Record<(typeof fields)[number]['key'], string[]> = {
    bg: ['#1b1c1f', '#101418', '#20232a', '#fdf6e3', '#f3ead6', '#fbfaf8', '#e9eef2'],
    text: ['#e8e4dc', '#c9d1d9', '#657b83', '#3f3121', '#1e1d1b'],
    accent: ['#e2a85e', '#cb4b16', '#d0736a', '#6fae8c', '#6c9bd2', '#b48ead'],
    link: ['#8fb8e8', '#268bd2', '#2e5a86', '#7fb4a2'],
    selection: ['#3a4b66', '#2b3a52', '#e4dcc3', '#cfe0f8', '#e0cfa6'],
  };
</script>

<div class="editor" data-testid="theme-editor">
  <div class="controls">
    <TextField label="Name" bind:value={seed.name} error={nameOk ? undefined : 'Give the theme a name'} />
    <div class="swatches" role="group" aria-label="Colours">
      {#each fields as f (f.key)}
        {@const vs = f.key === 'bg' ? seed.text : seed.bg}
        <div class="colour">
          <span class="c-label">{f.label}</span>
          <span class="c-hex tabular">{seed[f.key]}</span>
          {#if f.key !== 'bg' && f.key !== 'selection'}<span class="c-ratio tabular" title="Contrast against the background">{contrast(seed[f.key], vs).toFixed(1)}:1</span>{/if}
          <Popover label="{f.label} colour" placement="bottom-end">
            {#snippet trigger(attrs)}
              <button {...attrs} class="c-swatch" style="background: {seed[f.key]}" aria-label="Change {f.label.toLowerCase()} colour ({seed[f.key]})" data-colour={f.key}></button>
            {/snippet}
            <ColorPicker label={f.label} bind:value={seed[f.key]} presets={presets[f.key]} against={vs} />
          </Popover>
        </div>
      {/each}
    </div>
    {#if adjusted.length}
      <p class="note" role="status">
        Quire nudged {adjusted.join(', ')} so the page stays comfortable to read (WCAG AA contrast).
      </p>
    {/if}
    <div class="actions">
      {#if editing}
        <Button variant="danger" icon="trash" onclick={() => (confirmDelete = true)}>Delete</Button>
      {/if}
      <span class="spacer"></span>
      <Button variant="subtle" onclick={onclose}>Cancel</Button>
      <Button variant="primary" disabled={!theme || !nameOk} onclick={save}>{editing ? 'Save theme' : 'Create theme'}</Button>
    </div>
  </div>

  <div class="preview-wrap">
    {#if theme}
      <div class="preview" style={themeStyle(theme)} aria-label="Preview of {seed.name}" role="img">
        <div class="p-bar">
          <span class="p-dot"></span><span class="p-title">The Quiet Shore · Chapter 3</span>
          <span class="p-spacer"></span><span class="p-btn">Aa</span>
        </div>
        <div class="p-page">
          <p class="p-eyebrow">Chapter three</p>
          <h4>Low Tide</h4>
          <p>
            The harbour emptied slowly, the way a room does after a long dinner. Mara walked the length of the sea
            wall and counted the boats left <span class="p-sel">leaning in the mud</span>, their ropes slack, their
            names half-washed by salt.
          </p>
          <p>
            She had promised herself an hour without the letter. Instead she read it twice more, <mark>once for
            the words and once for the silence between them</mark>, and then folded it into the
            <a href="#preview" onclick={(e) => e.preventDefault()}>map of the bay</a> her father had drawn.
          </p>
          <div class="p-foot">
            <span class="p-progress"><span style="width: 42%"></span></span>
            <span class="p-meta">42% · 14 min left in chapter</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<Dialog bind:open={confirmDelete} title="Delete “{editing?.name}”?" description="Books using this theme switch back to Dark. This can’t be undone." size="sm">
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (confirmDelete = false)}>Cancel</Button>
    <Button variant="danger" onclick={remove}>Delete theme</Button>
  {/snippet}
</Dialog>

<style>
  .editor { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: var(--space-8); align-items: start; }
  .controls { display: flex; flex-direction: column; gap: var(--space-5); }
  .note { font-size: var(--text-xs); color: var(--muted); }
  .swatches { display: flex; flex-direction: column; }
  .colour { display: flex; align-items: center; gap: var(--space-3); min-height: 48px; border-bottom: 1px solid var(--border-soft); }
  .colour:last-child { border-bottom: 0; }
  .c-label { flex: 1; font-size: var(--text-sm); font-weight: var(--weight-medium); }
  .c-hex { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted); }
  .c-ratio { min-width: 44px; text-align: right; font-size: var(--text-xs); color: var(--muted); }
  .c-swatch {
    width: 32px;
    height: 24px;
    border-radius: var(--radius-sm);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
    transition: scale var(--dur-instant) var(--ease-out);
  }
  .c-swatch:active { scale: 0.94; }
  .actions { display: flex; align-items: center; gap: var(--space-2); padding-top: var(--space-2); }
  .spacer { flex: 1; }
  .preview-wrap { position: sticky; top: 0; }
  .preview {
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--text) 12%, transparent), var(--shadow-2);
    color-scheme: inherit;
  }
  .p-bar { display: flex; align-items: center; gap: var(--space-2); height: 34px; padding: 0 var(--space-4); background: var(--surface); border-bottom: 1px solid var(--border); font-size: var(--text-2xs); color: var(--muted); }
  .p-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); }
  .p-spacer { flex: 1; }
  .p-btn { padding: 2px 6px; border-radius: var(--radius-xs); background: var(--accent); color: var(--on-accent); font-weight: var(--weight-semibold); }
  .p-page { padding: var(--space-8) var(--space-10) var(--space-6); font-family: var(--font-reading); font-size: 16px; line-height: 1.6; }
  .p-eyebrow { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--muted); }
  h4 { margin: var(--space-1) 0 var(--space-3); font-size: 24px; font-weight: 500; }
  .p-page p + p { margin-top: 0.7em; }
  .p-sel { background: var(--selection); }
  mark { background: var(--hl-yellow); color: inherit; border-radius: 2px; padding: 0 1px; }
  a { color: var(--link); }
  .p-foot { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-6); font-family: var(--font-ui); }
  .p-progress { flex: 1; height: 2px; background: color-mix(in oklab, var(--text) 14%, transparent); border-radius: 2px; overflow: hidden; }
  .p-progress span { display: block; height: 100%; background: var(--accent); }
  .p-meta { font-size: var(--text-2xs); color: var(--muted); }
  @media (max-width: 980px) {
    .editor { grid-template-columns: 1fr; }
    .preview-wrap { position: static; }
  }
</style>
