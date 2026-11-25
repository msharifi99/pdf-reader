/**
 * Default keymap (data). User changes are stored as a diff against this list, so editing it ships new defaults.
 * `keys` may be a sequence ("g g") or several alternatives. Bare "G" means Shift+G.
 */
import type { DefaultBinding } from './keymap';

const noInput = { allowInInput: false } as const;

export const DEFAULT_BINDINGS: readonly DefaultBinding[] = [
  // ---- global ----
  { context: 'global', keys: 'Ctrl+K', command: 'app.openPalette', allowInInput: true, inDialog: true },
  { context: 'global', keys: 'Ctrl+O', command: 'app.openFile' },
  { context: 'global', keys: 'Ctrl+P', command: 'app.switchBook' },
  { context: 'global', keys: 'Ctrl+,', command: 'app.settings' },
  { context: 'global', keys: 'F11', command: 'app.toggleFullscreen', inDialog: true },
  { context: 'global', keys: '?', command: 'app.cheatSheet' },
  { context: 'global', keys: 'Escape', command: 'app.back', allowInInput: true, inDialog: true },
  { context: 'global', keys: 'Ctrl+Z', command: 'app.undo', ...noInput },
  { context: 'global', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], command: 'app.redo', ...noInput },
  { context: 'global', keys: 'Ctrl+Shift+N', command: 'app.newWindow' },

  // ---- library ----
  { context: 'library', keys: 'Left', command: 'library.moveLeft' },
  { context: 'library', keys: 'Right', command: 'library.moveRight' },
  { context: 'library', keys: 'Up', command: 'library.moveUp' },
  { context: 'library', keys: 'Down', command: 'library.moveDown' },
  { context: 'library', keys: 'Home', command: 'library.first' },
  { context: 'library', keys: 'End', command: 'library.last' },
  { context: 'library', keys: 'Enter', command: 'library.open' },
  { context: 'library', keys: 'Ctrl+Enter', command: 'library.openInNewWindow' },
  { context: 'library', keys: 'Delete', command: 'library.remove' },
  { context: 'library', keys: 'F2', command: 'library.editMetadata' },
  { context: 'library', keys: ['Ctrl+L', '/'], command: 'library.focusSearch' },

  // ---- reader (all formats) ----
  { context: 'reader', keys: ['Right', 'PageDown', 'Space'], command: 'reader.nextPage' },
  { context: 'reader', keys: ['Left', 'PageUp', 'Shift+Space'], command: 'reader.prevPage' },
  { context: 'reader', keys: ['Down', 'j'], command: 'reader.scrollDown' },
  { context: 'reader', keys: ['Up', 'k'], command: 'reader.scrollUp' },
  { context: 'reader', keys: ['Home', 'g g'], command: 'reader.goToStart' },
  { context: 'reader', keys: ['End', 'G'], command: 'reader.goToEnd' },
  { context: 'reader', keys: 'Ctrl+G', command: 'reader.goTo' },
  { context: 'reader', keys: 'Alt+Left', command: 'reader.historyBack' },
  { context: 'reader', keys: 'Alt+Right', command: 'reader.historyForward' },
  { context: 'reader', keys: 'Ctrl+F', command: 'reader.find', allowInInput: true },
  { context: 'reader', keys: 'F3', command: 'reader.findNext' },
  { context: 'reader', keys: 'Shift+F3', command: 'reader.findPrev' },
  { context: 'reader', keys: 't', command: 'reader.toggleToc' },
  { context: 'reader', keys: 'f', command: 'reader.toggleFocus' },
  { context: 'reader', keys: 'r', command: 'reader.toggleRuler' },
  { context: 'reader', keys: 's', command: 'reader.toggleAutoScroll' },
  { context: 'reader', keys: ']', command: 'reader.autoScrollFaster' },
  { context: 'reader', keys: '[', command: 'reader.autoScrollSlower' },
  { context: 'reader', keys: 'Ctrl+Shift+S', command: 'reader.readAloud' },
  { context: 'reader', keys: 'Ctrl+B', command: 'annotate.bookmark' },
  { context: 'reader', keys: '1', command: 'annotate.highlightYellow' },
  { context: 'reader', keys: '2', command: 'annotate.highlightGreen' },
  { context: 'reader', keys: '3', command: 'annotate.highlightBlue' },
  { context: 'reader', keys: '4', command: 'annotate.highlightPink' },
  { context: 'reader', keys: 'n', command: 'annotate.note' },
  { context: 'reader', keys: 'a', command: 'annotate.togglePanel' },
  { context: 'reader', keys: 'Ctrl+Shift+C', command: 'annotate.copyQuote' },

  // ---- find bar (pushed on top of a reader context) ----
  { context: 'find', keys: 'Enter', command: 'reader.findNext', allowInInput: true },
  { context: 'find', keys: 'Shift+Enter', command: 'reader.findPrev', allowInInput: true },
  { context: 'find', keys: 'Escape', command: 'reader.closeFind', allowInInput: true },

  // ---- fixed layout (PDF, images; comics inherit) ----
  { context: 'reader.fixed', keys: ['Ctrl+Plus', 'Ctrl+='], command: 'reader.zoomIn' },
  { context: 'reader.fixed', keys: 'Ctrl+-', command: 'reader.zoomOut' },
  { context: 'reader.fixed', keys: 'Ctrl+0', command: 'reader.zoomReset' },
  { context: 'reader.fixed', keys: 'Ctrl+1', command: 'reader.fitWidth' },
  { context: 'reader.fixed', keys: 'Ctrl+2', command: 'reader.fitPage' },
  { context: 'reader.fixed', keys: 'Ctrl+3', command: 'reader.actualSize' },
  { context: 'reader.fixed', keys: 'Shift+R', command: 'reader.rotate' },
  { context: 'reader.fixed', keys: 'Shift+T', command: 'reader.toggleThumbnails' },

  // ---- reflowable (text size instead of zoom) ----
  { context: 'reader.reflow', keys: ['Ctrl+Plus', 'Ctrl+='], command: 'reader.textBigger' },
  { context: 'reader.reflow', keys: 'Ctrl+-', command: 'reader.textSmaller' },
  { context: 'reader.reflow', keys: 'Ctrl+0', command: 'reader.textReset' },

  // ---- comic: Left/Right are direction aware (the command checks RTL) ----
  { context: 'comic', keys: 'Left', command: 'comic.left' },
  { context: 'comic', keys: 'Right', command: 'comic.right' },

  // ---- dialog ----
  { context: 'dialog', keys: 'Ctrl+Enter', command: 'dialog.confirm', allowInInput: true }
];
