<!--
  LibraryView — the library home screen (T7).

  Contract (unchanged from the T5 placeholder)
  - Props: none. Mounted by App.svelte when `app.view === 'library'`, inside the scrollable view
    area under the title bar; paints its own `--bg` and owns the 40px page gutter.
  - Opens books with `openDocument(path, { locator? })` from '../stores/app.svelte' (never throws).
  - Key context 'library' (set by the shell). library.* commands, app.switchBook (Ctrl+P picker,
    palette mode 'books') and app.newWindow are registered once at boot by `installLibrary()` below,
    so they also work from the reader and from Settings.
  - Drag & drop, Ctrl+O and launch files are handled by the shell; new books arrive via `library-changed`.
-->
<script lang="ts" module>
  import { installLibrary } from './library.svelte';
  installLibrary();
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Book, Collection, Format, Status } from '../core/bindings';
  import { core } from '../core/core';
  import { commands, isEditableTarget, keyState } from '../commands';
  import { Button, ContextMenu, EmptyState, Icon, Kbd, Menu, ProgressBar, SearchField, SegmentedControl, type MenuItem } from '../ui';
  import { settings } from '../stores/settings.svelte';
  import { overlays } from '../shell/overlays.svelte';
  import { reportError } from '../shell/errors.svelte';
  import Shelf from './Shelf.svelte';
  import ContinueReading from './ContinueReading.svelte';
  import EditBookDialog from './EditBookDialog.svelte';
  import CollectionDialog from './CollectionDialog.svelte';
  import BookCover from './BookCover.svelte';
  import { FORMAT_GROUPS, greeting, isDone } from './format';
  import { cancelLibrarySearch } from '../indexing/search';
  import {
    filtersActive, lib, openHit, openLibraryBook, provideSearch, reload, searchContents, setPrefs, startCoverPassNow, visibleBooks, type ContentGroup,
  } from './library.svelte';

  let scroller: HTMLElement | undefined = $state();
  let searchEl: HTMLInputElement | undefined = $state();
  const prefs = $derived(settings.value.library);
  const books = $derived(visibleBooks());
  const text = $derived(lib.query.text.trim());
  const searching = $derived(text.length > 0);
  const narrowed = $derived(searching || filtersActive());
  const showContinue = $derived(!narrowed && lib.continuing.length > 0);
  const empty = $derived(lib.loaded && !narrowed && books.length === 0 && lib.collections.length === 0 && !lib.query.collection);

  $effect(() => provideSearch(searchEl));

  // re-query whenever what is asked for changes (search is instant: one indexed query per keystroke)
  $effect(() => {
    void lib.query.text;
    void lib.query.formats.length;
    void lib.query.status;
    void lib.query.collection;
    void prefs.sort;
    void prefs.reverse;
    void reload();
  });

  // ---- full-text ("Found in books") ----
  let content: ContentGroup[] = $state([]);
  let contentFor = $state('');
  $effect(() => {
    const q = text;
    if (q.length < 4) {
      cancelLibrarySearch();
      content = [];
      contentFor = '';
      return;
    }
    // librarySearch debounces and supersedes: a stale call resolves null
    searchContents(q).then(
      (r) => {
        if (r) {
          content = r;
          contentFor = q;
        }
      },
      (err) => console.warn('[library] full-text search failed', err),
    );
  });

  onMount(() => {
    void reload();
    startCoverPassNow();
    // type-to-search: a printable key anywhere in the library starts a search
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlays.any || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (isEditableTarget(t) || t?.closest?.('[role=menu], [popover], dialog')) return;
      if (e.key === 'Escape' && lib.query.text) {
        lib.query.text = '';
        return;
      }
      if (e.key.length !== 1 || e.key === ' ') return;
      e.preventDefault();
      lib.query.text += e.key;
      searchEl?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function open(b: Book, e: MouseEvent | KeyboardEvent) {
    lib.selId = b.id;
    if (e.ctrlKey || e.metaKey) void commands.execute('app.newWindow', { bookId: b.id });
    else void openLibraryBook(b);
  }

  // ---- menus ----
  const sc = (id: string) => keyState.shortcut(id) ?? undefined;
  function bookMenu(b: Book): MenuItem[] {
    const run = (id: string, args: object = {}) => () => void commands.execute(id, { bookId: b.id, ...args });
    const done = isDone(b);
    return [
      { type: 'label', label: b.title },
      { id: 'open', label: done ? 'Read again' : b.progress ? 'Resume' : 'Open', icon: 'book-open', shortcut: 'Enter', onselect: () => void openLibraryBook(b) },
      { id: 'win', label: 'Open in new window', icon: 'open', shortcut: sc('library.openInNewWindow'), onselect: run('library.openInNewWindow') },
      { type: 'separator' },
      done || b.status === 'reading'
        ? { id: 'unread', label: 'Mark as unread', icon: 'undo', onselect: run('library.markUnread') }
        : { id: 'finished', label: 'Mark as finished', icon: 'check-circle', onselect: run('library.markFinished') },
      ...(done ? [] : b.status === 'reading' ? [{ id: 'finished', label: 'Mark as finished', icon: 'check-circle' as const, onselect: run('library.markFinished') }] : []),
      { id: 'edit', label: 'Edit details…', icon: 'edit', shortcut: sc('library.editMetadata'), onselect: run('library.editMetadata') },
      { type: 'separator' },
      { type: 'label', label: 'Collections' },
      ...lib.collections.map((c) => ({ id: `c-${c.id}`, label: c.name, checked: b.collections.includes(c.id), onselect: run('library.toggleCollection', { collectionId: c.id }) })),
      { id: 'newc', label: 'New collection…', icon: 'plus', onselect: run('library.newCollection') },
      { type: 'separator' },
      { id: 'reveal', label: 'Show in Explorer', icon: 'folder', disabled: !b.available, onselect: run('library.revealInExplorer') },
      { id: 'remove', label: 'Remove from library', icon: 'trash', danger: true, shortcut: sc('library.remove'), onselect: run('library.remove') },
    ];
  }

  const SORTS = [
    { id: 'recent', label: 'Recently read' },
    { id: 'added', label: 'Recently added' },
    { id: 'title', label: 'Title' },
    { id: 'author', label: 'Author' },
    { id: 'progress', label: 'Progress' },
  ] as const;
  const sortLabel = $derived(SORTS.find((s) => s.id === prefs.sort)?.label ?? 'Sort');
  const sortItems = $derived<MenuItem[]>([
    ...SORTS.map((s) => ({ id: s.id, label: s.label, checked: prefs.sort === s.id, onselect: () => setPrefs({ sort: s.id }) })),
    { type: 'separator' },
    { id: 'rev', label: 'Reverse order', checked: prefs.reverse, onselect: () => setPrefs({ reverse: !prefs.reverse }) },
  ]);

  const STATUSES: { id: Status; label: string }[] = [
    { id: 'unread', label: 'Unread' },
    { id: 'reading', label: 'Reading' },
    { id: 'finished', label: 'Finished' },
  ];
  const groupOn = (fs: Format[]) => fs.every((f) => lib.query.formats.includes(f));
  function toggleGroup(fs: Format[]) {
    lib.query.formats = groupOn(fs) ? lib.query.formats.filter((f) => !fs.includes(f)) : [...new Set([...lib.query.formats, ...fs])];
  }
  const filterCount = $derived((lib.query.status ? 1 : 0) + FORMAT_GROUPS.filter((g) => groupOn(g.formats)).length);
  const filterItems = $derived<MenuItem[]>([
    { type: 'label', label: 'Status' },
    ...STATUSES.map((s) => ({ id: s.id, label: s.label, checked: lib.query.status === s.id, onselect: () => (lib.query.status = lib.query.status === s.id ? null : s.id) })),
    { type: 'separator' },
    { type: 'label', label: 'Format' },
    ...FORMAT_GROUPS.map((g) => ({ id: g.label, label: g.label, checked: groupOn(g.formats), onselect: () => toggleGroup(g.formats) })),
    { type: 'separator' },
    { id: 'clear', label: 'Clear filters', icon: 'clear', disabled: !filterCount, onselect: clearFilters },
  ]);
  function clearFilters() {
    lib.query.status = null;
    lib.query.formats = [];
  }
  function clearAll() {
    clearFilters();
    lib.query.collection = null;
    lib.query.text = '';
  }

  const addItems: MenuItem[] = [
    { id: 'file', label: 'Open a book…', icon: 'open', shortcut: sc('app.openFile'), onselect: () => void commands.execute('app.openFile') },
    { id: 'folder', label: 'Watch a folder…', icon: 'folder', onselect: () => void commands.execute('library.addFolder') },
  ];

  function collectionMenu(t: EventTarget | null): MenuItem[] {
    const id = (t as HTMLElement | null)?.closest?.('[data-collection]')?.getAttribute('data-collection');
    const c = lib.collections.find((x) => x.id === id);
    if (!c) return [];
    return [
      { id: 'rename', label: 'Rename…', icon: 'edit', onselect: () => (lib.collectionDialog = { rename: c }) },
      { id: 'delete', label: 'Delete collection', icon: 'trash', danger: true, onselect: () => void deleteCollection(c) },
    ];
  }
  async function deleteCollection(c: Collection) {
    try {
      await core.deleteCollection(c.id);
      if (lib.query.collection === c.id) lib.query.collection = null;
      await reload();
    } catch (err) {
      reportError(err, 'Couldn’t delete that collection.');
    }
  }

  const heading = $derived(
    searching
      ? 'Titles and authors'
      : [
          lib.query.collection ? (lib.collections.find((c) => c.id === lib.query.collection)?.name ?? 'Collection') : 'All books',
          lib.query.status && STATUSES.find((x) => x.id === lib.query.status)?.label,
          ...FORMAT_GROUPS.filter((g) => groupOn(g.formats)).map((g) => g.label.replace(/ \(.*\)$/, '')),
        ]
          .filter(Boolean)
          .join(' · '),
  );
</script>

<div class="library" bind:this={scroller} data-testid="library-view" data-library-root>
  <div class="page">
    <header class="top">
      <h1>{greeting()}</h1>
      {#if !empty}
        <div class="controls">
          <div class="search">
            <SearchField bind:value={lib.query.text} bind:input={searchEl} label="Search your library" placeholder="Search title, author or text" shortcut={sc('library.focusSearch')} onescape={() => searchEl?.blur()} />
          </div>
          <SegmentedControl
            size="sm"
            label="View"
            value={prefs.view}
            onchange={(v) => setPrefs({ view: v })}
            options={[
              { value: 'grid', label: 'Cover grid', icon: 'grid', iconOnly: true },
              { value: 'list', label: 'Compact list', icon: 'list', iconOnly: true },
            ]}
          />
          <Menu items={filterItems} label="Filter">
            {#snippet trigger(attrs)}
              <Button {...attrs} variant="ghost" icon="filter" class={filterCount ? 'on' : ''} data-testid="filter-button">Filter{filterCount ? ` · ${filterCount}` : ''}</Button>
            {/snippet}
          </Menu>
          <Menu items={sortItems} label="Sort" placement="bottom-end">
            {#snippet trigger(attrs)}
              <Button {...attrs} variant="ghost" icon="sort" data-testid="sort-button">{sortLabel}</Button>
            {/snippet}
          </Menu>
          <Menu items={addItems} label="Add books" placement="bottom-end">
            {#snippet trigger(attrs)}
              <Button {...attrs} variant="secondary" icon="plus">Add</Button>
            {/snippet}
          </Menu>
        </div>
      {/if}
    </header>

    {#if lib.ingest}
      <div class="ingest" role="status" data-testid="ingest">
        <span>Adding books from your folders · <span class="tabular">{lib.ingest.done} of {lib.ingest.total}</span></span>
        <div class="ingest-bar"><ProgressBar value={lib.ingest.total ? lib.ingest.done / lib.ingest.total : undefined} label="Scanning folders" /></div>
      </div>
    {/if}

    {#if empty}
      <div class="empty">
        <div class="shelf-art" aria-hidden="true">
          <span style="--h: 64px"></span>
          <span style="--h: 82px"></span>
          <span style="--h: 72px"></span>
          <span style="--h: 76px; --t: -10deg"></span>
        </div>
        <h2>Your shelves are empty</h2>
        <p>Drop PDFs, ebooks and comics anywhere in this window, or add a folder and Quire will keep it in sync.</p>
        <div class="actions">
          <Button variant="primary" icon="plus" onclick={() => commands.execute('app.openFile')}>Add books</Button>
          <Button variant="secondary" icon="folder" onclick={() => commands.execute('library.addFolder')}>Watch a folder</Button>
        </div>
        <p class="hint"><Kbd keys={sc('app.openPalette') ?? 'Ctrl+K'} /> for every command · <Kbd keys="?" /> for shortcuts</p>
      </div>
    {:else if lib.loaded}
      {#if showContinue}
        <ContinueReading books={lib.continuing} menu={bookMenu} onopen={open} ondown={() => commands.execute('library.first')} />
      {/if}

      {#if !searching || books.length}<div class="bar">
        <h2 class="label" data-testid="shelf-heading">{heading} <span class="count tabular">· {books.length}</span></h2>
        {#if !searching}
          <ContextMenu items={collectionMenu} label="Collection">
            <div class="chips" role="toolbar" aria-label="Collections" data-testid="collections">
              <button type="button" class="chip" aria-pressed={!lib.query.collection} onclick={() => (lib.query.collection = null)}>All</button>
              {#each lib.collections as c (c.id)}
                <button type="button" class="chip" data-collection={c.id} aria-pressed={lib.query.collection === c.id} onclick={() => (lib.query.collection = lib.query.collection === c.id ? null : c.id)}>
                  {c.name}<span class="n tabular">{c.count}</span>
                </button>
              {/each}
              <button type="button" class="chip add" aria-label="New collection" onclick={() => commands.execute('library.newCollection')}><Icon name="plus" size={14} /></button>
            </div>
          </ContextMenu>
        {/if}
      </div>{/if}

      {#if books.length && scroller}
        <Shelf {books} view={prefs.view} {scroller} menu={bookMenu} onopen={open} />
      {:else if !books.length && !content.length}
        <div class="none" data-testid="library-no-match">
          <EmptyState
            icon={searching ? 'search' : 'filter'}
            title={searching ? 'No titles or authors match' : 'Nothing here yet'}
            description={searching ? 'Try fewer words, or search the text inside your books with a longer phrase.' : lib.query.collection && !filtersActive() ? 'Right-click a book and choose this collection to add it.' : 'No books match these filters.'}
          >
            {#snippet actions()}
              <Button variant="secondary" onclick={clearAll}>Show all books</Button>
            {/snippet}
          </EmptyState>
        </div>
      {/if}

      {#if content.length}
        <section class="found" aria-labelledby="found-h" data-testid="found-in-books">
          <h2 id="found-h" class="label">Found in books <span class="count tabular">· {content.length}</span></h2>
          {#each content as g (g.bookId)}
            {@const b = g.book}
            <div class="group">
              <div class="g-cover"><BookCover title={g.title} src={b?.coverUrl} bare /></div>
              <div class="g-body">
                <h3 class="g-title">{g.title}{#if b?.author}<span class="g-author">{b.author}</span>{/if}</h3>
                <ul>
                  {#each g.hits as h, k (k)}
                    <li>
                      <button type="button" class="hit" onclick={() => openHit(g.bookId, h.locator)}>
                        {#each h.segments as p, n (n)}{#if p.match}<mark>{p.text}</mark>{:else}{p.text}{/if}{/each}
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            </div>
          {/each}
          {#if contentFor !== text}<p class="stale">Searching…</p>{/if}
        </section>
      {/if}
    {/if}
  </div>
</div>

{#if lib.editing}<EditBookDialog book={lib.editing} />{/if}
{#if lib.collectionDialog}<CollectionDialog bookId={lib.collectionDialog.bookId} rename={lib.collectionDialog.rename} />{/if}

<style>
  .library { height: 100%; overflow: auto; background: var(--bg); scrollbar-gutter: stable; }
  .page { max-width: 1840px; margin: 0 auto; padding: var(--space-10) var(--space-10) var(--space-16); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); margin-bottom: var(--space-10); min-height: 40px; }
  h1 { font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 500; letter-spacing: -0.015em; white-space: nowrap; }
  .controls { display: flex; align-items: center; gap: var(--space-2); }
  .search { width: 280px; margin-right: var(--space-2); }
  .controls :global(.on) { color: var(--text); background: var(--accent-soft); }

  .ingest { display: flex; align-items: center; gap: var(--space-4); margin: calc(var(--space-6) * -1) 0 var(--space-8); font-size: var(--text-xs); color: var(--muted); }
  .ingest-bar { width: 160px; }

  .label {
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }
  .count { font-weight: var(--weight-medium); opacity: 0.8; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-6); min-height: 28px; margin-bottom: var(--space-5); }
  .chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-1); }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .chip:hover { background: var(--hover); color: var(--text); }
  .chip[aria-pressed='true'] { background: var(--accent-soft); color: var(--text); }
  .chip .n { font-size: 10px; color: var(--muted); }
  .chip.add { width: 28px; padding: 0; justify-content: center; }

  .none { padding-top: var(--space-12); }

  .found { margin-top: var(--space-12); }
  .found > .label { margin-bottom: var(--space-4); }
  .group { display: flex; gap: var(--space-4); padding: var(--space-4) 0; border-top: 1px solid var(--border-soft); content-visibility: auto; contain-intrinsic-size: auto 120px; }
  .g-cover { flex: none; width: 40px; padding-top: 2px; }
  .g-body { min-width: 0; flex: 1; }
  .g-title { font-family: var(--font-display); font-size: var(--text-md); font-weight: 500; margin-bottom: var(--space-1-5); }
  .g-author { margin-left: var(--space-2); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--muted); font-weight: 400; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .hit {
    display: block;
    width: 100%;
    max-width: 90ch;
    padding: var(--space-1-5) var(--space-2-5);
    margin-left: calc(var(--space-2-5) * -1);
    border-radius: var(--radius-sm);
    text-align: left;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--muted);
  }
  .hit:hover { background: var(--hover); color: var(--text); }
  .hit:focus-visible { outline-offset: -2px; }
  mark { background: none; color: var(--text); font-weight: var(--weight-semibold); }
  .stale { font-size: var(--text-xs); color: var(--faint); }

  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-2); margin: 10vh auto 0; max-width: 440px; }
  .shelf-art { display: flex; align-items: flex-end; gap: 6px; height: 90px; margin-bottom: var(--space-6); padding: 0 var(--space-4) 2px; border-bottom: 1.5px solid var(--border-strong); }
  .shelf-art span { width: 18px; height: var(--h); rotate: var(--t, 0deg); transform-origin: bottom left; border-radius: 2px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); }
  .shelf-art span:nth-child(2) { width: 22px; background: color-mix(in oklab, var(--accent) 30%, var(--surface-2)); }
  .empty h2 { font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 500; letter-spacing: -0.015em; }
  .empty p { color: var(--muted); font-size: var(--text-md); line-height: var(--leading-normal); }
  .empty .actions { display: flex; gap: var(--space-2); margin-top: var(--space-5); }
  .empty .hint { display: inline-flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-10); font-size: var(--text-xs); color: var(--faint); }

  @media (max-width: 1100px) {
    .top { flex-wrap: wrap; }
    .search { width: 220px; }
  }
</style>
