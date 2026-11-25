<!--
  Annotations for the open book. Mounted per open book through `addReaderOverlay` (see index.ts),
  so everything here lives exactly as long as the book: store, commands, panel, palette picker,
  decorations, and the floating menu / popover / ribbon.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { commands, defineCommand, rankItems, type Command } from '../commands';
  import { readerApi, setReaderPanel } from '../reader/slots.svelte';
  import { registerPaletteProvider, openPalette } from '../shell/palette/providers.svelte';
  import { coreMode } from '../core/core';
  import { Annotator } from './controller.svelte';
  import { passage } from './model';
  import SelectionMenu from './SelectionMenu.svelte';
  import HighlightPopover from './HighlightPopover.svelte';
  import BookmarkRibbon from './BookmarkRibbon.svelte';
  import AnnotationsPanel from './AnnotationsPanel.svelte';

  const session = readerApi.session!;
  const ctl = new Annotator(session);
  const library = !/^(file|path):/.test(session.book.id); // ad-hoc files have no core record

  // decorations follow the store
  $effect(() => {
    void ctl.store.items;
    void ctl.store.orphans;
    void ctl.verified;
    untrack(() => session.decorate('annotations', ctl.decorations()));
  });

  onMount(() => {
    const e = session.engine!;
    const hasSel = () => library && !!session.selection;
    const color = (c: 'yellow' | 'green' | 'blue' | 'pink') => () => void ctl.highlight(c);
    const find: Command = {
      id: 'annotate.find',
      title: 'Go to annotationâ€¦',
      category: 'Annotations',
      contexts: ['reader'],
      keywords: ['highlights', 'notes', 'bookmarks', 'jump'],
      run: () => openPalette({ mode: 'annotations' }),
    };
    const offs = [
      commands.register([
        defineCommand('annotate.highlightYellow', color('yellow'), hasSel),
        defineCommand('annotate.highlightGreen', color('green'), hasSel),
        defineCommand('annotate.highlightBlue', color('blue'), hasSel),
        defineCommand('annotate.highlightPink', color('pink'), hasSel),
        defineCommand('annotate.note', () => ctl.note(), () => hasSel() || !!ctl.popover),
        defineCommand('annotate.bookmark', () => ctl.toggleBookmark(), () => library && !!session.location),
        defineCommand('annotate.togglePanel', () => readerApi.togglePanel('annotations')),
        defineCommand('annotate.exportMarkdown', () => ctl.exportMarkdown(), () => ctl.store.items.length > 0),
        defineCommand('annotate.copyQuote', () => ctl.copyQuote(), () => hasSel() || !!ctl.popover),
        defineCommand('app.undo', () => ctl.undo(), () => ctl.store.canUndo),
        defineCommand('app.redo', () => ctl.redo(), () => ctl.store.canRedo),
        find,
      ]),
      setReaderPanel({ id: 'annotations', title: 'Annotations', body: panel, width: 360 }),
      registerPaletteProvider({
        mode: 'annotations',
        label: 'Annotations',
        placeholder: 'Find a highlight, note or bookmark',
        emptyText: ctl.store.items.length ? 'No annotation matches' : 'No highlights in this book yet',
        query: (q) =>
          rankItems(ctl.store.items, q.text, { fields: (a) => [a.label ?? passage(a), a.note ?? ''] }).map(({ item: a }) => ({
            id: a.id,
            title: a.label ?? (passage(a) || 'Bookmark'),
            detail: [a.note ? 'Note' : '', ctl.where(a.anchor.locator)].filter(Boolean).join(' Â· '),
            group: ctl.chapter(a.anchor.locator) || undefined,
            icon: a.type === 'bookmark' ? 'bookmark' : a.type === 'note' ? 'note' : 'highlight',
            run: () => ctl.jump(a),
          })),
      }),
      e.on('decorationclick', (d) => {
        if (d.layer === 'annotations') ctl.openPopover(d.id, ctl.toViewport(d.rect));
      }),
      e.on('pointer', (p) => {
        if (p.button !== 0 || session.kind !== 'comic') return; // reflow and pdf report decorationclick
        void ctl.hitTest(p.x, p.y).then((h) => h && ctl.openPopover(h.id, ctl.toViewport(h.rect)));
      }),
    ];
    if (coreMode() === 'fake') (globalThis as Record<string, unknown>).__QUIRE_ANNOTATIONS__ = ctl;
    if (library)
      void ctl.store.load().then(
        () => void ctl.reanchorAll(),
        (err) => console.warn('[annotations] load failed', err),
      );
    return () => {
      offs.forEach((f) => f());
      ctl.dispose();
      if ((globalThis as Record<string, unknown>).__QUIRE_ANNOTATIONS__ === ctl) delete (globalThis as Record<string, unknown>).__QUIRE_ANNOTATIONS__;
    };
  });
</script>

{#snippet panel()}
  <AnnotationsPanel {ctl} />
{/snippet}

{#if library}
  <SelectionMenu {ctl} />
  <BookmarkRibbon {ctl} />
  {#if ctl.popover}<HighlightPopover {ctl} />{/if}
{/if}
