<script lang="ts">
  // Kitchen sink: every component in every theme. Open with ?gallery (wired by the app shell) or
  // /src/lib/ui/gallery.html in dev. ?theme=<id> picks the starting theme.
  import {
    Button, Card, Checkbox, ColorPicker, ColorSwatch, ContextMenu, Dialog, EmptyState, Icon, IconButton, Kbd, ListBox,
    Menu, MenuList, Popover, ProgressBar, ProgressRing, SearchField, SegmentedControl, Select, Skeleton, Slider,
    Spinner, Switch, Tabs, TextField, ToastHost, Tooltip, toast, iconNames, type MenuItem,
  } from './index';
  import { applyTheme, builtinThemes, highlightColors, themes, type BuiltinThemeId } from '../design/themes';
  import { bundledFonts, defaultTypography, typographyStyle } from '../design/fonts';

  const params = new URLSearchParams(location.search);
  let themeId = $state<string>(params.get('theme') ?? 'dark');
  let reduceMotion = $state(false);

  $effect(() => {
    const t = themes[themeId as BuiltinThemeId] ?? themes.dark;
    void applyTheme(t);
  });
  $effect(() => {
    if (reduceMotion) document.documentElement.dataset.reduceMotion = 'on';
    else delete document.documentElement.dataset.reduceMotion;
  });

  // demo state
  let name = $state('Night novel');
  let query = $state('');
  let font = $state('literata');
  let size = $state(19);
  let lineHeight = $state(1.6);
  let align = $state<'start' | 'justify'>('start');
  let hyphenate = $state(true);
  let override = $state(false);
  let flow = $state<'paginated' | 'scrolled'>('paginated');
  let layout = $state<'grid' | 'list'>('grid');
  let tab = $state<'contents' | 'highlights' | 'bookmarks'>('contents');
  let dialogOpen = $state(false);
  let popOpen = $state(false);
  let color = $state('#e2a85e');
  let hl = $state<string>('yellow');
  let selected = $state(2);
  let bookmarked = $state(true);

  const menuItems: MenuItem[] = [
    { type: 'label', label: 'Book' },
    { id: 'open', label: 'Open', icon: 'book-open', shortcut: 'Enter' },
    { id: 'win', label: 'Open in new window', icon: 'open', shortcut: 'Ctrl+Enter' },
    { id: 'col', label: 'Add to collection…', icon: 'collection' },
    { type: 'separator' },
    { id: 'tint', label: 'Smart page tint', checked: true },
    { id: 'spread', label: 'Two-page spread', checked: false, shortcut: 'D' },
    { type: 'separator' },
    { id: 'reveal', label: 'Show in Explorer', icon: 'folder', disabled: true },
    { id: 'rm', label: 'Remove from library', icon: 'trash', danger: true, shortcut: 'Del' },
  ];
  const chapters = Array.from({ length: 1000 }, (_, i) => ({ id: i, title: i === 0 ? 'Prologue' : `Chapter ${i}`, page: 1 + i * 12 }));

  const books = [
    { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', progress: 0.42, meta: '2 h 10 min left', format: 'EPUB' },
    { title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', progress: 0.08, format: 'PDF' },
    { title: 'Middlemarch', author: 'George Eliot', progress: 1 },
    { title: 'Saga, Volume One', author: 'Vaughan & Staples', progress: 0.66, format: 'CBZ' },
    { title: 'A Pattern Language', author: 'Christopher Alexander', format: 'PDF' },
    { title: 'Piranesi', author: 'Susanna Clarke', missing: true },
  ];

  const reading = $derived(
    typographyStyle({ ...defaultTypography, fontFamily: font, fontSize: size, lineHeight, textAlign: align, hyphenation: hyphenate, marginX: 0 }),
  );
  const roles = ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'on-accent', 'link', 'selection', 'danger', 'success'];
</script>

<ToastHost />

<div class="gallery">
  <!-- Title bar mock: what T5 builds. Chrome is translucent over Mica. -->
  <header class="titlebar" data-chrome="top">
    <div class="tb-left">
      <span class="mark" aria-hidden="true">Q</span>
      <span class="tb-title">Quire — design system</span>
    </div>
    <div class="tb-center">
      <button class="palette-trigger" onclick={() => toast('Command palette would open')}>
        <Icon name="search" size={16} /><span>Search or run a command</span><Kbd keys="Ctrl+K" />
      </button>
    </div>
    <div class="tb-right">
      <IconButton icon="theme" label="Theme" size="sm" />
      <IconButton icon="settings" label="Settings" shortcut="Ctrl+," size="sm" />
      <span class="caption-buttons">
        <button aria-label="Minimize"><Icon name="minimize" size={16} /></button>
        <button aria-label="Maximize"><Icon name="maximize" size={16} /></button>
        <button class="close" aria-label="Close"><Icon name="close" size={16} /></button>
      </span>
    </div>
  </header>

  <main>
    <section class="hero">
      <div>
        <h1>Quire</h1>
        <p class="lede">A quiet interface for long reading. One accent, generous space, and controls that step aside.</p>
      </div>
      <div class="hero-controls">
        <SegmentedControl
          label="Theme"
          bind:value={themeId}
          options={builtinThemes.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Switch label="Reduce motion" bind:checked={reduceMotion} />
      </div>
    </section>

    <!-- Colour -->
    <section>
      <h2 class="eyebrow">Colour roles</h2>
      <div class="roles">
        {#each roles as r (r)}
          <div class="role">
            <span class="chip" style:background="var(--{r})"></span>
            <code>--{r}</code>
          </div>
        {/each}
      </div>
      <p class="hl-sample">
        Highlights stay legible:
        {#each highlightColors as c (c)}
          <mark style:background="var(--hl-{c})">{c} passage of text</mark>{' '}
        {/each}
        and <span class="sel">a selected phrase</span>, with <a href="#links">a link</a>.
      </p>
    </section>

    <!-- Type -->
    <section class="two">
      <div>
        <h2 class="eyebrow">Interface type · Inter</h2>
        <div class="scale">
          <span style:font-size="var(--text-2xl)" class="display">Good evening</span>
          <span style:font-size="var(--text-xl)" style:font-weight="600">Library</span>
          <span style:font-size="var(--text-lg)" style:font-weight="600">Continue reading</span>
          <span style:font-size="var(--text-md)">Primary list text, 14</span>
          <span style:font-size="var(--text-sm)">Default UI text, 13 — buttons, menus, settings</span>
          <span style:font-size="var(--text-xs)" class="muted">Caption and metadata, 12 · 2 h 10 min left</span>
          <span class="eyebrow" style:margin="0">Section label, 11 caps</span>
        </div>
        <h2 class="eyebrow" style:margin-top="var(--space-8)">Bundled reading fonts</h2>
        <ul class="fonts" role="list">
          {#each bundledFonts as f (f.id)}
            <li>
              <span class="f-sample" style:font-family={f.stack}>Aa Gg Qq 1234</span>
              <span class="f-meta"><strong>{f.label}</strong> <span class="muted">· {f.category}</span></span>
            </li>
          {/each}
        </ul>
      </div>
      <div class="reading-card">
        <div class="reading-tools">
          <Select label="Font" hideLabel bind:value={font} options={bundledFonts.filter((f) => f.category !== 'mono').map((f) => ({ value: f.id, label: f.label }))} />
          <SegmentedControl label="Alignment" size="sm" bind:value={align} options={[{ value: 'start', label: 'Left' }, { value: 'justify', label: 'Justify' }]} />
        </div>
        <article class="reading" style={reading}>
          <p class="chapter">Chapter One</p>
          <h3>The Gathering of Pages</h3>
          <p>
            A quire is four sheets of paper folded once, nested, and sewn through the fold: sixteen pages that wait to
            be read in order. Bound together, many quires make a book. The word has survived the printing press, the
            typewriter and the screen, because the idea it holds has never stopped being useful — <em>things worth keeping
            are gathered carefully</em>.
          </p>
          <p>
            Reading is the same. It asks for a quiet surface, a comfortable measure of about sixty-six characters, and
            type that has room to breathe. Everything else can wait at the edges until it is wanted.
          </p>
        </article>
        <div class="reading-sliders">
          <Slider label="Size" min={14} max={28} bind:value={size} format={(v) => `${v}px`} />
          <Slider label="Line spacing" min={1.2} max={2} step={0.05} bind:value={lineHeight} format={(v) => v.toFixed(2)} />
        </div>
      </div>
    </section>

    <!-- Buttons -->
    <section>
      <h2 class="eyebrow">Buttons</h2>
      <div class="row">
        <Button variant="primary" icon="book-open">Continue reading</Button>
        <Button>Add books</Button>
        <Button variant="ghost" icon="filter">Filter</Button>
        <Button variant="subtle">Cancel</Button>
        <Button variant="danger" icon="trash">Remove</Button>
        <Button variant="primary" loading>Importing</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div class="row">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg" variant="primary">Large</Button>
        <span class="divider"></span>
        <IconButton icon="toc" label="Contents" shortcut="T" />
        <IconButton icon="search" label="Find in book" shortcut="Ctrl+F" />
        <IconButton icon={bookmarked ? 'bookmark-filled' : 'bookmark'} label="Bookmark" shortcut="Ctrl+B" pressed={bookmarked} onclick={() => (bookmarked = !bookmarked)} />
        <IconButton icon="typography" label="Typography" shortcut="Ctrl+T" />
        <IconButton icon="more" label="More" variant="solid" />
        <IconButton icon="zoom-in" label="Zoom in" size="sm" />
        <IconButton icon="zoom-out" label="Zoom out" size="sm" disabled />
      </div>
    </section>

    <!-- Icons -->
    <section>
      <h2 class="eyebrow">Icons · 20px grid · 1.5px stroke · {iconNames.length}</h2>
      <div class="icons">
        {#each iconNames as n (n)}
          <div class="icon-cell" title={n}>
            <Icon name={n} />
            <span>{n}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Inputs -->
    <section class="two">
      <div class="stack">
        <h2 class="eyebrow">Inputs</h2>
        <TextField label="Profile name" bind:value={name} hint="Shown in the typography menu." />
        <TextField label="Go to page" placeholder="1–412" error="There is no page 900." value="900" />
        <SearchField bind:value={query} placeholder="Search your library" shortcut="Ctrl+F" />
        <Select label="Page tint" value="smart" options={[{ value: 'smart', label: 'Smart' }, { value: 'invert', label: 'Invert' }, { value: 'original', label: 'Original' }]} />
        <TextField label="Note" multiline placeholder="Write a note…" />
      </div>
      <div class="stack">
        <h2 class="eyebrow">Toggles</h2>
        <Switch label="Hyphenation" description="Break long words at line ends" bind:checked={hyphenate} />
        <Switch label="Override publisher styles" bind:checked={override} />
        <Switch label="Follow Windows theme" checked disabled />
        <div class="row">
          <Checkbox label="Include notes" checked />
          <Checkbox label="Group by chapter" />
          <Checkbox label="Some" indeterminate />
        </div>
        <SegmentedControl label="Flow" bind:value={flow} options={[{ value: 'paginated', label: 'Pages', icon: 'paginate' }, { value: 'scrolled', label: 'Scroll', icon: 'scroll' }]} />
        <SegmentedControl label="Layout" size="sm" bind:value={layout} options={[{ value: 'grid', label: 'Grid', icon: 'grid', iconOnly: true }, { value: 'list', label: 'List', icon: 'list', iconOnly: true }]} />
        <Slider label="Auto-scroll speed" min={1} max={10} value={4} format={(v) => `${v}×`} />
        <Slider label="Margins" min={0} max={160} step={4} value={56} format={(v) => `${v}px`} />
      </div>
    </section>

    <!-- Overlays -->
    <section class="two">
      <div class="stack">
        <h2 class="eyebrow">Menus, popovers, tooltips</h2>
        <div class="row">
          <Menu label="Book actions" items={menuItems}>
            {#snippet trigger(attrs)}
              <Button {...attrs} iconEnd="chevron-down">Actions</Button>
            {/snippet}
          </Menu>
          <Popover label="Highlight colour" bind:open={popOpen} size="sm">
            {#snippet trigger(attrs)}
              <Button {...attrs} variant="ghost" icon="highlight">Highlight</Button>
            {/snippet}
            <div class="pop-row" role="radiogroup" aria-label="Highlight colour">
              {#each highlightColors as c (c)}
                <ColorSwatch role="radio" color="var(--hl-{c})" label={c} selected={hl === c} onclick={() => { hl = c; popOpen = false; }} />
              {/each}
            </div>
          </Popover>
          <Tooltip text="Read aloud" shortcut="Ctrl+Shift+U"><Button variant="ghost" icon="speaker">Hover me</Button></Tooltip>
        </div>
        <ContextMenu items={menuItems}>
          <div class="ctx-target" tabindex="0" role="button" aria-label="Right-click target">Right-click (or Shift+F10) here</div>
        </ContextMenu>
        <div class="row">
          <Kbd keys="Ctrl+K" /><Kbd keys="Ctrl+Shift+P" /><Kbd keys="g g" /><Kbd keys="Shift+ArrowRight" /><Kbd keys="?" /><Kbd keys="F11" />
        </div>
      </div>
      <div class="stack">
        <h2 class="eyebrow">Menu (static)</h2>
        <div class="flyout-static"><MenuList items={menuItems} onclose={() => {}} label="Static menu" /></div>
      </div>
    </section>

    <!-- Dialog + toasts -->
    <section>
      <h2 class="eyebrow">Dialogs & toasts</h2>
      <div class="row">
        <Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
        <Button variant="ghost" onclick={() => toast('Progress saved')}>Info toast</Button>
        <Button variant="ghost" onclick={() => toast('Highlight removed', { action: { label: 'Undo', run: () => toast('Restored', { kind: 'success' }) } })}>Toast with undo</Button>
        <Button variant="ghost" onclick={() => toast('Couldn’t open “report.pdf”: the file is password-protected.', { kind: 'error' })}>Error toast</Button>
      </div>
      <Dialog bind:open={dialogOpen} title="Remove from library?" description="Highlights and notes for this book will be kept for 30 days.">
        <Checkbox label="Also move the file to the Recycle Bin" />
        {#snippet footer()}
          <Button variant="subtle" onclick={() => (dialogOpen = false)}>Cancel</Button>
          <Button variant="primary" onclick={() => { dialogOpen = false; toast('Removed', { action: { label: 'Undo', run: () => {} } }); }}>Remove</Button>
        {/snippet}
      </Dialog>
    </section>

    <!-- Navigation -->
    <section class="two">
      <div>
        <h2 class="eyebrow">Tabs</h2>
        <Tabs label="Sidebar" bind:value={tab} tabs={[{ id: 'contents', label: 'Contents' }, { id: 'highlights', label: 'Highlights', count: 24 }, { id: 'bookmarks', label: 'Bookmarks', count: 3 }]}>
          {#snippet children(v)}
            <p class="muted">Panel for <strong>{v}</strong>.</p>
          {/snippet}
        </Tabs>
      </div>
      <div>
        <h2 class="eyebrow">ListBox · 1,000 rows, virtualised</h2>
        <ListBox class="toc" label="Table of contents" items={chapters} key={(c) => c.id} text={(c) => c.title} bind:selected itemHeight={36}>
          {#snippet item(c, s)}
            <span class="toc-row" class:current={s.selected}><span>{c.title}</span><span class="muted tabular">{c.page}</span></span>
          {/snippet}
        </ListBox>
      </div>
    </section>

    <!-- Progress -->
    <section>
      <h2 class="eyebrow">Progress & loading</h2>
      <div class="progress-demo">
        <div class="stack">
          <span class="muted small">Reading progress line · chapter marks</span>
          <ProgressBar variant="line" value={0.42} label="Book progress" marks={[0.12, 0.3, 0.51, 0.77]} />
          <span class="muted small">Task bar</span>
          <ProgressBar value={0.68} label="Indexing" />
          <ProgressBar label="Importing" />
        </div>
        <div class="row">
          <ProgressRing value={0.42} label="42% read" />
          <ProgressRing value={0.75} size={36} stroke={3} showValue label="75% read" />
          <Spinner label="Loading" />
        </div>
        <div class="skeletons">
          <Skeleton cover width="72px" />
          <div class="stack" style:flex="1"><Skeleton height="14px" width="70%" /><Skeleton lines={3} height="10px" /></div>
        </div>
      </div>
    </section>

    <!-- Cards -->
    <section>
      <h2 class="eyebrow">Book cards</h2>
      <div class="covers">
        {#each books as b (b.title)}
          <Card {...b} onclick={() => toast(`Open ${b.title}`)}>
            {#snippet actions()}
              <IconButton icon="more" label="More actions" size="sm" />
            {/snippet}
          </Card>
        {/each}
      </div>
    </section>

    <!-- Colour picker + empty state -->
    <section class="two">
      <div>
        <h2 class="eyebrow">Colour picker</h2>
        <ColorPicker label="Accent" bind:value={color} against={themes[themeId as BuiltinThemeId]?.bg ?? '#000000'} presets={['#e2a85e', '#cb4b16', '#268bd2', '#859900', '#d33682', '#6c71c4']} />
      </div>
      <div class="empty-box">
        <EmptyState size="page" icon="library" title="Your shelves are empty" description="Drop books here, or add a folder and Quire will keep it in sync.">
          {#snippet actions()}
            <Button variant="primary" icon="plus">Add books</Button>
            <Button icon="folder">Watch a folder</Button>
          {/snippet}
        </EmptyState>
      </div>
    </section>
  </main>
</div>

<style>
  .gallery { height: 100vh; overflow: auto; background: var(--bg); }
  .titlebar {
    position: sticky;
    top: 0;
    z-index: var(--z-chrome);
    display: grid;
    grid-template-columns: 1fr minmax(240px, 420px) 1fr;
    align-items: center;
    height: var(--titlebar-h);
    padding-left: var(--space-3);
    background: var(--chrome-bg);
    backdrop-filter: blur(20px) saturate(1.2);
    border-bottom: 1px solid var(--border-soft);
  }
  .tb-left { display: flex; align-items: center; gap: var(--space-2-5); }
  .mark {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: var(--accent);
    color: var(--on-accent);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 600;
  }
  .tb-title { font-size: var(--text-xs); color: var(--muted); }
  .palette-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 28px;
    padding: 0 var(--space-1) 0 var(--space-2-5);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--text) 5%, transparent);
    color: var(--muted);
    font-size: var(--text-xs);
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .palette-trigger:hover { background: color-mix(in oklab, var(--text) 8%, transparent); }
  .palette-trigger span:not(:global(.kbd)) { flex: 1; text-align: left; }
  .tb-right { display: flex; justify-content: flex-end; align-items: center; gap: var(--space-1); height: 100%; }
  .caption-buttons { display: flex; height: 100%; margin-left: var(--space-2); }
  .caption-buttons button { width: 46px; height: 100%; display: grid; place-items: center; color: var(--text); }
  .caption-buttons button:hover { background: var(--hover); }
  .caption-buttons .close:hover { background: #c42b1c; color: #fff; } /* Windows caption close: system red, not a theme colour */

  main { max-width: 1120px; margin: 0 auto; padding: var(--space-12) var(--space-10) var(--space-24); display: flex; flex-direction: column; gap: var(--space-16); }
  section { display: flex; flex-direction: column; gap: var(--space-4); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-10); align-items: start; }
  .stack { display: flex; flex-direction: column; gap: var(--space-4); }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
  .divider { width: 1px; height: 20px; background: var(--border); margin: 0 var(--space-2); }
  .muted { color: var(--muted); }
  .small { font-size: var(--text-xs); }
  .eyebrow {
    margin: 0 0 var(--space-1);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }

  .hero { flex-direction: row; justify-content: space-between; align-items: flex-end; gap: var(--space-8); flex-wrap: wrap; }
  .hero h1 { font-family: var(--font-display); font-size: 44px; font-weight: 500; letter-spacing: -0.02em; }
  .lede { margin-top: var(--space-2); max-width: 46ch; color: var(--muted); font-size: var(--text-md); }
  .hero-controls { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-3); }

  .roles { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--space-3); }
  .role { display: flex; flex-direction: column; gap: var(--space-1-5); }
  .chip { height: 44px; border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--text) 12%, transparent); }
  code { font-family: var(--font-mono); font-size: var(--text-2xs); color: var(--muted); }
  .hl-sample { font-family: var(--font-reading); font-size: 17px; line-height: 1.9; max-width: 72ch; }
  mark { color: inherit; padding: 1px 2px; border-radius: 2px; }
  .sel { background: var(--selection); }

  .scale { display: flex; flex-direction: column; gap: var(--space-2); }
  .display { font-family: var(--font-display); font-weight: 500; letter-spacing: -0.015em; }
  .fonts { display: flex; flex-direction: column; gap: var(--space-3); }
  .fonts li { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-3); border-bottom: 1px solid var(--border-soft); }
  .f-sample { font-size: 22px; }
  .f-meta { font-size: var(--text-xs); }

  .reading-card { background: var(--surface); border: 1px solid var(--border-soft); border-radius: var(--radius-lg); padding: var(--space-6) var(--space-8) var(--space-6); display: flex; flex-direction: column; gap: var(--space-5); }
  .reading-tools { display: flex; justify-content: space-between; gap: var(--space-3); }
  .reading { font-family: var(--font-reading); color: var(--text); }
  .reading p { margin-bottom: var(--para-spacing); text-indent: var(--para-indent); }
  .reading .chapter { font-family: var(--font-ui); font-size: var(--text-2xs); letter-spacing: var(--tracking-caps); text-transform: uppercase; color: var(--muted); text-indent: 0; margin-bottom: var(--space-2); }
  .reading h3 { font-size: 1.5em; font-weight: 500; margin-bottom: 0.8em; }
  .reading-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); padding-top: var(--space-4); border-top: 1px solid var(--border-soft); }

  .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: var(--space-1); }
  .icon-cell { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-1); border-radius: var(--radius-sm); color: var(--text); }
  .icon-cell:hover { background: var(--hover); }
  .icon-cell span { font-size: 10px; color: var(--muted); text-align: center; word-break: break-word; }

  .pop-row { display: flex; gap: var(--space-2-5); justify-content: center; }
  .ctx-target { display: grid; place-items: center; height: 72px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); color: var(--muted); font-size: var(--text-xs); }
  .flyout-static { width: 260px; background: var(--flyout-bg); border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-3); }

  :global(.toc) { height: 252px; border: 1px solid var(--border-soft); }
  .toc-row { display: flex; justify-content: space-between; width: 100%; font-size: var(--text-sm); }
  .toc-row.current { font-weight: var(--weight-medium); }

  .progress-demo { display: grid; grid-template-columns: 2fr 1fr 2fr; gap: var(--space-10); align-items: center; }
  .skeletons { display: flex; gap: var(--space-4); align-items: center; }

  .covers { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-8) var(--space-6); }
  .empty-box { border: 1px solid var(--border-soft); border-radius: var(--radius-lg); }

  @media (max-width: 860px) {
    .two, .progress-demo { grid-template-columns: 1fr; }
    .roles { grid-template-columns: repeat(3, 1fr); }
    main { padding: var(--space-8) var(--space-4); }
  }
</style>
