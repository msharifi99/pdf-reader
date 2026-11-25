/**
 * Native window state for the title bar (maximized, fullscreen, focused) and file entry points
 * (Ctrl+O picker, drag-and-drop). Works in Tauri and in a plain browser (fake core).
 */
import { core, coreEvents, isTauri } from '../core/core';
import type { Locator } from '../engines/types';
import { openDocument } from '../stores/app.svelte';
import { commands } from '../commands';
import { presentError } from './errors.svelte';
import { toast } from '../ui';

declare global {
  interface Window {
    /** Set by the core for windows it opens: show this book straight away. */
    __QUIRE_BOOT__?: { bookId?: string; locator?: Locator | null };
  }
}

export const SUPPORTED_EXTENSIONS = [
  'pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'fbz', 'cbz', 'cbr',
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'svg',
];

export const win = $state({ maximized: false, fullscreen: false, focused: true, dragging: false });

export function installWindowState(): () => void {
  const offs: (() => void)[] = [];
  const onFocus = () => (win.focused = true);
  const onBlur = () => (win.focused = false);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  win.focused = document.hasFocus();
  offs.push(() => window.removeEventListener('focus', onFocus), () => window.removeEventListener('blur', onBlur));

  if (isTauri()) {
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      const sync = async () => {
        try {
          win.maximized = await w.isMaximized();
          win.fullscreen = await w.isFullscreen();
        } catch {
          /* getters are in core:default; ignore if denied */
        }
      };
      await sync();
      offs.push(await w.onResized(() => void sync()));
    });
  } else {
    const onFs = () => (win.fullscreen = !!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    offs.push(() => document.removeEventListener('fullscreenchange', onFs));
  }
  return () => offs.forEach((f) => f());
}

export async function toggleFullscreen(): Promise<void> {
  if (isTauri()) {
    await core.windowToggleFullscreen();
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      win.fullscreen = await getCurrentWindow().isFullscreen();
    } catch {
      win.fullscreen = !win.fullscreen;
    }
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen().catch(() => {});
}

/**
 * Open a book in its own window (story 121). The core focuses the window that already shows it.
 * Without a native shell (browser, tests) there is only one window: open it here instead.
 */
export async function openInNewWindow(book: { id: string; path?: string | null; title?: string }, locator?: Locator): Promise<boolean> {
  try {
    if (isTauri()) {
      await core.openBookWindow(book.id, (locator ?? null) as never);
      return true;
    }
  } catch (err) {
    presentError(err, { fileName: book.title });
    return false;
  }
  return book.path ? openDocument(book.path, { locator }) : false;
}

async function openById(id: string, locator?: Locator | null): Promise<void> {
  try {
    const b = await core.getBook(id);
    if (b.available && b.path) await openDocument(b.path, { locator: locator ?? undefined });
  } catch {
    /* the book left the library since: stay on the library */
  }
}

/**
 * What a freshly booted window shows: the book the core opened it for, else the files Quire was
 * launched with (they win over the saved session), else the book it showed last time.
 */
export async function bootOpen(): Promise<void> {
  const boot = window.__QUIRE_BOOT__;
  if (boot?.bookId) return openById(boot.bookId, boot.locator);
  const files = await core.takeLaunchFiles();
  if (files[0]) {
    await openDocument(files[0]);
    return;
  }
  const id = await core.takeSessionBook();
  if (id) await openById(id);
}

/** Palette command: restore the open windows and books on launch (default on). */
export function registerSessionCommands(): () => void {
  return commands.register({
    id: 'app.toggleRestoreSession',
    title: 'Restore windows on launch: toggle',
    category: 'App',
    contexts: ['global'],
    keywords: ['session', 'reopen', 'startup'],
    run: async () => {
      const on = (await core.getSetting('restoreSession')) !== false;
      await core.setSetting('restoreSession', !on as never);
      toast(on ? 'Quire will open to your library next time.' : 'Quire will reopen your windows and books next time.');
    },
  });
}

let fileInput: HTMLInputElement | null = null;

/** The hidden <input type=file> the shell renders (fake mode / browser). */
export function setFileInput(el: HTMLInputElement | null): void {
  fileInput = el;
}

/** Ctrl+O. Tauri: native picker filtered to supported formats. Browser: hidden file input. */
export async function pickAndOpen(): Promise<void> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple: false,
      directory: false,
      title: 'Open a book',
      filters: [
        { name: 'Books, comics and images', extensions: SUPPORTED_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof picked === 'string') await openDocument(picked);
    return;
  }
  fileInput?.click();
}

/** Show the drop target while files hover the window; open what is dropped. */
export function installDragDrop(): () => void {
  const offs: (() => void)[] = [];
  // Tauri: the native layer owns drops (dragDropEnabled) and emits open-files; we only draw the hover.
  if (isTauri()) {
    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      offs.push(
        await getCurrentWebview().onDragDropEvent((e) => {
          const t = e.payload.type;
          win.dragging = t === 'enter' || t === 'over';
        }),
      );
    });
  } else {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      win.dragging = true;
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) win.dragging = false;
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      win.dragging = false;
      const f = e.dataTransfer?.files[0];
      if (f) void openDocument(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    offs.push(() => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    });
  }
  // second launch, Explorer "Open with", native drops
  void coreEvents.onOpenFiles((paths) => {
    win.dragging = false;
    if (paths[0]) void openDocument(paths[0]);
  }).then((un) => offs.push(un));
  return () => offs.forEach((f) => f());
}
