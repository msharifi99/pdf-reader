// Entry of the hidden `indexer` window (indexer.html). No UI: loop over books needing an index.
import { coreEvents, initCore } from '../core/core';
import { PauseGate, runIndexer } from './indexer';

/** Reload after this many books so the renderer sheds whatever the engines leaked. */
const BOOKS_PER_LIFETIME = 25;
const RECHECK_MS = 90_000;

await initCore();
const gate = new PauseGate();
await gate.start();

let wake: (() => void) | null = null;
await coreEvents.onLibraryChanged(() => setTimeout(() => wake?.(), 3000)); // new books: let the scan settle first
const idle = () => new Promise<void>((r) => { const t = setTimeout(r, RECHECK_MS); wake = () => { clearTimeout(t); r(); }; });

for (;;) {
  const outcome = await runIndexer({
    gate,
    restartAfter: BOOKS_PER_LIFETIME,
    onBook: (b, o) => console.info('[indexer]', b.title, 'error' in o ? `failed: ${o.error}` : `${o.chunks} chunks`),
  });
  if (outcome === 'restart') {
    location.reload();
    break;
  }
  await idle();
}
