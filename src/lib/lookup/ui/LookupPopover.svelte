<script lang="ts">
  // Word lookup popover (stories 84, 85). Anchored under the selection (above it when there is no room),
  // never over it. The dictionary renders instantly offline; Wikipedia is fetched only when its tab is
  // clicked, and only the term is sent. Esc closes (shell overlay stack), Tab / arrows move inside.
  import { lookupPopover } from '..';
  import type { DictResult } from '../../core/bindings';
  import { isTauri } from '../../core/core';
  import { registerOverlay } from '../../shell/overlays.svelte';
  import { Icon, IconButton, Skeleton, Tabs } from '../../ui';

  const W = 380;
  const GAP = 10;
  const TOP = 48; // keep clear of the title bar
  const EDGE = 12;

  let panel: HTMLElement | undefined = $state();
  let h = $state(0);
  let vw = $state(typeof innerWidth === 'number' ? innerWidth : 1280);
  let vh = $state(typeof innerHeight === 'number' ? innerHeight : 800);
  let tab = $state<'dict' | 'wiki'>('dict');
  let returnTo: HTMLElement | null = null;
  let unregister: (() => void) | null = null;

  const r = $derived(lookupPopover.result);
  const dict = $derived(lookupPopover.dictionary);
  const wiki = $derived(lookupPopover.wiki);
  const term = $derived(r?.query ?? '');

  // Wikipedia starting (from the tab or the "Look up on Wikipedia" command) shows its tab; a new lookup resets.
  $effect(() => {
    tab = wiki.status === 'idle' ? 'dict' : 'wiki';
  });

  const pos = $derived.by(() => {
    const a = lookupPopover.anchor;
    const left = (x: number) => Math.round(Math.max(EDGE, Math.min(vw - W - EDGE, x)));
    if (!a) return { left: left((vw - W) / 2), top: Math.round(vh * 0.16), max: Math.round(vh * 0.66), side: 'below' };
    const below = vh - (a.y + a.height) - GAP - EDGE;
    const above = a.y - GAP - TOP;
    const side = h <= below || below >= above ? 'below' : 'above';
    const max = Math.max(160, side === 'below' ? below : above);
    const top = side === 'below' ? a.y + a.height + GAP : a.y - GAP - Math.min(h, max);
    return { left: left(a.x + a.width / 2 - W / 2), top: Math.round(top), max: Math.round(max), side };
  });

  $effect(() => {
    if (!panel) return;
    const isOpen = panel.matches(':popover-open');
    if (lookupPopover.open && !isOpen) panel.showPopover();
    if (!lookupPopover.open && isOpen) panel.hidePopover();
  });
  $effect(() => () => unregister?.());

  function ontoggle(e: ToggleEvent) {
    if (e.newState === 'open') {
      returnTo = document.activeElement as HTMLElement | null;
      unregister ??= registerOverlay('lookup', () => lookupPopover.close());
      panel?.focus({ preventScroll: true });
      return;
    }
    unregister?.();
    unregister = null;
    const inside = panel?.contains(document.activeElement) || document.activeElement === document.body;
    if (lookupPopover.open) lookupPopover.close();
    if (inside) returnTo?.focus?.({ preventScroll: true });
  }

  /** Look a synonym / suggestion up in place, anchored to the same selection. */
  function again(word: string) {
    void lookupPopover.show(word, { lang: lookupPopover.lang, rect: lookupPopover.anchor });
    panel?.focus({ preventScroll: true });
  }

  function onTab(v: 'dict' | 'wiki') {
    if (v === 'wiki' && wiki.status === 'idle') void lookupPopover.askWikipedia();
  }

  /** Only real Wikipedia pages open, in the default browser. */
  function openWiki(url: string) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    if (u.protocol !== 'https:' || !/(^|\.)wikipedia\.org$/.test(u.hostname)) return;
    if (isTauri()) void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(u.href)).catch((e) => console.warn('[lookup] open', e));
    else window.open(u.href, '_blank', 'noopener,noreferrer');
  }

  const posLabel: Record<string, string> = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };
  const entriesOf = (d: DictResult) => d.entries.map((e) => ({ ...e, pos: posLabel[e.pos] ?? e.pos }));
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

<div
  bind:this={panel}
  bind:clientHeight={h}
  popover="auto"
  class="lookup"
  role="dialog"
  aria-label={term ? `Look up “${term}”` : 'Look up'}
  tabindex="-1"
  data-testid="lookup-popover"
  data-side={pos.side}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:max-height="{pos.max}px"
  style:width="{W}px"
  {ontoggle}
