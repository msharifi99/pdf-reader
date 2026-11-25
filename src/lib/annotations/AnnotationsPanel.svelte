<!--
  Annotations panel (A; stories 92–93): every highlight, note and bookmark of the book in reading
  order, grouped by chapter, filterable by type and colour, searchable. Quote text is set in the
  reading font, notes in the UI font. Up/Down move between entries, Enter jumps, N edits the note,
  1–4 recolour, Delete removes.
-->
<script lang="ts">
  import { commands, keyState } from '../commands';
  import { EmptyState, Icon, IconButton, SearchField } from '../ui';
  import { readerApi } from '../reader/slots.svelte';
  import type { Annotator } from './controller.svelte';
  import { COLOR_LABEL, highlightColors, passage, type Ann, type HighlightColor } from './model';
  import NoteEditor from './NoteEditor.svelte';

  let { ctl }: { ctl: Annotator } = $props();

  type Kind = 'all' | 'highlight' | 'note' | 'bookmark';
  let kind = $state<Kind>('all');
  let colors = $state<HighlightColor[]>([]);
  let q = $state('');
  let list: HTMLElement | undefined = $state();

  const all = $derived(ctl.store.items);
  const counts = $derived({
    all: all.length,
    highlight: all.filter((a) => a.type === 'highlight').length,
    note: all.filter((a) => a.type === 'note').length,
    bookmark: all.filter((a) => a.type === 'bookmark').length,
  });
  const shown = $derived.by(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((a) => {
      if (kind !== 'all' && a.type !== kind) return false;
      if (colors.length && (a.type === 'bookmark' || !colors.includes(a.color as HighlightColor))) return false;
      if (!words.length) return true;
      const hay = `${passage(a)} ${a.note ?? ''} ${a.label ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  });
  const groups = $derived.by(() => {
    const out: { chapter: string; items: Ann[] }[] = [];
    for (const a of shown) {
      const ch = ctl.chapter(a.anchor.locator);
      const last = out.at(-1);
      if (last && last.chapter === ch) last.items.push(a);
      else out.push({ chapter: ch, items: [a] });
    }
    return out;
  });

  const KINDS: { id: Kind; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'highlight', label: 'Highlights' },
    { id: 'note', label: 'Notes' },
    { id: 'bookmark', label: 'Bookmarks' },
  ];
  const toggleColor = (c: HighlightColor) => (colors = colors.includes(c) ? colors.filter((x) => x !== c) : [...colors, c]);
  const filtered = $derived(kind !== 'all' || colors.length > 0 || q.trim() !== '');

  function entries(): HTMLElement[] {
    return [...(list?.querySelectorAll<HTMLElement>('.entry') ?? [])];
  }
  function onkeydown(e: KeyboardEvent, a: Ann) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const els = entries();
    const i = els.indexOf(e.currentTarget as HTMLElement);
    let handled = true;
    if (e.key === 'ArrowDown') els[Math.min(els.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') els[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') els[0]?.focus();
    else if (e.key === 'End') els.at(-1)?.focus();
    else if (e.key === 'n' || e.key === 'N' || e.key === 'F2') ctl.editing = a.id;
    else if (e.key === 'Delete') {
      (els[i + 1] ?? els[i - 1])?.focus();
      ctl.remove(a.id);
    } else if (a.type !== 'bookmark' && ['1', '2', '3', '4'].includes(e.key)) ctl.recolor(a.id, highlightColors[Number(e.key) - 1]!);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  const saveNote = (a: Ann, t: string) => {
    if (a.type === 'bookmark') ctl.store.update(a.id, { label: t.replace(/\s+/g, ' ').trim() || null });
    else ctl.setNote(a.id, t);
    ctl.editing = null;
  };
</script>

<div class="panel" data-testid="annotations-panel">
  <header class="head">
    <h2>Annotations{#if all.length}<span class="count tabular">&nbsp;· {all.length}</span>{/if}</h2>
    <IconButton icon="export" label="Export to Markdown" size="sm" onclick={() => commands.execute('annotate.exportMarkdown')} disabled={!all.length} data-testid="annotations-export" />
    <IconButton icon="close" label="Close" size="sm" shortcut={keyState.shortcut('annotate.togglePanel')} onclick={() => readerApi.closePanel()} />
  </header>

  {#if all.length}
    <div class="tools">
      <SearchField bind:value={q} label="Search annotations" placeholder="Search highlights and notes" />
      <div class="filters">
        <div class="kinds" role="toolbar" aria-label="Show">
          {#each KINDS.filter((k) => k.id === 'all' || counts[k.id] || kind === k.id) as k (k.id)}
            <button type="button" class="chip" aria-pressed={kind === k.id} onclick={() => (kind = kind === k.id ? 'all' : k.id)} data-kind={k.id}>
              {k.label}{#if k.id !== 'all'}<span class="n tabular">{counts[k.id]}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="colors" role="toolbar" aria-label="Colour">
          {#each highlightColors as c (c)}
            <button type="button" class="cdot" style:--c="var(--hl-{c})" aria-pressed={colors.includes(c)} aria-label="Only {COLOR_LABEL[c].toLowerCase()}" title={COLOR_LABEL[c]} onclick={() => toggleColor(c)} data-color={c}></button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  <div class="list" bind:this={list} data-keynav>
    {#if !all.length}
      <div class="empty">
        <EmptyState icon="highlight" title="No highlights yet" description="Select text and press 1–4 to highlight it, N to add a note, or Ctrl+B to bookmark this page." />
      </div>
    {:else if !shown.length}
      <p class="none">Nothing matches{#if filtered}. <button type="button" class="link" onclick={() => ((kind = 'all'), (colors = []), (q = ''))}>Show everything</button>{/if}</p>
    {/if}
    {#each groups as g, gi (gi + g.chapter)}
      <section class="group">
        {#if g.chapter}<h3 class="chapter">{g.chapter}</h3>{/if}
        <ul>
          {#each g.items as a (a.id)}
            {@const orphan = ctl.store.orphans.has(a.id)}
            <li class="item" class:orphan data-testid="annotation-item" data-type={a.type} data-color={a.color} style:--c="var(--hl-{a.color ?? 'yellow'})">
              <button type="button" class="entry" tabindex={a === shown[0] ? 0 : -1} onclick={() => ctl.jump(a)} onkeydown={(e) => onkeydown(e, a)} aria-label="{a.type === 'bookmark' ? 'Bookmark' : a.type === 'note' ? 'Note' : 'Highlight'}, {ctl.where(a.anchor.locator)}: {a.label ?? passage(a)}">
                {#if a.type === 'bookmark'}
                  <span class="bm"><Icon name="bookmark-filled" size={16} /><span class="bm-name">{a.label ?? 'Bookmark'}</span></span>
                  {#if passage(a)}<span class="excerpt">{passage(a)}</span>{/if}
                {:else}
                  <span class="quote">{passage(a) || '…'}</span>
                {/if}
              </button>
              {#if ctl.editing === a.id}
                <div class="edit">
                  <NoteEditor
                    value={(a.type === 'bookmark' ? a.label : a.note) ?? ''}
                    label={a.type === 'bookmark' ? 'Bookmark name' : 'Note'}
                    placeholder={a.type === 'bookmark' ? 'Name this bookmark…' : 'Write a note…'}
                    onsave={(t) => saveNote(a, t)}
                    oncancel={() => (ctl.editing = null)}
                  />
                </div>
              {:else if a.note}
                <p class="note">{a.note}</p>
              {/if}
              <div class="meta">
                <span class="where tabular">{ctl.where(a.anchor.locator)}</span>
                {#if orphan}<span class="lost" title="The file changed and this passage could not be found again. It is kept here."><Icon name="warning" size={16} />Passage not found</span>{/if}
                <span class="actions">
                  {#if a.type !== 'bookmark'}
                    {#each highlightColors as c (c)}
                      <button type="button" class="mini" style:--c="var(--hl-{c})" aria-label="Make {COLOR_LABEL[c].toLowerCase()}" aria-pressed={a.color === c} onclick={() => ctl.recolor(a.id, c)} tabindex="-1"></button>
                    {/each}
                  {/if}
                  <IconButton icon="edit" label={a.type === 'bookmark' ? 'Rename' : a.note ? 'Edit note' : 'Add note'} size="sm" onclick={() => (ctl.editing = a.id)} tabindex={-1} />
                  <IconButton icon="trash" label="Delete" size="sm" onclick={() => ctl.remove(a.id)} tabindex={-1} />
                </span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</div>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; }
  .head { display: flex; align-items: center; gap: 2px; padding: var(--space-4) var(--space-3) var(--space-2) var(--space-6); }
  h2 { flex: 1; font-size: var(--text-lg); font-weight: var(--weight-semibold); }
  .count { color: var(--muted); font-weight: var(--weight-regular); }
  .tools { display: flex; flex-direction: column; gap: var(--space-2-5); padding: var(--space-2) var(--space-6) var(--space-3); border-bottom: 1px solid var(--border-soft); }
  .filters { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
  .kinds { display: flex; flex-wrap: wrap; gap: 2px; margin-left: calc(var(--space-2) * -1); }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: 24px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .chip:hover:not(:disabled) { background: var(--hover); color: var(--text); }
  .chip[aria-pressed='true'] { background: var(--accent-soft); color: var(--text); }
  .chip:disabled { opacity: 0.45; }
  .chip .n { font-size: 10px; opacity: 0.8; }
  .colors { display: flex; gap: 2px; }
  .cdot { display: grid; place-items: center; width: 22px; height: 22px; border-radius: var(--radius-full); }
  .cdot::before, .mini::before {
    content: '';
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--c), var(--text) 18%);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 18%, transparent);
  }
  .cdot:hover { background: var(--hover); }
  .cdot[aria-pressed='true']::before { box-shadow: 0 0 0 2px var(--surface), 0 0 0 3.5px var(--text); }

  .list { flex: 1; overflow: auto; padding: var(--space-2) var(--space-3) var(--space-12); }
  .empty { padding: var(--space-12) var(--space-3); }
  .none { padding: var(--space-6) var(--space-3); color: var(--muted); font-size: var(--text-sm); }
  .link { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
  .group + .group { margin-top: var(--space-4); }
  .chapter {
    position: sticky;
    top: calc(var(--space-2) * -1);
    z-index: 1;
    padding: var(--space-3) var(--space-3) var(--space-1-5);
    background: var(--surface);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  ul { list-style: none; margin: 0; padding: 0; }
  .item { position: relative; padding: var(--space-2) var(--space-3) var(--space-2) var(--space-5); border-radius: var(--radius-sm); }
  .item::before {
    content: '';
    position: absolute;
    left: var(--space-2);
    top: var(--space-3);
    bottom: var(--space-3);
    width: 3px;
    border-radius: var(--radius-full);
    background: color-mix(in oklab, var(--c), var(--text) 30%);
  }
  .item[data-type='bookmark']::before { display: none; }
  .item:hover, .item:focus-within { background: var(--hover); }
  .entry { display: block; width: 100%; text-align: left; border-radius: var(--radius-xs); }
  .entry:focus-visible { outline-offset: 2px; }
  .quote {
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-family: var(--font-serif);
    font-size: var(--text-md);
    line-height: 1.55;
    color: var(--text);
  }
  .bm { display: flex; align-items: center; gap: var(--space-1-5); color: var(--accent); }
  .bm-name { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
  .excerpt {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin-top: var(--space-1);
    font-family: var(--font-serif);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted);
  }
  .note { margin-top: var(--space-1-5); font-size: var(--text-sm); line-height: var(--leading-normal); color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
  .edit { margin-top: var(--space-2); }
  .meta { display: flex; align-items: center; gap: var(--space-2); min-height: 28px; margin-top: var(--space-1); font-size: var(--text-xs); color: var(--muted); }
  .lost { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--muted); }
  .actions { display: flex; align-items: center; gap: 0; margin-left: auto; opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); }
  .item:hover .actions, .item:focus-within .actions { opacity: 1; }
  .mini { display: grid; place-items: center; width: 20px; height: 28px; }
  .mini[aria-pressed='true']::before { box-shadow: 0 0 0 1.5px var(--surface), 0 0 0 3px var(--muted); }
  .orphan .quote { color: var(--muted); }
  @media (forced-colors: active) {
    .cdot::before, .mini::before, .item::before { forced-color-adjust: none; border: 1px solid CanvasText; }
  }
</style>
