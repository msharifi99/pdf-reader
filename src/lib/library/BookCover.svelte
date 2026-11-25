<!--
  BookCover: a book's cover art at any size. The image when there is one, otherwise a generated
  typographic cover (title and author in Literata on a theme-harmonious tone, stable per title).
  Reusable outside the library (the reader's "about this book", the palette, ...):

    <BookCover title={b.title} author={b.author} src={b.coverUrl} progress={b.progress} />

  Size it with the parent's width; it keeps 2:3 and scales its type with container units.
-->
<script lang="ts">
  import { Icon } from '../ui';
  import { coverHue } from './format';

  interface Props {
    title: string;
    author?: string;
    src?: string | null;
    /** small corner tag, e.g. "PDF" */
    format?: string;
    /** 0..1; draws the hairline. Omit for unread. */
    progress?: number | null;
    finished?: boolean;
    missing?: boolean;
    /** drop the text on tiny covers (list rows, palette) */
    bare?: boolean;
  }
  let { title, author, src, format, progress, finished = false, missing = false, bare = false }: Props = $props();

  const hue = $derived(coverHue(title));
  // per-src flags, so a new src starts fresh without an effect racing the load event
  let loadedSrc = $state<string | null>(null);
  let brokenSrc = $state<string | null>(null);
  const loaded = $derived(!!src && loadedSrc === src);
  const broken = $derived(!!src && brokenSrc === src);
</script>

<span class="cover" class:missing class:bare style:--h={hue}>
  {#if !src || broken || !loaded}
    <span class="gen" aria-hidden="true">
      {#if !bare}
        <span class="rule"></span>
        <span class="t">{title}</span>
        {#if author}<span class="a">{author}</span>{/if}
      {/if}
    </span>
  {/if}
  {#if src && !broken}
    <img {src} alt="" loading="lazy" decoding="async" draggable="false" class:loaded onload={() => (loadedSrc = src ?? null)} onerror={() => (brokenSrc = src ?? null)} />
  {/if}
  {#if !bare}
    <span class="spine" aria-hidden="true"></span>
    {#if format}<span class="tag">{format}</span>{/if}
    {#if missing}
      <span class="badge warn" aria-hidden="true"><Icon name="warning" size={14} /></span>
    {:else if finished}
      <span class="badge" aria-hidden="true"><Icon name="check" size={14} /></span>
    {/if}
  {/if}
  {#if progress && !finished}
    <span class="progress" aria-hidden="true"><span style:width="{Math.max(3, progress * 100)}%"></span></span>
  {/if}
</span>

<style>
  .cover {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface-2);
    box-shadow: var(--shadow-cover), 0 0 0 1px color-mix(in oklab, var(--text) 6%, transparent);
    container-type: inline-size;
  }
  .bare { border-radius: 2px; box-shadow: 0 0 0 1px var(--border-soft); }
  .missing img,
  .missing .gen { opacity: 0.45; filter: grayscale(1); }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
  }
  img.loaded { opacity: 1; }

  .gen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 6cqi;
    padding: 20cqi 11cqi 11cqi;
    background:
      linear-gradient(165deg, color-mix(in oklab, var(--text) 7%, transparent), transparent 55%),
      color-mix(in oklch, oklch(0.5 0.065 var(--h)) 52%, var(--bg));
    color: color-mix(in oklab, var(--text) 92%, transparent);
  }
  :global(:root[data-theme-kind='light']) .gen {
    background:
      linear-gradient(165deg, color-mix(in oklab, var(--bg) 35%, transparent), transparent 55%),
      color-mix(in oklch, oklch(0.62 0.07 var(--h)) 52%, var(--bg));
    /* light themes: ink of the cover's own hue, not the theme's (often soft) body text */
    color: oklch(0.3 0.045 var(--h));
  }
  .rule { width: 18cqi; border-top: max(1px, 0.9cqi) solid currentColor; opacity: 0.55; }
  .t {
    font-family: var(--font-display);
    font-size: clamp(8px, 11cqi, 24px);
    hyphens: auto;
    overflow-wrap: break-word;
    font-weight: 500;
    line-height: 1.12;
    letter-spacing: -0.01em;
    text-wrap: balance;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .a {
    margin-top: auto;
    font-size: clamp(7px, 6cqi, 12px);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* binding shadow on the spine edge: reads as a book, not a tile */
  .spine {
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
  .badge.warn { background: var(--surface); color: var(--muted); box-shadow: 0 0 0 1px var(--border); }
  .progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: color-mix(in oklab, var(--bg) 55%, transparent);
  }
  .bare .progress { height: 2px; }
  .progress span { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; }
  @media (forced-colors: active) {
    .cover { border: 1px solid CanvasText; }
  }
</style>