>
  {#if lookupPopover.status === 'loading' && !r}
    <div class="pad"><Skeleton width="40%" height="18px" /><div class="gap"></div><Skeleton lines={3} height="10px" /></div>
  {:else if r}
    <div class="close"><IconButton icon="close" label="Close" size="sm" shortcut="Esc" tooltipPlacement="left" onclick={() => lookupPopover.close()} /></div>
    {#if r.wikipedia}
      <Tabs
        label="Look up in"
        tabs={[
          { id: 'dict', label: 'Dictionary' },
          { id: 'wiki', label: 'Wikipedia' },
        ]}
        bind:value={tab}
        onchange={onTab}
      >
        {#snippet children(v)}
          {#if v === 'dict'}{@render dictionary()}{:else}{@render wikipedia()}{/if}
        {/snippet}
      </Tabs>
    {:else}
      <div class="pad">
        <p class="calm">That’s a bit long to look up. Select a word or a short phrase.</p>
      </div>
    {/if}
  {/if}
</div>

{#snippet dictionary()}
  <div class="body" data-testid="lookup-dictionary">
    {#if dict}
      <header class="head">
        <h2 class="word">{dict.lemma}</h2>
        {#if dict.form && dict.form.toLowerCase() !== dict.lemma.toLowerCase()}<span class="form">from “{dict.form}”</span>{/if}
      </header>
      {#each entriesOf(dict) as e, ei (ei)}
        <section class="entry">
          <div class="pos">
            {e.pos}{#if e.lemma.toLowerCase() !== dict.lemma.toLowerCase()}<span class="alt"> · {e.lemma}</span>{/if}
          </div>
          <ol class="defs">
            {#each e.definitions as d, di (di)}
              <li>
                <span class="n tabular" aria-hidden="true">{di + 1}</span>
                <div>
                  <p class="def">{d.text}</p>
                  {#each d.examples.slice(0, 2) as ex, xi (xi)}<p class="ex">“{ex}”</p>{/each}
                </div>
              </li>
            {/each}
          </ol>
          {#if e.synonyms.length}
            <div class="chips" role="group" aria-label="Synonyms">
              {#each e.synonyms.slice(0, 8) as s (s)}
                <button class="chip" onclick={() => again(s)} title="Look up “{s}”">{s}</button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    {:else if r?.dictionaryError}
      <div class="state">
        <Icon name="dictionary" size={20} />
        <p class="calm">The dictionary isn’t available right now.</p>
        <p class="sub">{r.dictionaryError}</p>
      </div>
    {:else}
      <div class="state" data-testid="lookup-not-found">
        <Icon name="dictionary" size={20} />
        <p class="calm">No dictionary entry for “{term}”.</p>
        {#if r?.suggestions.length}
          <p class="sub">Did you mean</p>
          <div class="chips center">
            {#each r.suggestions as s (s)}<button class="chip" onclick={() => again(s)}>{s}</button>{/each}
          </div>
        {:else if r?.wikipedia}
          <p class="sub">Try the Wikipedia tab for names and places.</p>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet wikipedia()}
  <div class="body" data-testid="lookup-wikipedia" data-status={wiki.status}>
    {#if wiki.status === 'loading' || wiki.status === 'idle'}
      <div class="loading" role="status" aria-label="Asking Wikipedia">
        <Skeleton width="55%" height="16px" />
        <Skeleton width="35%" height="10px" />
        <div class="gap"></div>
        <Skeleton lines={4} height="10px" />
      </div>
    {:else if wiki.status === 'error'}
      <div class="state" data-testid="lookup-wiki-error" data-code={wiki.code}>
        <Icon name={wiki.code === 'offline' ? 'globe' : 'info'} size={20} />
        <p class="calm">{{ offline: 'No connection', timeout: 'Wikipedia is taking too long', 'not-found': 'Nothing on Wikipedia' }[wiki.code as string] ?? 'Wikipedia didn’t answer'}</p>
        <p class="sub">{wiki.message}</p>
        {#if wiki.code !== 'not-found'}
          <button class="link-btn" onclick={() => lookupPopover.askWikipedia(wiki.term)}>Try again</button>
        {/if}
      </div>
    {:else if wiki.result.kind === 'summary'}
      {@const s = wiki.result.summary}
      <article class="wiki" data-testid="lookup-wiki-summary">
        <h2 class="title">{s.title}</h2>
        {#if s.description}<p class="desc">{s.description}</p>{/if}
        <p class="extract">{s.extract}</p>
        <footer class="foot">
          <button class="link-btn" onclick={() => openWiki(s.url)} data-testid="lookup-wiki-open">
            Read on Wikipedia <Icon name="link" size={16} />
          </button>
          <span class="credit">Wikipedia · CC BY-SA</span>
        </footer>
      </article>
    {:else}
      {@const c = wiki.result}
      <div class="choices" data-testid="lookup-wiki-choices">
        <p class="lead">
          {#if c.reason === 'disambiguation'}“{c.title}” can mean several things:{:else}No page named “{c.title}”. Closest matches:{/if}
        </p>
        <ul>
          {#each c.choices as ch (ch.title)}
            <li>
              <button class="choice" onclick={() => lookupPopover.askWikipedia(ch.title)}>
                <span class="ct">{ch.title}</span>
                {#if ch.description}<span class="cd">{ch.description}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .lookup {
    position: fixed;
    inset: auto;
    margin: 0;
    z-index: var(--z-popover);
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--space-1) var(--space-4) var(--space-4);
    background: var(--flyout-bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-3);
    opacity: 0;
    translate: 0 4px;
    scale: 0.98;
    transition: opacity var(--dur-base) var(--ease-out), translate var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out), display var(--dur-base) allow-discrete, overlay var(--dur-base) allow-discrete;
  }
  .lookup[data-side='above'] { translate: 0 -4px; transform-origin: bottom; }
  .lookup[data-side='below'] { transform-origin: top; translate: 0 -4px; }
  .lookup:popover-open { opacity: 1; translate: 0 0; scale: 1; }
  @starting-style {
    .lookup:popover-open { opacity: 0; scale: 0.98; }
  }
  .lookup:focus-visible { outline: none; }
  /* the tab strip stays put while the definitions scroll */
  .lookup :global([role='tablist']) {
    position: sticky;
    top: calc(-1 * var(--space-1));
    z-index: 1;
    margin: 0 calc(-1 * var(--space-4));
    padding: var(--space-1) var(--space-3) 0;
    background: var(--flyout-bg);
  }
  .lookup :global([role='tabpanel']) { padding-top: var(--space-3); }
  .close { position: sticky; top: 0; z-index: 2; float: right; margin: 2px calc(-1 * var(--space-2)) 0 0; height: 0; }
  .pad { padding-top: var(--space-3); }
  .gap { height: var(--space-3); }

  .head { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-2); }
  .word {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    line-height: 1.2;
  }
  .form { font-size: var(--text-xs); color: var(--muted); }
  .entry + .entry { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border-soft); }
  .pos { font-family: var(--font-display); font-style: italic; font-size: var(--text-sm); color: var(--muted); margin-bottom: var(--space-1-5); }
  .alt { font-style: normal; font-family: var(--font-ui); font-size: var(--text-xs); }
  .defs { display: flex; flex-direction: column; gap: var(--space-2); list-style: none; padding: 0; margin: 0; }
  .defs li { display: grid; grid-template-columns: 18px 1fr; gap: var(--space-1); }
  .n { font-size: var(--text-xs); color: var(--muted); padding-top: 2px; }
  .def { font-size: var(--text-md); line-height: 1.45; color: var(--text); }
  .ex { margin-top: 2px; font-family: var(--font-display); font-style: italic; font-size: var(--text-sm); line-height: 1.45; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--space-1-5); margin-top: var(--space-3); padding-left: 19px; }
  .chips.center { justify-content: center; padding-left: 0; margin-top: var(--space-1); }
  .chip {
    height: 24px;
    padding: 0 var(--space-2-5);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    color: var(--muted);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .chip:hover { background: var(--hover); color: var(--text); }
  .chip:focus-visible, .choice:focus-visible, .link-btn:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }

  .state { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--space-1); padding: var(--space-5) var(--space-2) var(--space-3); color: var(--muted); }
  .state :global(svg) { margin-bottom: var(--space-1); color: var(--faint); }
  .calm { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
  .sub { font-size: var(--text-xs); color: var(--muted); max-width: 34ch; }
  .loading { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-1) 0 var(--space-2); }

  .wiki .title { font-family: var(--font-display); font-size: var(--text-lg); font-weight: var(--weight-semibold); line-height: 1.25; }
  .desc { margin-top: 2px; font-size: var(--text-xs); color: var(--muted); }
  .extract {
    margin-top: var(--space-2-5);
    font-size: var(--text-sm);
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 8;
    line-clamp: 8;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-3); }
  .credit { font-size: var(--text-2xs); color: var(--faint); }
  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border-radius: var(--radius-xs);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--link);
  }
  .link-btn:hover { text-decoration: underline; text-underline-offset: 3px; }
  .state .link-btn { margin-top: var(--space-2); }

  .lead { font-size: var(--text-sm); color: var(--muted); margin-bottom: var(--space-2); }
  .choices ul { list-style: none; margin: 0 calc(-1 * var(--space-2)); padding: 0; }
  .choice {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .choice:hover { background: var(--hover); }
  .ct { font-size: var(--text-sm); font-weight: var(--weight-medium); color: var(--text); }
  .cd { font-size: var(--text-xs); color: var(--muted); }
</style>
