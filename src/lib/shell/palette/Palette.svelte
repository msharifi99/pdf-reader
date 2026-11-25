<script lang="ts">
  // Ctrl+K command palette. Always mounted (a closed <dialog>) so it opens on the next frame.
  import { tick } from 'svelte';
  import {
    buildChain, commands, commandsState, contextStack, keymap, parsePaletteQuery, PALETTE_PREFIXES, rankItems,
    type Command, type Context, type PaletteMode,
  } from '../../commands';
  import { Icon, Kbd, Spinner, type IconName } from '../../ui';
  import { closeOverlay, shellOverlays } from '../overlays.svelte';
  import { paletteState, providerFor, type PaletteItem } from './providers.svelte';
  import { reportError } from '../errors.svelte';

  const CATEGORY_ORDER = ['Navigation', 'View', 'Search', 'Reading', 'Annotations', 'Library', 'Comic', 'Appearance', 'App'];
  const MODE_META: Record<string, { label: string; icon: IconName; hint: string }> = {
    default: { label: 'Commands', icon: 'search', hint: 'Search or run a command' },
    commands: { label: 'Commands', icon: 'command', hint: 'Run a command' },
    toc: { label: 'Headings', icon: 'toc', hint: 'Jump to a chapter or heading' },
    goto: { label: 'Go to', icon: 'hash', hint: 'Go to a page, or a percentage like 40%' },
    search: { label: 'Search in book', icon: 'search', hint: 'Search this book' },
  };
  const NO_PROVIDER: Record<string, string> = {
    toc: 'Open a book to jump between its chapters.',
    goto: 'Open a book to go to a page or a percentage.',
    search: 'Open a book to search inside it.',
  };
  const PREFIX_CYCLE = ['', '>', '@', '#', '/'];

  let dlg: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLElement | undefined = $state();
  let selected = $state(0);
  let asyncItems = $state<PaletteItem[] | null>(null);
  let loading = $state(false);
  /** context stack as it was before the palette pushed 'dialog' */
  let baseStack = $state<Context[]>(['library']);

  const open = $derived(shellOverlays.palette);
  const query = $derived(parsePaletteQuery(paletteState.input));
  const mode = $derived<string>(paletteState.picker ?? query.mode);
  const provider = $derived(mode === 'default' || mode === 'commands' ? undefined : providerFor(mode));
  const text = $derived(paletteState.picker ? paletteState.input.trim() : query.text);
  const meta = $derived(MODE_META[mode] ?? { label: provider?.label ?? 'Search', icon: 'search' as IconName, hint: provider?.placeholder ?? 'Search' });

  // ---- open / close --------------------------------------------------------------------------
  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      baseStack = contextStack.stack.filter((c, i) => i === 0 || c !== 'dialog');
      selected = 0;
      dlg.showModal();
      input?.focus();
      input?.setSelectionRange(paletteState.input.length, paletteState.input.length);
    } else if (!open && dlg.open) {
      dlg.close();
    }
  });

  function close() {
    closeOverlay('palette');
  }

  // ---- results -------------------------------------------------------------------------------
  function commandItems(q: string, withRecent: boolean): PaletteItem[] {
    void commandsState.list; // re-run when commands register/unregister or MRU changes
    const ctx = baseStack[baseStack.length - 1];
    const chain = buildChain(baseStack);
    const list = commands.list(ctx).filter((c) => commands.isEnabled(c.id));
    const toItem = (c: Command, group: string, indices: number[] = []): PaletteItem => ({
      id: c.id,
      title: c.title,
      group,
      icon: c.icon as IconName | undefined,
      shortcut: keymap.shortcutFor(c.id, chain),
      indices,
      run: () => void commands.execute(c.id),
    });
    const catRank = (c: string) => {
      const i = CATEGORY_ORDER.indexOf(c);
      return i < 0 ? CATEGORY_ORDER.length : i;
    };
    if (!q) {
      const recentIds = withRecent ? commands.recent(5).filter((id) => list.some((c) => c.id === id)) : [];
      const recent = recentIds.map((id) => toItem(list.find((c) => c.id === id)!, 'Recent'));
      const rest = list
        .filter((c) => !recentIds.includes(c.id))
        .sort((a, b) => catRank(a.category) - catRank(b.category) || a.title.localeCompare(b.title))
        .map((c) => toItem(c, c.category));
      return [...recent, ...rest];
    }
    const ranked = rankItems(list, q, {
      fields: (c) => [c.title, c.category, ...(c.keywords ?? [])],
      recency: (c) => commands.recencyRank(c.id),
      limit: 60,
    });
    // keep the ranking, but gather each category under the header of its best hit
    const order: string[] = [];
    const byGroup = new Map<string, PaletteItem[]>();
    for (const r of ranked) {
      const g = r.item.category;
      if (!byGroup.has(g)) (order.push(g), byGroup.set(g, []));
      byGroup.get(g)!.push(toItem(r.item, g, r.indices));
    }
    return order.flatMap((g) => byGroup.get(g)!);
  }

  const syncItems = $derived.by<PaletteItem[] | null>(() => {
    if (!open) return [];
    if (mode === 'default' || mode === 'commands') return commandItems(text, mode === 'default');
    return null; // provider-driven (possibly async)
  });

  let ctrl: AbortController | null = null;
  $effect(() => {
    if (syncItems !== null || !open) {
      ctrl?.abort();
      asyncItems = null;
      loading = false;
      return;
    }
    const p = provider;
    const q = { ...query, text };
    ctrl?.abort();
    if (!p) {
      asyncItems = [];
      return;
    }
    const c = (ctrl = new AbortController());
    let res: PaletteItem[] | Promise<PaletteItem[]>;
    try {
      res = p.query(q, c.signal);
    } catch (err) {
      reportError(err);
      asyncItems = [];
      return;
    }
    if (Array.isArray(res)) {
      asyncItems = res;
      return;
    }
    // keep the previous rows while the next query runs: no flicker between keystrokes
    const slow = setTimeout(() => !c.signal.aborted && (loading = true), 300);
    res
      .then((items) => {
        if (!c.signal.aborted) asyncItems = items;
      })
      .catch((err) => {
        if (!c.signal.aborted && (err as Error)?.name !== 'AbortError') reportError(err);
      })
      .finally(() => {
        clearTimeout(slow);
        if (!c.signal.aborted) loading = false;
      });
  });

  const items = $derived(syncItems ?? asyncItems ?? []);
  /** reserve the icon column only when some row has an icon, so titles line up */
  const anyIcon = $derived(items.some((i) => i.icon));

  $effect(() => {
    void items;
    selected = 0;
    if (listEl) listEl.scrollTop = 0;
  });

  const emptyText = $derived.by(() => {
    if (items.length || loading) return '';
    if (mode !== 'default' && mode !== 'commands' && !provider) return NO_PROVIDER[mode] ?? 'Nothing to show here yet.';
    if (mode === 'goto' && !query.goto) return 'Type a page number, or a percentage like 40%.';
    if (provider?.emptyText) return provider.emptyText;
    return text ? `Nothing matches “${text}”` : 'Nothing to show here yet.';
  });

  // ---- actions -------------------------------------------------------------------------------
  async function runItem(i: number) {
    const it = items[i];
    if (!it) return;
    close();
    await tick(); // the dialog context is popped and focus restored before the command runs
    try {
      await it.run();
    } catch (err) {
      reportError(err);
    }
  }

  function move(to: number) {
    if (!items.length) return;
    selected = Math.max(0, Math.min(items.length - 1, to));
    queueMicrotask(() => listEl?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  function setPrefix(prefix: string) {
    paletteState.picker = null;
    paletteState.input = prefix + text;
    input?.focus();
  }

  function cyclePrefix(dir: 1 | -1) {
    if (paletteState.picker) return;
    const first = paletteState.input.trimStart()[0] ?? '';
    const cur = PALETTE_PREFIXES[first] ? PREFIX_CYCLE.indexOf(first) : 0;
    setPrefix(PREFIX_CYCLE[(cur + dir + PREFIX_CYCLE.length) % PREFIX_CYCLE.length]!);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const page = 8;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); return move(selected + 1 >= items.length ? 0 : selected + 1);
      case 'ArrowUp': e.preventDefault(); return move(selected - 1 < 0 ? items.length - 1 : selected - 1);
      case 'PageDown': e.preventDefault(); return move(selected + page);
      case 'PageUp': e.preventDefault(); return move(selected - page);
      case 'Home': if (!e.shiftKey) { e.preventDefault(); move(0); } return;
      case 'End': if (!e.shiftKey) { e.preventDefault(); move(items.length - 1); } return;
      case 'Enter': e.preventDefault(); return void runItem(selected);
      case 'Tab': e.preventDefault(); return cyclePrefix(e.shiftKey ? -1 : 1);
      case 'Escape':
        // normally `app.back` handles Esc first; this covers a user who unbound it
        if (!e.defaultPrevented) { e.preventDefault(); close(); }
        return;
    }
  }

  function segments(title: string, indices: number[] | undefined) {
    if (!indices?.length) return [{ t: title, m: false }];
    const set = new Set(indices);
    const out: { t: string; m: boolean }[] = [];
    for (let i = 0; i < title.length; i++) {
      const m = set.has(i);
      const last = out[out.length - 1];
      if (last && last.m === m) last.t += title[i];
      else out.push({ t: title[i]!, m });
    }
    return out;
  }

  const modeChips: { prefix: string; mode: PaletteMode; label: string }[] = [
    { prefix: '>', mode: 'commands', label: 'commands' },
    { prefix: '@', mode: 'toc', label: 'headings' },
    { prefix: '#', mode: 'goto', label: 'go to' },
    { prefix: '/', mode: 'search', label: 'in book' },
  ];
  const listId = 'palette-results';
  const optId = (i: number) => `palette-opt-${i}`;
