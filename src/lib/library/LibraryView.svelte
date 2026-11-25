<!--
  LibraryView — PLACEHOLDER from T5 (app shell). T7 owns this folder and replaces this file.

  Contract
  - Props: none. Mounted by App.svelte when `app.view === 'library'`, inside the scrollable view
    area under the title bar (fills it; paint your own `--bg`; the 40px page gutter is yours).
  - Open a book:   `import { openDocument } from '../stores/app.svelte'` → `await openDocument(book.path)`
                   (never throws; failures show the shell's calm error dialog).
  - Key context:   the shell sets the base context to 'library'. Register library.* commands while mounted.
  - Palette:       register the Ctrl+P switcher with `registerPaletteProvider({ mode: 'books', ... })`
                   from '../shell/palette/providers.svelte' and bind `app.switchBook` to `openPalette({ mode: 'books' })`.
  - Drag & drop, Ctrl+O and launch files are handled by the shell.
-->
<script lang="ts">
  import { Button, Kbd } from '../ui';
  import { commands, keyState } from '../commands';

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
</script>

<div class="library" data-testid="library-view">
  <header>
    <h1>{greeting}</h1>
  </header>
  <div class="empty">
    <div class="shelf" aria-hidden="true">
      <span style="--h: 64px; --t: 0deg"></span>
      <span style="--h: 76px; --t: 0deg"></span>
      <span style="--h: 70px; --t: -9deg"></span>
    </div>
    <h2>Your library is empty</h2>
    <p>Open a book, or drop PDFs, ebooks and comics anywhere in this window.</p>
    <div class="actions">
      <Button variant="primary" icon="open" onclick={() => commands.execute('app.openFile')}>Open a book</Button>
    </div>
    <p class="hint">
      <Kbd keys={keyState.shortcut('app.openPalette') ?? 'Ctrl+K'} /> for every command · <Kbd keys="?" /> for shortcuts
    </p>
  </div>
</div>

<style>
  .library { height: 100%; overflow: auto; padding: var(--space-10) var(--space-10) var(--space-16); background: var(--bg); }
  h1 { font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 500; letter-spacing: -0.015em; }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    margin: 12vh auto 0;
    max-width: 420px;
  }
  .shelf { display: flex; align-items: flex-end; gap: 6px; height: 80px; margin-bottom: var(--space-5); padding-bottom: 2px; border-bottom: 1.5px solid var(--border-strong); }
  .shelf span {
    width: 18px;
    height: var(--h);
    rotate: var(--t);
    transform-origin: bottom left;
    border-radius: 2px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .shelf span:nth-child(2) { width: 22px; background: color-mix(in oklab, var(--accent) 30%, var(--surface-2)); }
  h2 { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 500; letter-spacing: -0.01em; }
  p { color: var(--muted); font-size: var(--text-sm); }
  .actions { margin-top: var(--space-4); }
  .hint { display: inline-flex; align-items: center; gap: var(--space-1-5); margin-top: var(--space-8); font-size: var(--text-xs); color: var(--faint); }
</style>
