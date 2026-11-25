<script lang="ts">
  import { app } from '../../stores/app.svelte';
  import { coreMode } from '../../core/core';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  const credits = [
    ['pdf.js', 'Apache-2.0'],
    ['foliate-js', 'MIT'],
    ['libarchive.js', 'MIT, BSD, unRAR'],
    ['Literata, Source Serif 4, Inter, Atkinson Hyperlegible Next, JetBrains Mono', 'SIL Open Font License'],
    ['Tauri, Svelte', 'MIT / Apache-2.0'],
  ];
</script>

<div class="hero">
  <svg viewBox="0 0 18 18" width="44" height="44" aria-hidden="true"
    ><rect width="18" height="18" rx="5" fill="var(--accent)" /><path
      d="M5.25 4.75h5.1a2.4 2.4 0 0 1 2.4 2.4v6.1H7.65a2.4 2.4 0 0 1-2.4-2.4z"
      fill="none"
      stroke="var(--on-accent)"
      stroke-width="1.2"
      stroke-linejoin="round"
    /><path d="M9.6 10.4l3.15 2.85" stroke="var(--on-accent)" stroke-width="1.2" stroke-linecap="round" /></svg
  >
  <div>
    <h3>Quire</h3>
    <p class="v tabular" data-testid="about-version">Version {app.version}{coreMode() === 'fake' ? ' · development core' : ''}</p>
    <p class="tag">A quiet reader for long books. Works offline; your files are never changed.</p>
  </div>
</div>

<SettingGroup title="Made with">
  {#each credits as [name, licence] (name)}
    <SettingRow label={name} keywords="licence license credits open source">
      <span class="lic">{licence}</span>
    </SettingRow>
  {/each}
</SettingGroup>

<style>
  .hero { display: flex; align-items: center; gap: var(--space-5); margin-bottom: var(--space-10); }
  h3 { font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 500; letter-spacing: -0.015em; }
  .v { margin-top: 2px; font-size: var(--text-xs); color: var(--muted); }
  .tag { margin-top: var(--space-2); font-size: var(--text-sm); color: var(--muted); }
  .lic { font-size: var(--text-xs); color: var(--muted); }
</style>
