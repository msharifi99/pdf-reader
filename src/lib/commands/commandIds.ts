/**
 * Canonical command table: every action in the app, with title/category/contexts.
 * Other modules register implementations with `defineCommand(id, run, enabled?)`.
 * Dynamic ids: `theme.set:<themeId>` (pass `{ title }` in extra).
 */
import type { Command } from './registry';
import type { Context } from './contexts';

export interface CommandMeta {
  id: string;
  title: string;
  category: string;
  contexts: Context[];
  repeatable?: boolean;
  hidden?: boolean;
  keywords?: string[];
}

const R: Context[] = ['reader'];
const RF: Context[] = ['reader.fixed'];
const RR: Context[] = ['reader.reflow'];
const L: Context[] = ['library'];
const G: Context[] = [];

function m(id: string, title: string, category: string, contexts: Context[], extra: Partial<CommandMeta> = {}): CommandMeta {
  return { id, title, category, contexts, ...extra };
}

export const COMMAND_TABLE: readonly CommandMeta[] = [
  // Navigation
  m('reader.nextPage', 'Next page', 'Navigation', R, { repeatable: true, keywords: ['forward', 'turn'] }),
  m('reader.prevPage', 'Previous page', 'Navigation', R, { repeatable: true, keywords: ['back', 'turn'] }),
  m('reader.scrollDown', 'Scroll down', 'Navigation', R, { repeatable: true }),
  m('reader.scrollUp', 'Scroll up', 'Navigation', R, { repeatable: true }),
  m('reader.nextChapter', 'Next chapter', 'Navigation', R),
  m('reader.prevChapter', 'Previous chapter', 'Navigation', R),
  m('reader.goToStart', 'Go to start', 'Navigation', R, { keywords: ['beginning', 'first', 'top'] }),
  m('reader.goToEnd', 'Go to end', 'Navigation', R, { keywords: ['last', 'bottom'] }),
  m('reader.goTo', 'Go to page, percentage or chapter', 'Navigation', R, { keywords: ['jump'] }),
  m('reader.historyBack', 'Back in history', 'Navigation', R),
  m('reader.historyForward', 'Forward in history', 'Navigation', R),
  // View
  m('reader.toggleToc', 'Toggle table of contents', 'View', R, { keywords: ['chapters', 'outline', 'sidebar'] }),
  m('reader.toggleThumbnails', 'Toggle page thumbnails', 'View', RF, { keywords: ['sidebar', 'pages'] }),
  m('reader.toggleFlow', 'Toggle paginated / scrolled', 'View', RR, { keywords: ['flow', 'layout'] }),
  m('reader.toggleSpread', 'Toggle two-page spread', 'View', R, { keywords: ['double', 'facing'] }),
  m('reader.zoomIn', 'Zoom in', 'View', RF, { repeatable: true }),
  m('reader.zoomOut', 'Zoom out', 'View', RF, { repeatable: true }),
  m('reader.zoomReset', 'Reset zoom', 'View', RF),
  m('reader.fitWidth', 'Fit width', 'View', RF),
  m('reader.fitPage', 'Fit page', 'View', RF),
  m('reader.actualSize', 'Actual size', 'View', RF, { keywords: ['100%'] }),
  m('reader.rotate', 'Rotate page', 'View', RF),
  m('reader.textBigger', 'Increase text size', 'View', RR, { repeatable: true, keywords: ['font', 'larger'] }),
  m('reader.textSmaller', 'Decrease text size', 'View', RR, { repeatable: true, keywords: ['font', 'smaller'] }),
  m('reader.textReset', 'Reset text size', 'View', RR, { keywords: ['font'] }),
  m('reader.pageTint.smart', 'Page tint: Smart', 'View', RF, { keywords: ['dark', 'recolour'] }),
  m('reader.pageTint.invert', 'Page tint: Invert', 'View', RF, { keywords: ['dark', 'negative'] }),
  m('reader.pageTint.original', 'Page tint: Original', 'View', RF, { keywords: ['none', 'off'] }),
  // Search
  m('reader.find', 'Find in book', 'Search', R, { keywords: ['search'] }),
  m('reader.findNext', 'Next match', 'Search', R),
  m('reader.findPrev', 'Previous match', 'Search', R),
  m('reader.closeFind', 'Close find', 'Search', R, { hidden: true }),
  // Reading tools
  m('reader.toggleFocus', 'Toggle focus mode', 'Reading', R, { keywords: ['zen', 'distraction'] }),
  m('reader.toggleRuler', 'Toggle reading ruler', 'Reading', R, { keywords: ['line focus'] }),
  m('reader.toggleAutoScroll', 'Toggle auto-scroll', 'Reading', R),
  m('reader.autoScrollFaster', 'Auto-scroll faster', 'Reading', R, { repeatable: true }),
  m('reader.autoScrollSlower', 'Auto-scroll slower', 'Reading', R, { repeatable: true }),
  m('reader.readAloud', 'Read aloud', 'Reading', R, { keywords: ['speech', 'tts', 'listen'] }),
  // Annotations
  m('annotate.highlightYellow', 'Highlight yellow', 'Annotations', R),
  m('annotate.highlightGreen', 'Highlight green', 'Annotations', R),
  m('annotate.highlightBlue', 'Highlight blue', 'Annotations', R),
  m('annotate.highlightPink', 'Highlight pink', 'Annotations', R),
  m('annotate.note', 'Add note', 'Annotations', R),
  m('annotate.bookmark', 'Bookmark this position', 'Annotations', R),
  m('annotate.togglePanel', 'Toggle annotations panel', 'Annotations', R, { keywords: ['highlights', 'notes', 'bookmarks'] }),
  m('annotate.exportMarkdown', 'Export annotations to Markdown', 'Annotations', R, { keywords: ['obsidian'] }),
  m('annotate.copyQuote', 'Copy highlight as quote', 'Annotations', R, { keywords: ['citation'] }),
  // App
  m('app.openPalette', 'Open command palette', 'App', G, { hidden: true }),
  m('app.openFile', 'Open file', 'App', G),
  m('app.switchBook', 'Switch book', 'App', G, { keywords: ['library', 'recent'] }),
  m('app.settings', 'Open settings', 'App', G, { keywords: ['preferences', 'options'] }),
  m('app.toggleFullscreen', 'Toggle fullscreen', 'App', G),
  m('app.cheatSheet', 'Show keyboard shortcuts', 'App', G, { keywords: ['help', 'cheat sheet'] }),
  m('app.back', 'Close / back', 'App', G, { hidden: true }),
  m('app.undo', 'Undo', 'App', G),
  m('app.redo', 'Redo', 'App', G),
  m('app.newWindow', 'Open in new window', 'App', G),
  // Appearance
  m('theme.next', 'Next theme', 'Appearance', G, { keywords: ['dark', 'light', 'colour'] }),
  // Library
  m('library.open', 'Open selected book', 'Library', L),
  m('library.openInNewWindow', 'Open selected book in new window', 'Library', L),
  m('library.moveLeft', 'Move selection left', 'Library', L, { repeatable: true, hidden: true }),
  m('library.moveRight', 'Move selection right', 'Library', L, { repeatable: true, hidden: true }),
  m('library.moveUp', 'Move selection up', 'Library', L, { repeatable: true, hidden: true }),
  m('library.moveDown', 'Move selection down', 'Library', L, { repeatable: true, hidden: true }),
  m('library.first', 'Select first book', 'Library', L, { hidden: true }),
  m('library.last', 'Select last book', 'Library', L, { hidden: true }),
  m('library.remove', 'Remove from library', 'Library', L),
  m('library.editMetadata', 'Edit book details', 'Library', L, { keywords: ['title', 'author', 'cover'] }),
  m('library.focusSearch', 'Search library', 'Library', L),
  m('library.revealInExplorer', 'Reveal in Explorer', 'Library', L),
  m('library.markFinished', 'Mark as finished', 'Library', L),
  m('library.markUnread', 'Mark as unread', 'Library', L),
  m('library.toggleView', 'Toggle grid / list view', 'Library', L),
  m('library.addFolder', 'Add watched folder', 'Library', L),
  m('library.newCollection', 'New collection', 'Library', L),
  // Comics
  m('comic.left', 'Left page (direction aware)', 'Comic', ['comic'], { repeatable: true, hidden: true }),
  m('comic.right', 'Right page (direction aware)', 'Comic', ['comic'], { repeatable: true, hidden: true }),
  m('comic.toggleDirection', 'Toggle right-to-left reading', 'Comic', ['comic'], { keywords: ['manga', 'rtl'] }),
  m('comic.modeSingle', 'Comic: single page', 'Comic', ['comic']),
  m('comic.modeDouble', 'Comic: double page', 'Comic', ['comic']),
  m('comic.modeWebtoon', 'Comic: webtoon (vertical scroll)', 'Comic', ['comic']),
  // Dialogs
  m('dialog.confirm', 'Confirm dialog', 'App', ['dialog'], { hidden: true })
];

