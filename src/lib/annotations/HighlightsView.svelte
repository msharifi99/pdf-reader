<!--
  Every highlight and note across the library (story 99), grouped by book with its cover,
  searchable through the core (`listAllAnnotations(query)`). Clicking opens the book at the passage.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { AnnotationWithBook, Book } from '../core/bindings';
  import { core } from '../core/core';
  import { Button, EmptyState, SearchField } from '../ui';
  import { reportError } from '../shell/errors.svelte';
  import BookCover from '../library/BookCover.svelte';
  import { openLibraryBook } from '../library/library.svelte';
  import { allHighlights } from './library.svelte';
  import { asColor, toAnn, whereLabel, type Ann } from './model';

  let q = $state('');
  let rows = $state.raw<AnnotationWithBook[]>([]);
  let loaded = $state(false);
  let books = $state.raw<Map<string, Book>>(new Map());
  let input: HTMLInputElement | undefined = $state();

  const groups = $derived.by(() => {
    const out: { bookId: string; title: string; author: string; items: Ann[] }[] = [];
    for (const r of rows) {
      if (r.annotation.type === 'bookmark') continue;
      const last = out.at(-1);
      const a = toAnn(r.annotation);
      if (last?.bookId === a.bookId) last.items.push(a);
      else out.push({ bookId: a.bookId, title: r.bookTitle, author: r.bookAuthor, items: [a] });
    }
    return out;
  });
  const total = $derived(groups.reduce((n, g) => n + g.items.length, 0));

  let seq = 0;
  $effect(() => {
    const text = q.trim();
    const mine = ++seq;
    const t = setTimeout(async () => {
      try {
        const r = await core.listAllAnnotations(text || null);
        if (mine !== seq) return;
        rows = r;
        loaded = true;
        const missing = [...new Set(r.map((x) => x.annotation.bookId))].filter((id) => !books.has(id));
        if (missing.length) {
          const got = await Promise.all(missing.map((id) => core.getBook(id).catch(() => null)));
          const m = new Map(books);
          for (const b of got) if (b) m.set(b.id, b);
          books = m;
        }
      } catch (err) {
        if (mine === seq) reportError(err, 'Couldn’t load your highlights.');
      }
    }, text ? 120 : 0);
    return () => clearTimeout(t);
  });

  onMount(() => input?.focus());

  async function open(a: Ann) {
    const b = books.get(a.bookId) ?? (await core.getBook(a.bookId).catch(() => undefined));
    if (!b) return;
    allHighlights.hide();
    await openLibraryBook(b, { locator: a.anchor.locator });
  }

  /** a bold run for each searched word inside the quote */
  function marks(text: string): { t: string; m: boolean }[] {
    const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!words.length) return [{ t: text, m: false }];
    return text.split(new RegExp(`(${words.join('|')})`, 'gi')).filter(Boolean).map((t) => ({ t, m: words.some((w) => new RegExp(`^${w}$`, 'i').test(t)) }));
  }
</script>

<div class="view" data-testid="highlights-view">
  <header class="top">
    <Button variant="ghost" icon="back" onclick={() => allHighlights.hide()}>Library</Button>
    <h1>Highlights</h1>
    <div class="search">
      <SearchField bind:value={q} bind:input label="Search highlights and notes" placeholder="Search highlights and notes" onescape={() => allHighlights.hide()} />
    </div>
  </header>
  {#if loaded}
    <p class="label">{q.trim() ? 'Matches' : 'All books'} <span class="count tabular">· {total}</span></p>
  {/if}

  {#if loaded && !groups.length}
    <div class="none">
      <EmptyState
        icon={q.trim() ? 'search' : 'highlight'}
        title={q.trim() ? 'No highlight or note matches' : 'No highlights yet'}
        description={q.trim() ? 'Try fewer or different words.' : 'Select text while reading and press 1–4 to highlight it. Everything you mark shows up here.'}
      />
    </div>
  {/if}

  {#each groups as g (g.bookId)}
    {@const b = books.get(g.bookId)}
    <section class="group" data-testid="highlights-book">
      <div class="cover"><BookCover title={g.title} author={g.author} src={b?.coverUrl} bare /></div>
      <div class="body">
        <h2 class="title">{g.title}{#if g.author}<span class="author">{g.author}</span>{/if}</h2>
        <ul>
          {#each g.items as a (a.id)}
            <li>
              <button type="button" class="hl" style:--c="var(--hl-{asColor(a.color)})" onclick={() => open(a)} data-testid="highlights-item">
                <span class="quote">{#each marks(a.anchor.quote.exact) as p, i (i)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
                {#if a.note}<span class="note">{#each marks(a.note) as p, i (i)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>{/if}
                <span class="where tabular">{whereLabel(a.anchor.locator)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/each}
</div>

<style>
  .view { max-width: 1040px; margin: 0 auto; padding: var(--space-10) var(--space-10) var(--space-16); }
  .top { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-10); min-height: 40px; }
  .top :global(button:first-child) { margin-left: calc(var(--space-3) * -1); }
  h1 { flex: 1; font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 500; letter-spacing: -0.015em; }
  .search { width: 320px; }
  .label {
    margin-bottom: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .count { font-weight: var(--weight-medium); opacity: 0.8; }
  .none { padding-top: var(--space-12); }
  .group { display: flex; gap: var(--space-6); padding: var(--space-6) 0; border-top: 1px solid var(--border-soft); content-visibility: auto; contain-intrinsic-size: auto 240px; }
  .cover { flex: none; width: 64px; padding-top: 4px; }
  .body { flex: 1; min-width: 0; }
  .title { font-family: var(--font-display); font-size: var(--text-lg); font-weight: 500; margin-bottom: var(--space-2); }
  .author { margin-left: var(--space-2); font-family: var(--font-ui); font-size: var(--text-xs); font-weight: 400; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .hl {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
    max-width: 72ch;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5);
    margin-left: calc(var(--space-5) * -1);
    border-radius: var(--radius-sm);
    text-align: left;
  }
  .hl::before {
    content: '';
    position: absolute;
    left: var(--space-2);
    top: var(--space-2-5);
    bottom: var(--space-2-5);
    width: 3px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--c), var(--text) 30%);
  }
  .hl:hover { background: var(--hover); }
  .hl:focus-visible { outline-offset: -2px; }
  .quote { font-family: var(--font-serif); font-size: var(--text-md); line-height: 1.55; color: var(--text); }
  .note { font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--text); white-space: pre-wrap; padding-left: var(--space-3); border-left: 1px solid var(--border); }
  .where { font-size: var(--text-xs); color: var(--muted); }
  mark { background: none; color: inherit; font-weight: var(--weight-semibold); text-decoration: underline; text-decoration-color: var(--accent); text-underline-offset: 3px; }
  @media (forced-colors: active) {
    .hl::before { forced-color-adjust: none; background: CanvasText; }
  }
</style>
