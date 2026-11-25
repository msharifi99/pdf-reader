<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    author?: string;
    /** cover image URL; a typographic cover is generated when absent */
    cover?: string;
    /** 0..1 reading progress; omit for unread */
    progress?: number;
    /** small corner tag, e.g. "PDF", "CBZ" */
    format?: string;
    selected?: boolean;
    /** dim + warning badge: file not found */
    missing?: boolean;
    /** trailing caption, e.g. "12 min left" */
    meta?: string;
    onclick?: (e: MouseEvent) => void;
    oncontextmenu?: (e: MouseEvent) => void;
    /** overlay controls revealed on hover/focus (e.g. a "more" IconButton) */
    actions?: Snippet;
  }
  let { title, author, cover, progress, format, selected = false, missing = false, meta, onclick, oncontextmenu, actions }: Props = $props();

  // Stable hue from the title, so generated covers are varied but never random between runs.
  const hue = $derived([...title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  const done = $derived(progress !== undefined && progress >= 0.995);
  let broken = $state(false);
</script>

<div class="card" class:selected class:missing>
  <button
    type="button"
    class="hit"
    aria-label="{title}{author ? `, ${author}` : ''}{progress !== undefined ? `, ${Math.round(progress * 100)}% read` : ''}{missing ? ', file missing' : ''}"
    aria-pressed={selected || undefined}
    {onclick}
    {oncontextmenu}
  >
    <span class="cover" style:--h={hue}>
      {#if cover && !broken}
        <img src={cover} alt="" loading="lazy" decoding="async" draggable="false" onerror={() => (broken = true)} />
      {:else}
        <span class="gen" aria-hidden="true">
          <span class="gen-title">{title}</span>
          {#if author}<span class="gen-author">{author}</span>{/if}
        </span>
      {/if}
      <span class="sheen" aria-hidden="true"></span>
      {#if format}<span class="tag">{format}</span>{/if}
      {#if done}
        <span class="badge" aria-hidden="true"><Icon name="check" size={14} /></span>
      {:else if missing}
        <span class="badge warn" aria-hidden="true"><Icon name="warning" size={14} /></span>
      {/if}
      {#if progress !== undefined && !done}
        <span class="progress" aria-hidden="true"><span style:width="{Math.max(2, progress * 100)}%"></span></span>
      {/if}
    </span>
    <span class="caption">
      <span class="title">{title}</span>
      {#if author || meta}
        <span class="sub">
          {#if author}<span class="author">{author}</span>{/if}
          {#if meta}<span class="meta tabular">{meta}</span>{/if}
        </span>
      {/if}
    </span>
  </button>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .card { position: relative; min-width: 0; }
  .hit {
    display: flex;
    flex-direction: column;
    gap: var(--space-2-5);
    width: 100%;
    text-align: left;
    border-radius: var(--radius-md);
  }
  .hit:focus-visible { outline: none; }
  .cover {
    position: relative;
    display: block;
    aspect-ratio: 2 / 3;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-2);
    box-shadow: var(--shadow-cover), 0 0 0 1px color-mix(in oklab, var(--text) 6%, transparent);
    transition: translate var(--dur-slow) var(--ease-out), box-shadow var(--dur-slow) var(--ease-out);
  }
  .hit:hover .cover { translate: 0 -3px; box-shadow: var(--shadow-cover-hover), 0 0 0 1px color-mix(in oklab, var(--text) 8%, transparent); }
  .hit:active .cover { translate: 0 -1px; transition-duration: var(--dur-instant); }
  .hit:focus-visible .cover { outline: var(--focus-ring); outline-offset: 3px; }
  .selected .cover { outline: 2px solid var(--accent); outline-offset: 3px; }
  .missing .cover { opacity: 0.5; filter: grayscale(1); }
  img { width: 100%; height: 100%; object-fit: cover; }

  /* Generated typographic cover: tinted to sit inside the current theme */
  .gen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 24% 12% 12%;
    background:
      linear-gradient(160deg, color-mix(in oklab, var(--text) 6%, transparent), transparent 60%),
      color-mix(in oklch, oklch(0.5 0.07 var(--h)) 55%, var(--bg));
    color: color-mix(in oklab, var(--text) 92%, transparent);
  }
  :global(:root[data-theme-kind='light']) .gen {
    background:
      linear-gradient(160deg, color-mix(in oklab, var(--bg) 30%, transparent), transparent 60%),
      color-mix(in oklch, oklch(0.6 0.075 var(--h)) 58%, var(--bg));
  }
  .gen-title {
    font-family: var(--font-display);
    font-size: clamp(13px, 1.1vw + 6px, 18px);
    font-weight: 500;
    line-height: 1.15;
    letter-spacing: -0.01em;
    text-wrap: balance;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .gen-author {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    opacity: 0.75;
  }
  /* binding shadow on the spine edge: reads as a book, not a tile */
  .sheen {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      90deg,
      color-mix(in oklab, var(--shadow) 22%, transparent) 0,
      transparent 4%,
      color-mix(in oklab, var(--bg) 10%, transparent) 5%,
      transparent 9%
    );
  }
  .tag {
    position: absolute;
    top: 8px;
    left: 10px;
    padding: 2px 5px;
    border-radius: var(--radius-xs);
    background: color-mix(in oklab, var(--bg) 78%, transparent);
    backdrop-filter: blur(6px);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    color: var(--muted);
  }
  .badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: var(--shadow-1);
  }
  .badge.warn { background: var(--surface); color: var(--danger); }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: color-mix(in oklab, var(--bg) 55%, transparent);
  }
  .progress span { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; }
  .caption { display: flex; flex-direction: column; gap: 2px; padding: 0 2px; min-width: 0; }
  .title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: var(--leading-snug);
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .sub { display: flex; gap: var(--space-2); justify-content: space-between; font-size: var(--text-xs); color: var(--muted); min-width: 0; }
  .author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { flex: none; }
  .actions {
    position: absolute;
    top: 6px;
    right: 6px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .card:hover .actions,
  .card:focus-within .actions { opacity: 1; }
  .actions :global(button) { background: color-mix(in oklab, var(--bg) 80%, transparent); backdrop-filter: blur(8px); }
</style>