const BY_ID = new Map(COMMAND_TABLE.map((c) => [c.id, c]));
export const COMMAND_IDS: readonly string[] = COMMAND_TABLE.map((c) => c.id);

export function commandMeta(id: string): CommandMeta | undefined {
  return BY_ID.get(id);
}

/** Dynamic id prefixes that have no table row (title must come from `extra`). */
const DYNAMIC_PREFIXES = ['theme.set:'];

/**
 * Build a Command for a table id. Throws on unknown ids (typo guard).
 * `extra` overrides/extends the table entry (needed for dynamic ids like `theme.set:solarized`).
 */
export function defineCommand(
  id: string,
  run: Command['run'],
  enabled?: Command['enabled'],
  extra: Partial<Omit<Command, 'id' | 'run' | 'enabled'>> = {}
): Command {
  const meta = BY_ID.get(id);
  if (!meta && !DYNAMIC_PREFIXES.some((p) => id.startsWith(p))) throw new Error(`Unknown command id "${id}"`);
  return {
    id,
    title: meta?.title ?? id,
    category: meta?.category ?? 'Appearance',
    contexts: meta?.contexts ?? [],
    repeatable: meta?.repeatable,
    hidden: meta?.hidden,
    keywords: meta?.keywords,
    run,
    enabled,
    ...extra
  };
}
