import type { Engine, EngineFactory } from '../types';

export type { ReflowEngine, ReflowOptions } from './engine';
export { buildStyles, layoutAttrs, columnCount } from './stylesheet';

/** Lazy factory for the shell: foliate-js and zip.js load only when a reflowable book is opened. */
export const createReflowEngine: EngineFactory = async (): Promise<Engine> => {
  const { ReflowEngine } = await import('./engine');
  return new ReflowEngine();
};
