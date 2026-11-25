import type { Engine, EngineFactory } from '../types';

export type { ComicEngine } from './engine';
export { buildSpreads, spreadAt } from './pairing';
export { naturalCompare, sortPages } from './pages';
export { parseComicInfo } from './comicinfo';

/** Lazy factory for the shell: zip.js, libarchive.js and the views load only when a comic is opened. */
export const createComicEngine: EngineFactory = async (): Promise<Engine> => {
  const { ComicEngine } = await import('./engine');
  return new ComicEngine();
};
