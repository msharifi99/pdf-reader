<script lang="ts">
  // Visual shortcuts editor (stories 105–110): click a command, press keys (sequences like `g g`),
  // see conflicts live, Swap or Cancel; several bindings per command; reset one or all; per context.
  import { onDestroy } from 'svelte';
  import {
    COMMAND_TABLE, commands, commandsState, formatSequence, isWithin, keymap, normalizeEvent,
    type Binding, type Conflict, type Context,
  } from '../../commands';
  import { Button, Dialog, Icon, Kbd, SearchField, Select } from '../../ui';
  import { beginKeyCapture } from '../../shell/keyCapture';
  import { useSearch } from '../search.svelte';

  const settingsSearch = useSearch();

  const CONTEXTS: { value: 'all' | Context; label: string }[] = [
    { value: 'all', label: 'All contexts' },
    { value: 'global', label: 'Everywhere' },
    { value: 'library', label: 'Library' },
    { value: 'reader', label: 'Reader (all books)' },
    { value: 'reader.fixed', label: 'PDF and images' },
    { value: 'reader.reflow', label: 'Ebooks' },
    { value: 'comic', label: 'Comics' },
    { value: 'find', label: 'Find bar' },
    { value: 'dialog', label: 'Dialogs' },
  ];
  const CTX_SHORT: Record<Context, string> = {
    global: 'Everywhere', library: 'Library', reader: 'Reader', 'reader.fixed': 'PDF', 'reader.reflow': 'Ebooks',
    comic: 'Comics', find: 'Find', dialog: 'Dialogs',
  };
  const CATEGORY_ORDER = ['Navigation', 'View', 'Search', 'Reading', 'Annotations', 'Library', 'Comic', 'Appearance', 'App'];

  let ctxFilter = $state<'all' | Context>('all');
  let query = $state('');
  let version = $state(0);
  const offChange = keymap.onChange(() => version++);
  onDestroy(offChange);

  type Row = { id: string; title: string; category: string; home: Context; contexts: Context[] };

  const allRows = $derived.by<Row[]>(() => {
    void commandsState.list;
    const seen = new Set<string>();
    const rows: Row[] = [];
    const add = (id: string, title: string, category: string, contexts: Context[]) => {
      if (seen.has(id)) return;
      seen.add(id);
      rows.push({ id, title, category, home: contexts[0] ?? 'global', contexts });
    };
    for (const m of COMMAND_TABLE) add(m.id, m.title, m.category, m.contexts);
    for (const c of commands.list(undefined, { includeHidden: true })) add(c.id, c.title, c.category, c.contexts);
    return rows;
  });

  const relevant = (r: Row, ctx: Context) =>
    !r.contexts.length || r.contexts.some((c) => isWithin(ctx, c) || isWithin(c, ctx));

  const groups = $derived.by(() => {
    const q = (query || settingsSearch.query).trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const out = new Map<string, Row[]>();
    for (const r of allRows) {
      if (ctxFilter !== 'all' && !relevant(r, ctxFilter)) continue;
      if (terms.length) {
        void version;
        const keys = keymap.bindingsFor(r.id).map((b) => formatSequence(b.steps)).join(' ').toLowerCase();
        const hay = `${r.title} ${r.category} ${keys}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) continue;
      }
      const list = out.get(r.category) ?? [];
      list.push(r);
      out.set(r.category, list);
    }
    const rank = (c: string) => (CATEGORY_ORDER.indexOf(c) + 100) % 100;
    return [...out.entries()].sort(([a], [b]) => rank(a) - rank(b));
  });

  function bindingsOf(id: string): Binding[] {
    void version;
    const all = keymap.bindingsFor(id);
    if (ctxFilter === 'all') return all;
    return all.filter((b) => isWithin(ctxFilter as Context, b.context) || isWithin(b.context, ctxFilter as Context));
  }
  function modified(id: string): boolean {
    void version;
    return keymap.isModified(id);
  }

  // ---- capture ---------------------------------------------------------------------------------
  type Capture = {
    command: string;
    title: string;
    context: Context;
    replace?: Binding;
    steps: string[];
    phase: 'listening' | 'confirm';
    conflicts: Conflict[];
  };
  let cap = $state<Capture | null>(null);
  let stopCapture: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function targetContext(r: Row, replace?: Binding): Context {
    if (replace) return replace.context;
    if (ctxFilter !== 'all') return ctxFilter;
    return r.home;
  }

  function startCapture(r: Row, replace?: Binding) {
    cancel();
    cap = { command: r.id, title: r.title, context: targetContext(r, replace), replace, steps: [], phase: 'listening', conflicts: [] };
    stopCapture = beginKeyCapture(onCaptureKey);
  }

  function onCaptureKey(e: KeyboardEvent) {
    if (!cap) return;
    if (e.key === 'Escape') return cancel();
    if (e.repeat) return;
    const step = normalizeEvent(e);
    if (!step) return; // a lone modifier: wait for the key
    cap.steps.push(step);
    clearTimeout(timer);
    // sequences: wait for a following key just like the keymap does (1 s), max 3 steps
    if (cap.steps.length >= 3) finish();
    else timer = setTimeout(finish, 1000);
  }

  function finish() {
    clearTimeout(timer);
    stopCapture?.();
    stopCapture = null;
    if (!cap || !cap.steps.length) return cancel();
    const seq = cap.steps.join(' ');
    cap.conflicts = keymap.findConflicts(cap.context, seq, { command: cap.command }).filter(
      (c) => !(cap!.replace && c.sequence === cap!.replace.sequence && c.command === cap!.command),
    );
    cap.phase = 'confirm';
    // Enter confirms right away; the primary button takes focus once the bar renders
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-confirm-save]')?.focus());
  }

  function cancel() {
    clearTimeout(timer);
    stopCapture?.();
    stopCapture = null;
    cap = null;
  }
  onDestroy(cancel);

  const exact = $derived(cap?.conflicts.filter((c) => c.kind === 'exact') ?? []);
  const partial = $derived(cap?.conflicts.filter((c) => c.kind !== 'exact') ?? []);
  const titleOf = (id: string) => commands.get(id)?.title ?? COMMAND_TABLE.find((c) => c.id === id)?.title ?? id;

  function save() {
    if (!cap) return;
    const seq = cap.steps.join(' ');
    if (exact.length) {
      keymap.swap(cap.context, seq, cap.command, cap.replace?.sequence);
    } else {
      if (cap.replace) keymap.unbind(cap.replace.context, cap.replace.sequence, cap.command);
      keymap.bind(cap.context, seq, cap.command);
    }
    cap = null;
  }

  let confirmResetAll = $state(false);
</script>

<div class="toolbar">
  <div class="search"><SearchField bind:value={query} placeholder="Search commands or keys" label="Search shortcuts" /></div>
  <Select label="Context" hideLabel options={CONTEXTS} bind:value={ctxFilter} />
  <span class="spacer"></span>
  <Button variant="subtle" size="sm" icon="undo" onclick={() => (confirmResetAll = true)}>Reset all</Button>
</div>
<p class="intro">Click a command, then press the keys. Pause after the first key to record a sequence such as <Kbd keys="g g" />.</p>

<div class="list" data-testid="shortcuts-editor">
  {#each groups as [category, rows] (category)}
    <section data-setting={category}>
      <h3>{category}</h3>
      {#each rows as r (r.id)}
        {@const binds = bindingsOf(r.id)}
        {@const active = cap?.command === r.id}
        <div class="row" class:active data-command={r.id}>
          <button class="name" onclick={() => startCapture(r)} aria-label="Add a shortcut for {r.title}">
            <span class="t">{r.title}</span>
            {#if modified(r.id)}<span class="dot" title="Changed from the default" aria-label="changed"></span>{/if}
          </button>
          <div class="keys">
            {#if active && cap?.phase === 'listening'}
              <span class="listening" role="status" aria-live="assertive">
                {#if cap.steps.length}
                  <Kbd keys={formatSequence(cap.steps)} /><span class="more">…</span>
                {:else}
                  Press keys<span class="hint">Esc to cancel</span>
                {/if}
              </span>
            {:else}
              {#each binds as b (b.context + b.sequence)}
                {@const label = formatSequence(b.steps)}
                <span class="chip" class:replacing={active && cap?.replace === b}>
                  <button class="chip-key" onclick={() => startCapture(r, b)} aria-label="Change {label} for {r.title}">
                    <Kbd keys={label} />
                    {#if b.context !== r.home}<span class="ctx">{CTX_SHORT[b.context]}</span>{/if}
                  </button>
                  <button class="chip-x" onclick={() => keymap.unbind(b.context, b.sequence, b.command)} aria-label="Remove {label} from {r.title}">
                    <Icon name="close" size={16} />
                  </button>
                </span>
              {/each}
              <button class="add" onclick={() => startCapture(r)} aria-label="Add shortcut for {r.title}" title="Add shortcut">
                <Icon name="plus" size={16} />
              </button>
            {/if}
          </div>
          <div class="end">
            {#if modified(r.id) && !active}
              <button class="reset" onclick={() => keymap.resetCommand(r.id)} aria-label="Reset {r.title} to default">Reset</button>
            {/if}
          </div>
        </div>
        {#if active && cap?.phase === 'confirm'}
          {@const seq = formatSequence(cap.steps)}
          <div class="confirm" class:warn={exact.length > 0} role="group" aria-label="Confirm shortcut" data-testid="shortcut-confirm">
            <div class="msg">
              {#if exact.length}
                <Icon name="warning" size={16} />
                <span>
                  <Kbd keys={seq} /> is already used by
                  {#each exact as c, i (c.command + c.context)}{#if i > 0}, {/if}<strong>{titleOf(c.command)}</strong>
                    <span class="muted">({CTX_SHORT[c.context]})</span>{/each}.
                  {cap.replace ? 'Swap gives it your old shortcut.' : 'Swap moves it here.'}
                </span>
              {:else if partial.length}
                <Icon name="info" size={16} />
                <span>
                  <Kbd keys={seq} /> overlaps <Kbd keys={formatSequence(partial[0]!.sequence)} /> ({titleOf(partial[0]!.command)}).
                  Both work: the shorter one waits a second for the next key.
                </span>
              {:else}
                <Icon name="check-circle" size={16} />
                <span><Kbd keys={seq} /> for <strong>{cap.title}</strong> in {CTX_SHORT[cap.context]}</span>
              {/if}
            </div>
            <div class="btns">
              <Button variant="subtle" size="sm" onclick={() => startCapture(allRows.find((x) => x.id === cap!.command)!, cap!.replace)}>Try again</Button>
              <Button variant="subtle" size="sm" onclick={cancel}>Cancel</Button>
              <Button variant="primary" size="sm" data-confirm-save onclick={save}>{exact.length ? 'Swap' : 'Save'}</Button>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  {:else}
    <p class="empty">No command matches “{query || settingsSearch.query}”</p>
  {/each}
</div>

<Dialog bind:open={confirmResetAll} title="Reset all shortcuts?" description="Every command goes back to its default keys. Your other settings stay as they are." size="sm">
  {#snippet footer()}
    <Button variant="subtle" onclick={() => (confirmResetAll = false)}>Cancel</Button>
    <Button variant="danger" onclick={() => { keymap.resetAll(); confirmResetAll = false; }}>Reset all</Button>
  {/snippet}
</Dialog>

<style>
  .toolbar { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-3); }
  .search { width: 280px; }
  .spacer { flex: 1; }
  .intro { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; margin-bottom: var(--space-6); font-size: var(--text-xs); color: var(--muted); }
  section { margin-bottom: var(--space-6); }
  h3 {
    margin-bottom: var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(180px, 1fr) auto 64px;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    padding: 0 var(--space-2) 0 var(--space-3);
    margin: 0 calc(var(--space-3) * -1);
    border-radius: var(--radius-sm);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .row:hover { background: var(--hover); }
  .row.active { background: var(--selected); }
  .name { display: flex; align-items: center; gap: var(--space-2); min-width: 0; height: 36px; text-align: left; border-radius: var(--radius-sm); }
  .name:focus-visible { outline-offset: -2px; }
  .t { font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex: none; }
  .keys { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-1-5); }
  .chip { display: inline-flex; align-items: center; border-radius: var(--radius-sm); transition: background-color var(--dur-fast) var(--ease-out); }
  .chip:hover { background: var(--hover); }
  .chip-key { display: inline-flex; align-items: center; gap: var(--space-1-5); height: 28px; padding: 0 var(--space-1-5); border-radius: var(--radius-sm); }
  .ctx { font-size: var(--text-2xs); color: var(--muted); }
  .chip-x {
    display: grid;
    place-items: center;
    width: 0;
    height: 28px;
    overflow: hidden;
    opacity: 0;
    color: var(--muted);
    border-radius: var(--radius-sm);
    transition: width var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
  }
  .chip:hover .chip-x, .chip-x:focus-visible, .chip:focus-within .chip-x { width: 24px; opacity: 1; }
  .chip-x:hover { color: var(--danger); }
  .add {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    color: var(--faint);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
  }
  .row:hover .add, .add:focus-visible { opacity: 1; }
  .add:hover { color: var(--text); background: var(--hover); }
  .listening {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 28px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-full);
    box-shadow: inset 0 0 0 1.5px var(--accent);
    font-size: var(--text-xs);
    color: var(--text);
    animation: breathe 1.6s var(--ease-in-out) infinite;
  }
  .listening .hint { color: var(--muted); }
  .more { color: var(--muted); }
  @keyframes breathe { 50% { box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--accent) 45%, transparent); } }
  @media (prefers-reduced-motion: reduce) { .listening { animation: none; } }
  :global(:root[data-reduce-motion='on']) .listening { animation: none; }
  .end { display: flex; justify-content: flex-end; }
  .reset { font-size: var(--text-xs); color: var(--muted); padding: 2px 6px; border-radius: var(--radius-xs); }
  .reset:hover { color: var(--text); background: var(--hover); }
  .confirm {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin: var(--space-1) 0 var(--space-2);
    padding: var(--space-2-5) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
    font-size: var(--text-xs);
    animation: in var(--dur-base) var(--ease-out);
  }
  .confirm.warn { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 45%, var(--border)); }
  .msg { display: flex; align-items: center; gap: var(--space-2); color: var(--text); line-height: 1.8; }
  .msg > :global(svg) { flex: none; color: var(--muted); }
  .warn .msg > :global(svg) { color: var(--accent); }
  .msg strong { font-weight: var(--weight-semibold); }
  .muted { color: var(--muted); }
  .btns { display: flex; gap: var(--space-1-5); flex: none; }
  .empty { padding: var(--space-10) 0; text-align: center; color: var(--muted); }
  @keyframes in { from { opacity: 0; translate: 0 -4px; } }
</style>
