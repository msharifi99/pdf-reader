/** In-memory backend for Playwright and browser dev. Typed against `CoreApi`: a missing command fails `tsc`. */
import type { CoreApi, CoreEvents, CoreRuntime, Unlisten } from './core';

type Listener<T> = Set<(v: T) => void>;

export function createFakeRuntime(): CoreRuntime {
  const openFiles: Listener<string[]> = new Set();
  const maxHover: Listener<boolean> = new Set();
  let launchFiles: string[] = [];

  const sub = <T>(set: Listener<T>, cb: (v: T) => void): Promise<Unlisten> => {
    set.add(cb);
    return Promise.resolve(() => void set.delete(cb));
  };

  const api: CoreApi = {
    appVersion: async () => __APP_VERSION__,
    takeLaunchFiles: async () => {
      const f = launchFiles;
      launchFiles = [];
      return f;
    },
    allowPath: async () => true,
    windowBackdrop: async () => 'none',
    windowMinimize: async () => {},
    windowToggleMaximize: async () => {},
    windowClose: async () => {},
    windowToggleFullscreen: async () => {},
    windowStartDrag: async () => {},
    windowSetMaxbtnRect: async () => {},
  };

  const events: CoreEvents = {
    onOpenFiles: (cb) => sub(openFiles, cb),
    onMaxButtonHover: (cb) => sub(maxHover, cb),
  };

  // Test hooks: Playwright drives backend-originated events through this.
  (globalThis as Record<string, unknown>).__QUIRE_FAKE__ = {
    emitOpenFiles: (paths: string[]) => openFiles.forEach((cb) => cb(paths)),
    emitMaxButtonHover: (h: boolean) => maxHover.forEach((cb) => cb(h)),
    setLaunchFiles: (paths: string[]) => (launchFiles = paths),
  };

  return {
    mode: 'fake',
    api,
    events,
    fileUrl: (ref) => ('path' in ref ? `/fixtures/${ref.path.split(/[\/]/).pop()}` : `/fixtures/${ref.bookId}`),
  };
}
