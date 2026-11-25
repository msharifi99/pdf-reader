<script lang="ts" module>
  export type SectionId = 'appearance' | 'reading' | 'typography' | 'keyboard' | 'library' | 'data' | 'about';
</script>

<script lang="ts">
  // Ctrl+, — full-window sheet over the current view (under the title bar). Esc closes (app.back).
  import { onMount, tick } from 'svelte';
  import { Icon, SearchField, type IconName } from '../ui';
  import { slide } from '../design/motion';
  import { SettingsSearch, provideSearch } from './search.svelte';
  import Appearance from './sections/Appearance.svelte';
  import Reading from './sections/Reading.svelte';
  import Typography from './sections/Typography.svelte';
  import Keyboard from './sections/Keyboard.svelte';
  import Library from './sections/Library.svelte';
  import Data from './sections/Data.svelte';
  import About from './sections/About.svelte';

  interface Props {
    initial?: SectionId;
  }
  let { initial = 'appearance' }: Props = $props();

  const sections: { id: SectionId; label: string; icon: IconName; description: string }[] = [
    { id: 'appearance', label: 'Appearance', icon: 'theme', description: 'Themes, page tint and motion.' },
    { id: 'reading', label: 'Reading', icon: 'book-open', description: 'How books open and how the reader behaves.' },
    { id: 'typography', label: 'Typography', icon: 'text-size', description: 'The text settings every ebook starts with.' },
    { id: 'keyboard', label: 'Keyboard', icon: 'keyboard', description: 'Every command, and the keys that run it.' },
    { id: 'library', label: 'Library', icon: 'library', description: 'Where Quire finds your books.' },
    { id: 'data', label: 'Data', icon: 'collection', description: 'Backups and where your data lives.' },
    { id: 'about', label: 'About', icon: 'info', description: '' },
  ];

  // svelte-ignore state_referenced_locally (initial section only)
  let current = $state<SectionId>(initial);
  const search = new SettingsSearch();
  provideSearch(search);
  let searchInput: HTMLInputElement | undefined = $state();
  let content: HTMLElement | undefined = $state();
  let returnFocus: HTMLElement | null = null;

  onMount(() => {
    returnFocus = document.activeElement as HTMLElement | null;
    void tick().then(() => searchInput?.focus());
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  });

  function go(id: SectionId) {
    search.query = '';
    current = id;
    content?.scrollTo({ top: 0 });
  }
</script>

<div class="sheet" role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings" transition:slide={{ side: 'bottom', distance: 8 }}>
  <nav aria-label="Settings sections">
    <div class="search">
      <SearchField bind:value={search.query} bind:input={searchInput} placeholder="Search settings" label="Search settings" />
    </div>
    <ul>
      {#each sections as s (s.id)}
        <li>
          <button class="nav-item" aria-current={!search.active && current === s.id ? 'page' : undefined} onclick={() => go(s.id)} data-section={s.id}>
            <Icon name={s.icon} size={16} />
            <span>{s.label}</span>
          </button>
        </li>
      {/each}
    </ul>
  </nav>
  <div class="content" bind:this={content}>
    <div class="inner" class:searching={search.active}>
      {#each sections as s (s.id)}
        <section class="section" hidden={!search.active && current !== s.id} aria-labelledby="sec-{s.id}" data-section-body={s.id}>
          <header>
            <h2 id="sec-{s.id}">{s.label}</h2>
            {#if s.description && !search.active}<p class="lede">{s.description}</p>{/if}
          </header>
          {#if s.id === 'appearance'}<Appearance />
          {:else if s.id === 'reading'}<Reading />
          {:else if s.id === 'typography'}<Typography />
          {:else if s.id === 'keyboard'}<Keyboard />
          {:else if s.id === 'library'}<Library />
          {:else if s.id === 'data'}<Data />
          {:else}<About />{/if}
        </section>
      {/each}
      {#if search.active}
        <p class="no-results">Nothing in settings matches “{search.query}”</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .sheet {
    position: absolute;
    inset: var(--titlebar-h) 0 0 0;
    z-index: var(--z-modal);
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    background: var(--bg);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5) var(--space-3);
    border-right: 1px solid var(--border-soft);
    background: color-mix(in oklab, var(--surface) 60%, var(--bg));
    overflow-y: auto;
  }
  .search { padding: 0 var(--space-1); }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .nav-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    height: 36px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--muted);
    font-size: var(--text-sm);
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .nav-item:hover { background: var(--hover); color: var(--text); }
  .nav-item:focus-visible { outline-offset: -2px; }
  .nav-item[aria-current='page'] { background: var(--selected); color: var(--text); font-weight: var(--weight-medium); }
  .nav-item[aria-current='page']::before {
    content: '';
    position: absolute;
    left: 1px;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: var(--accent);
  }
  .content { overflow-y: auto; scrollbar-gutter: stable; }
  .inner { max-width: 760px; padding: var(--space-10) var(--space-12) var(--space-24); }
  .inner:has(:global([data-testid='theme-editor'])),
  .inner:has(:global(.layout)) { max-width: 1040px; }
  .section[hidden] { display: none; }
  header { margin-bottom: var(--space-8); }
  h2 { font-size: var(--text-xl); }
  .lede { margin-top: var(--space-1-5); color: var(--muted); font-size: var(--text-sm); }
  /* searching: every section shows; one with no matching row hides entirely */
  .searching .section { margin-bottom: var(--space-12); }
  .searching .section:not(:has(:global([data-setting]:not([hidden])))) { display: none; }
  .no-results { display: none; padding: var(--space-16) 0; text-align: center; color: var(--muted); }
  .searching:not(:has(.section:not([hidden]) :global([data-setting]:not([hidden])))) .no-results { display: block; }

  @media (max-width: 760px) {
    .sheet { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    nav { flex-direction: row; align-items: center; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border-soft); padding: var(--space-2) var(--space-3); }
    ul { flex-direction: row; }
    .nav-item span { white-space: nowrap; }
    .inner { padding: var(--space-6) var(--space-5) var(--space-16); }
  }
</style>
