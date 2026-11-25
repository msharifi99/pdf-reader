<script lang="ts">
  import { SegmentedControl, Select, Switch, Icon } from '../../ui';
  import { settings, type CustomThemeSeed, type PageTint } from '../../stores/settings.svelte';
  import { activeTheme, allThemes, setTheme } from '../../shell/theme.svelte';
  import type { AppTheme } from '../../design/themes';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';
  import ThemeCard from '../ThemeCard.svelte';
  import ThemeEditor from '../ThemeEditor.svelte';
  import { useSearch } from '../search.svelte';

  const search = useSearch();
  const s = $derived(settings.value);
  const themes = $derived(allThemes());
  const current = $derived(activeTheme());
  const lightOptions = $derived(themes.filter((t) => !t.dark).map((t) => ({ value: t.id, label: t.name })));
  const darkOptions = $derived(themes.filter((t) => t.dark).map((t) => ({ value: t.id, label: t.name })));

  let editor = $state<{ base: AppTheme; editing?: CustomThemeSeed } | null>(null);

  function pick(t: AppTheme) {
    // following Windows: the card fills the light or dark slot instead of switching follow off
    if (s.followSystem) settings.set(t.dark ? 'darkTheme' : 'lightTheme', t.id);
    else setTheme(t.id);
  }
  function tagFor(t: AppTheme): string | undefined {
    if (!s.followSystem) return undefined;
    if (t.id === s.lightTheme) return 'Light';
    if (t.id === s.darkTheme) return 'Dark';
    return undefined;
  }
  const isSelected = (t: AppTheme) => (s.followSystem ? t.id === s.lightTheme || t.id === s.darkTheme : t.id === current.id);
  const seedOf = (id: string) => s.customThemes.find((c) => c.id === id);

  const tints: { value: PageTint; label: string }[] = [
    { value: 'smart', label: 'Smart' },
    { value: 'invert', label: 'Invert' },
    { value: 'original', label: 'Original' },
  ];
</script>

{#if editor && !search.active}
  <div class="editor-head">
    <button class="crumb" onclick={() => (editor = null)}><Icon name="chevron-left" size={16} />Appearance</button>
    <h2>{editor.editing ? `Edit “${editor.editing.name}”` : 'New theme'}</h2>
  </div>
  <ThemeEditor base={editor.base} editing={editor.editing} onclose={() => (editor = null)} />
{:else}
  <SettingGroup title="Theme">
    <SettingRow label="Colour theme" description="Ebooks follow the theme fully; PDF and comic pages are tinted to match." keywords="colour color dark light solarized sepia oled custom" stacked>
      <div class="themes" role="radiogroup" aria-label="Theme">
        {#each themes as t (t.id)}
          <ThemeCard
            theme={t}
            selected={isSelected(t)}
            tag={tagFor(t)}
            onselect={() => pick(t)}
            onedit={t.builtin ? undefined : () => (editor = { base: t, editing: seedOf(t.id) })}
          />
        {/each}
        <button class="new" onclick={() => (editor = { base: current })} data-testid="new-theme">
          <span class="plus"><Icon name="plus" size={20} /></span>
          <span class="name">New theme</span>
        </button>
      </div>
    </SettingRow>
    <SettingRow label="Follow Windows" description="Switch between a light and a dark theme with the Windows setting." keywords="system auto automatic night">
      <Switch label="Follow Windows" hideLabel checked={s.followSystem} onchange={(v) => settings.set('followSystem', v)} />
    </SettingRow>
    {#if s.followSystem}
      <SettingRow label="Light theme" description="Used while Windows is in light mode." keywords="day">
        <Select label="Light theme" hideLabel options={lightOptions} value={s.lightTheme} onchange={(v) => settings.set('lightTheme', v)} />
      </SettingRow>
      <SettingRow label="Dark theme" description="Used while Windows is in dark mode." keywords="night">
        <Select label="Dark theme" hideLabel options={darkOptions} value={s.darkTheme} onchange={(v) => settings.set('darkTheme', v)} />
      </SettingRow>
    {/if}
  </SettingGroup>

  <SettingGroup title="Pages">
    <SettingRow label="Page tint" description="How PDF and comic pages are recoloured by default. Smart keeps photos natural; you can change it per book." keywords="invert dark pdf comic recolour">
      <SegmentedControl label="Page tint" options={tints} value={s.pageTint} onchange={(v) => settings.set('pageTint', v)} />
    </SettingRow>
  </SettingGroup>

  <SettingGroup title="Motion">
    <SettingRow label="Reduce motion" description="Turns off fades and slides. Quire already follows the Windows animation setting." keywords="animation accessibility">
      <Switch label="Reduce motion" hideLabel checked={s.reduceMotion} onchange={(v) => settings.set('reduceMotion', v)} />
    </SettingRow>
  </SettingGroup>
{/if}

<style>
  .themes { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: var(--space-5) var(--space-4); padding-top: var(--space-1); }
  .new { display: flex; flex-direction: column; gap: var(--space-2); border-radius: var(--radius-md); text-align: left; }
  .new .plus {
    display: grid;
    place-items: center;
    aspect-ratio: 3 / 2;
    border-radius: var(--radius-md);
    border: 1px dashed var(--border-strong);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .new:hover .plus { background: var(--hover); color: var(--text); }
  .new .name { font-size: var(--text-xs); font-weight: var(--weight-medium); color: var(--muted); }
  .editor-head { margin-bottom: var(--space-6); }
  .crumb { display: inline-flex; align-items: center; gap: var(--space-1); margin-left: -6px; padding: 2px 6px; border-radius: var(--radius-sm); font-size: var(--text-xs); color: var(--muted); }
  .crumb:hover { background: var(--hover); color: var(--text); }
  h2 { margin-top: var(--space-1); font-size: var(--text-xl); }
</style>
