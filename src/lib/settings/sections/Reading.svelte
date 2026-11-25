<script lang="ts">
  import { SegmentedControl, Slider, Switch } from '../../ui';
  import { settings, type ComicMode } from '../../stores/settings.svelte';
  import type { Flow } from '../../engines/types';
  import SettingGroup from '../SettingGroup.svelte';
  import SettingRow from '../SettingRow.svelte';

  const s = $derived(settings.value);
  const flows: { value: Flow; label: string }[] = [
    { value: 'paginated', label: 'Pages' },
    { value: 'scrolled', label: 'Scroll' },
  ];
  const comic: { value: ComicMode; label: string }[] = [
    { value: 'single', label: 'Single' },
    { value: 'double', label: 'Double' },
    { value: 'webtoon', label: 'Webtoon' },
  ];
  // svelte-ignore state_referenced_locally (local slider value; written back on input)
  let delay = $state(s.chromeHideDelay / 1000);
</script>

<SettingGroup title="Default layout">
  <SettingRow label="PDF documents" description="New PDFs open this way. Each book remembers its own choice." keywords="flow scroll paginated pdf">
    <SegmentedControl label="PDF layout" options={flows} value={s.flowPdf} onchange={(v) => settings.set('flowPdf', v)} />
  </SettingRow>
  <SettingRow label="Ebooks" description="EPUB, MOBI, AZW3 and FB2." keywords="flow scroll paginated epub mobi">
    <SegmentedControl label="Ebook layout" options={flows} value={s.flowReflow} onchange={(v) => settings.set('flowReflow', v)} />
  </SettingRow>
  <SettingRow label="Comics" description="Webtoon scrolls one long strip." keywords="cbz cbr manga spread double">
    <SegmentedControl label="Comic layout" options={comic} value={s.comicMode} onchange={(v) => settings.set('comicMode', v)} />
  </SettingRow>
</SettingGroup>

<SettingGroup title="While reading">
  <SettingRow label="Page-turn animation" description="A short slide when you turn a page." keywords="animation motion transition">
    <Switch label="Page-turn animation" hideLabel checked={s.pageAnimations} onchange={(v) => settings.set('pageAnimations', v)} />
  </SettingRow>
  <SettingRow label="Hide controls after" description="Controls fade once you stop moving the mouse. Any input brings them back." keywords="chrome auto-hide toolbar idle delay">
    <div class="slider">
      <Slider
        label="Hide controls after"
        hideLabel
        min={1}
        max={6}
        step={0.5}
        bind:value={delay}
        format={(v) => `${v} s`}
        oninput={(v) => settings.set('chromeHideDelay', v * 1000)}
      />
    </div>
  </SettingRow>
</SettingGroup>

<style>
  .slider { width: 240px; }
</style>
