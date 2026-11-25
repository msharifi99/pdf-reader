<script lang="ts">
  // "?" overlay: the shortcuts that work right now, grouped by category, searchable.
  import { commandMeta, commands, contextStack, fuzzyMatch, keymap, type Context } from '../commands';
  import { IconButton, Kbd, SearchField } from '../ui';
  import { closeOverlay, shellOverlays } from './overlays.svelte';

  const CATEGORY_ORDER = ['Navigation', 'View', 'Search', 'Reading', 'Annotations', 'Library', 'Comic', 'Appearance', 'App'];
  const CONTEXT_LABEL: Partial<Record<Context, string>> = {
    library: 'Library',
    reader: 'Reader',
    'reader.fixed': 'PDF and images',
    'reader.reflow': 'Ebooks',
    comic: 'Comics',
  };

  let dlg: HTMLDialogElement | undefined = $state();
  let search: HTMLInputElement | undefined = $state();
  let query = $state('');
  let stack = $state<Context[]>(['library']);
  let version = $state(0);

  const open = $derived(shellOverlays.cheatSheet);

  $effect(() => {
    if (!dlg) return;
    if (open && !dlg.open) {
      stack = contextStack.stack.filter((c, i) => i === 0 || c !== 'dialog');
      query = '';
      version++;
      dlg.showModal();
      search?.focus();
    } else if (!open && dlg.open) dlg.close();
  });

  type Row = { command: string; title: string; keys: string[] };

  const groups = $derived.by(() => {
    void version;
    const rows = new Map<string, Row & { category: string }>();
    for (const b of keymap.activeBindings(stack)) {
      const meta = commands.get(b.command) ?? commandMeta(b.command);
      if (!meta || b.command === 'app.back') continue;
      const r = rows.get(b.command) ?? { command: b.command, title: meta.title, category: meta.category, keys: [] };
      if (!r.keys.includes(b.label)) r.keys.push(b.label);
      rows.set(b.command, r);
    }
    const q = query.trim();
    const byCat = new Map<string, Row[]>();
    for (const r of rows.values()) {
      if (q && !fuzzyMatch(q, `${r.title} ${r.category} ${r.keys.join(' ')}`)) continue;
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    }
    const rank = (c: string) => (CATEGORY_ORDER.indexOf(c) + 100) % 100;
    return [...byCat.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([category, list]) => ({ category, rows: list.sort((a, b) => a.title.localeCompare(b.title)) }));
  });

  const where = $derived(CONTEXT_LABEL[stack[0]!] ?? 'Everywhere');
  const close = () => closeOverlay('cheatSheet');
</script>

<dialog
  bind:this={dlg}
  class="sheet"
  data-shell-overlay
  data-testid="cheat-sheet"
  aria-labelledby="cs-title"
  oncancel={(e) => { e.preventDefault(); close(); }}
  onclose={close}
  onclick={(e) => e.target === dlg && close()}
>
  <header>
    <div class="heading">
      <h2 id="cs-title">Keyboard shortcuts</h2>
      <p class="where">Active in {where} · change them in Settings › Keyboard</p>
    </div>
    <div class="tools">
      <div class="search"><SearchField bind:value={query} bind:input={search} placeholder="Filter shortcuts" label="Filter shortcuts" /></div>
      <IconButton icon="close" label="Close" size="sm" tooltip={false} onclick={close} />
    </div>
  </header>
  <div class="body">
    {#if groups.length}
      <div class="cols">
        {#each groups as g (g.category)}
          <section>
            <h3>{g.category}</h3>
            <ul>
              {#each g.rows as r (r.command)}
                <li>
                  <span class="t">{r.title}</span>
                  <span class="keys">
                    {#each r.keys as k, i (k)}
                      {#if i > 0}<span class="or">or</span>{/if}<Kbd keys={k} />
                    {/each}
                  </span>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {:else}
      <p class="empty">No shortcut matches “{query}”</p>
    {/if}
  </div>
</dialog>

<style>
  .sheet {
    margin: auto;
    padding: 0;
    width: min(1040px, calc(100vw - 48px));
    max-height: min(760px, calc(100vh - 96px));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-4);
    overflow: hidden;
    opacity: 0;
    scale: 0.985;
    translate: 0 6px;
    transition: opacity var(--dur-slow) var(--ease-out), scale var(--dur-slow) var(--ease-out), translate var(--dur-slow) var(--ease-out),
      display var(--dur-slow) allow-discrete, overlay var(--dur-slow) allow-discrete;
  }
  .sheet[open] { opacity: 1; scale: 1; translate: 0 0; display: flex; flex-direction: column; }
  @starting-style {
    .sheet[open] { opacity: 0; scale: 0.985; translate: 0 6px; }
  }
  .sheet::backdrop {
    background: var(--scrim);
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out), display var(--dur-slow) allow-discrete, overlay var(--dur-slow) allow-discrete;
  }
  .sheet[open]::backdrop { opacity: 1; }
  @starting-style {
    .sheet[open]::backdrop { opacity: 0; }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-5) var(--space-5) var(--space-4) var(--space-8);
    border-bottom: 1px solid var(--border-soft);
  }
  h2 { font-size: var(--text-lg); }
  .where { margin-top: var(--space-1); font-size: var(--text-xs); color: var(--muted); }
  .tools { display: flex; align-items: center; gap: var(--space-2); }
  .search { width: 260px; }
  .body { overflow-y: auto; padding: var(--space-6) var(--space-8) var(--space-8); }
  .cols { columns: 3 280px; column-gap: var(--space-10); }
  section { break-inside: avoid; margin-bottom: var(--space-6); }
  h3 {
    margin-bottom: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }
  ul { list-style: none; padding: 0; }
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 30px;
    border-bottom: 1px solid var(--border-soft);
    font-size: var(--text-sm);
  }
  li:last-child { border-bottom: 0; }
  .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .keys { display: flex; align-items: center; gap: var(--space-1-5); flex: none; }
  .or { font-size: var(--text-2xs); color: var(--faint); }
  .empty { padding: var(--space-12) 0; text-align: center; color: var(--muted); }
  @media (max-width: 640px) {
    header { flex-direction: column; align-items: stretch; padding-left: var(--space-5); }
    .search { width: auto; flex: 1; }
    .body { padding-inline: var(--space-5); }
  }
</style>