</script>

<dialog
  bind:this={dlg}
  class="palette"
  data-shell-overlay
  data-testid="palette"
  aria-label="Command palette"
  oncancel={(e) => { e.preventDefault(); close(); }}
  onclose={close}
  onclick={(e) => e.target === dlg && close()}
>
  <div class="panel">
    <div class="field">
      <span class="lead-icon"><Icon name={meta.icon} size={20} /></span>
      <input
        bind:this={input}
        bind:value={paletteState.input}
        {onkeydown}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={items.length ? optId(selected) : undefined}
        aria-label={meta.label}
        placeholder={provider?.placeholder ?? meta.hint}
        spellcheck="false"
        autocomplete="off"
      />
      {#if loading}<Spinner size={16} />{/if}
      <span class="esc"><Kbd keys="Esc" /></span>
    </div>

    <div class="results" bind:this={listEl} id={listId} role="listbox" aria-label="{meta.label} results">
      {#each items as it, i (it.id)}
        {#if it.group && it.group !== items[i - 1]?.group}
          <div class="group" role="presentation">{it.group}</div>
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events (keyboard lives on the combobox input) -->
        <div
          id={optId(i)}
          class="row"
          role="option"
          tabindex="-1"
          aria-selected={i === selected}
          data-index={i}
          onmousemove={() => selected !== i && (selected = i)}
          onclick={() => runItem(i)}
        >
          {#if it.thumb}<span class="row-thumb" style:--h={it.thumb.hue}>{#if it.thumb.src}<img src={it.thumb.src} alt="" />{/if}</span>{/if}
          {#if anyIcon}<span class="row-icon">{#if it.icon}<Icon name={it.icon} size={16} />{/if}</span>{/if}
          <span class="title" class:matching={!!it.indices?.length}>
            {#each segments(it.title, it.indices) as s, k (k)}{#if s.m}<mark>{s.t}</mark>{:else}{s.t}{/if}{/each}
          </span>
          {#if it.detail}<span class="detail">{it.detail}</span>{/if}
          {#if it.shortcut}<span class="kbd"><Kbd keys={it.shortcut} /></span>{/if}
        </div>
      {/each}
      {#if emptyText}
        <p class="empty" role="status">{emptyText}</p>
      {/if}
    </div>

    <footer>
      <div class="modes" aria-label="Modes">
        {#each modeChips as c (c.prefix)}
          <button class="mode" class:on={mode === c.mode} onclick={() => setPrefix(mode === c.mode ? '' : c.prefix)} tabindex="-1">
            <span class="pfx">{c.prefix}</span>{c.label}
          </button>
        {/each}
      </div>
      <div class="hints" aria-hidden="true">
        <span><Kbd keys="Up Down" variant="plain" /> move</span>
        <span><Kbd keys="Enter" variant="plain" /> run</span>
        <span><Kbd keys="Tab" variant="plain" /> mode</span>
      </div>
    </footer>
  </div>
</dialog>

<style>
  .palette {
    position: fixed;
    inset: 15vh 0 auto 0;
    margin: 0 auto;
    padding: 0;
    width: min(640px, calc(100vw - 32px));
    max-height: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-4);
    overflow: hidden;
    opacity: 0;
    translate: 0 -6px;
    scale: 0.985;
    transform-origin: top center;
    transition: opacity var(--dur-base) var(--ease-out), translate var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out), display var(--dur-base) allow-discrete, overlay var(--dur-base) allow-discrete;
  }
  .palette[open] { opacity: 1; translate: 0 0; scale: 1; }
  @starting-style {
    .palette[open] { opacity: 0; translate: 0 -6px; scale: 0.985; }
  }
  .palette::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out), display var(--dur-base) allow-discrete, overlay var(--dur-base) allow-discrete;
  }
  .palette[open]::backdrop { opacity: 1; }
  @starting-style {
    .palette[open]::backdrop { opacity: 0; }
  }

  .panel { display: flex; flex-direction: column; }
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 52px;
    padding: 0 var(--space-3) 0 var(--space-4);
    border-bottom: 1px solid var(--border-soft);
  }
  .lead-icon { color: var(--muted); display: grid; }
  input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: none;
    font-size: var(--text-md);
    color: var(--text);
    caret-color: var(--accent);
  }
  input::placeholder { color: var(--faint); }
  input:focus-visible { outline: none; }
  .esc { opacity: 0.9; }

  .results {
    max-height: min(440px, 56vh);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-1-5);
    scroll-padding: var(--space-6) 0 var(--space-1-5);
  }
  .group {
    padding: var(--space-3) var(--space-2-5) var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .group:first-child { padding-top: var(--space-1-5); }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2-5);
    min-height: 36px;
    padding: 0 var(--space-2) 0 var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--text);
    user-select: none;
  }
  .row[aria-selected='true'] { background: var(--selected); }
  .row[aria-selected='true']::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 50%;
    width: 3px;
    height: 16px;
    translate: 0 -50%;
    border-radius: 2px;
    background: var(--accent);
  }
  .row-thumb { flex: none; width: 20px; height: 30px; overflow: hidden; border-radius: 2px; background: color-mix(in oklch, oklch(0.55 0.07 var(--h)) 55%, var(--bg)); box-shadow: 0 0 0 1px var(--border-soft); }
  .row-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .row-icon { display: grid; flex: none; width: 16px; color: var(--muted); }
  .row[aria-selected='true'] .row-icon { color: var(--text); }
  .title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .title.matching { color: var(--muted); }
  mark { background: none; color: var(--text); font-weight: var(--weight-semibold); }
  .detail { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: var(--text-xs); }
  .kbd { flex: none; display: flex; }
  .empty { padding: var(--space-6) var(--space-4); text-align: center; color: var(--muted); font-size: var(--text-sm); }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    height: 36px;
    padding: 0 var(--space-2) 0 var(--space-2);
    border-top: 1px solid var(--border-soft);
    background: color-mix(in oklab, var(--surface), var(--bg));
    font-size: var(--text-2xs);
    color: var(--muted);
  }
  .modes { display: flex; gap: var(--space-0-5); }
  .mode {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 var(--space-2);
    border-radius: var(--radius-xs);
    color: var(--muted);
    transition: background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  }
  .mode:hover { background: var(--hover); color: var(--text); }
  .mode.on { background: var(--accent-soft); color: var(--text); }
  .pfx { font-family: var(--font-mono); font-weight: var(--weight-semibold); color: var(--text); }
  .hints { display: flex; gap: var(--space-3); white-space: nowrap; }
  .hints span { display: inline-flex; align-items: center; gap: var(--space-1); }

  @media (max-width: 560px) {
    .hints { display: none; }
  }
</style>
