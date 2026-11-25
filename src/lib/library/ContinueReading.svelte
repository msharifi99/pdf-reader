<!-- The "Continue reading" row: up to three recent books, larger, with progress and time left. -->
<script lang="ts">
  import type { Book } from '../core/bindings';
  import { ContextMenu, type MenuItem } from '../ui';
  import BookCover from './BookCover.svelte';
  import { ago, formatLeft, minutesLeft, percent } from './format';
  import { lib } from './library.svelte';

  interface Props {
    books: Book[];
    menu: (b: Book) => MenuItem[];
    onopen: (b: Book, e: MouseEvent | KeyboardEvent) => void;
    /** Down arrow leaves the row for the shelf */
    ondown: () => void;
  }
  let { books, menu, onopen, ondown }: Props = $props();
  let row: HTMLElement | undefined = $state();

  function onkeydown(e: KeyboardEvent) {
    const tiles = [...(row?.querySelectorAll<HTMLElement>('button[data-book-id]') ?? [])];
    const i = tiles.indexOf(document.activeElement as HTMLElement);
    if (i < 0 || e.ctrlKey || e.altKey) return;
    const to = { ArrowLeft: i - 1, ArrowRight: i + 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      tiles[Math.max(0, Math.min(tiles.length - 1, to))]?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      ondown();
    }
  }
  const menuFor = (t: EventTarget | null) => {
    const id = (t as HTMLElement | null)?.closest?.('[data-book-id]')?.getAttribute('data-book-id');
    const b = books.find((x) => x.id === id);
    return b ? menu(b) : [];
  };
</script>

<section class="continue" aria-labelledby="continue-h" data-continue>
  <h2 id="continue-h" class="label">Continue reading</h2>
  <ContextMenu items={menuFor} label="Book">
    <!-- svelte-ignore a11y_no_static_element_interactions (arrow keys between the tiles; each tile is a button) -->
    <div class="row" bind:this={row} {onkeydown} data-testid="continue-reading">
      {#each books as b, i (b.id)}
        {@const left = formatLeft(minutesLeft(b, lib.speed))}
        <button
          type="button"
          class="tile"
          class:missing={!b.available}
          data-book-id={b.id}
          aria-label="Resume {b.title}{b.author ? `, ${b.author}` : ''}, {percent(b.progress)} read{left ? `, ${left}` : ''}"
          onclick={(e) => onopen(b, e)}
          onfocus={() => (lib.selId = b.id)}
        >
          <span class="art"><BookCover title={b.title} author={b.author} src={b.coverUrl} missing={!b.available} /></span>
          <span class="info">
            <span class="title">{b.title}</span>
            {#if b.author}<span class="author">{b.author}</span>{/if}
            <span class="progress">
              <span class="bar"><span style:width="{Math.max(2, (b.progress ?? 0) * 100)}%"></span></span>
              <span class="pct tabular">{percent(b.progress)}</span>
            </span>
            <span class="meta tabular">
              {#if !b.available}Unavailable{:else}{left ?? `Opened ${ago(b.lastOpenedAt).toLowerCase()}`}{/if}
            </span>
            {#if i === 0 && b.available}<span class="resume" aria-hidden="true">Resume</span>{/if}
          </span>
        </button>
      {/each}
    </div>
  </ContextMenu>
</section>

<style>
  .continue { margin-bottom: var(--space-12); }
  .label {
    margin-bottom: var(--space-4);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); }
  .tile {
    display: flex;
    gap: var(--space-5);
    align-items: stretch;
    min-width: 0;
    padding: var(--space-3);
    margin: calc(var(--space-3) * -1);
    border-radius: var(--radius-lg);
    text-align: left;
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .tile:hover { background: var(--hover); }
  .tile:focus-visible { outline: var(--focus-ring); outline-offset: 0; }
  .art { flex: none; width: 96px; transition: translate var(--dur-slow) var(--ease-out), scale var(--dur-instant) var(--ease-out); }
  .tile:hover .art { translate: 0 -2px; }
  .tile:active .art { scale: 0.98; }
  .info { display: flex; flex-direction: column; min-width: 0; flex: 1; padding: var(--space-1) 0; }
  .title {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: -0.01em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .author { margin-top: var(--space-1); font-size: var(--text-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .progress { display: flex; align-items: center; gap: var(--space-2-5); margin-top: auto; }
  .bar { flex: 1; max-width: 180px; height: 3px; border-radius: 2px; background: color-mix(in oklab, var(--text) 10%, transparent); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .pct { font-size: var(--text-xs); color: var(--muted); }
  .meta { margin-top: var(--space-1-5); font-size: var(--text-xs); color: var(--muted); }
  .resume {
    align-self: flex-start;
    margin-top: var(--space-3);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--text);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .missing .title { color: var(--muted); }
  @media (max-width: 1000px) {
    .row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tile:nth-child(3) { display: none; }
  }
</style>
