/** Reactive indexing state for the UI ("Indexing 12 of 40 books"). Call `indexProgress.start()` once at boot. */
import { core, coreEvents } from '../core/core';

class IndexProgress {
  /** Books fully indexed. */
  done = $state(0);
  /** Indexable books. */
  total = $state(0);
  failed = $state(0);
  /** The book being indexed right now. */
  current = $state<string | null>(null);
  /** The user is reading, so indexing is paused. */
  paused = $state(false);
  started = false;

  /** Still work to do (not counting failed books). */
  get active(): boolean {
    return this.done + this.failed < this.total;
  }
  /** 0..1. */
  get fraction(): number {
    return this.total ? (this.done + this.failed) / this.total : 1;
  }

  /** Fetch the current status and follow `index-progress` / `index-control` events. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const s = await core.indexStatus();
    this.set(s.done, s.total, s.failed, null);
    this.paused = s.paused;
    await coreEvents.onIndexProgress((p) => this.set(p.done, p.total, p.failed, p.current));
    await coreEvents.onIndexControl((c) => (this.paused = c.paused));
  }

  private set(done: number, total: number, failed: number, current: string | null) {
    this.done = done;
    this.total = total;
    this.failed = failed;
    this.current = current;
  }
}

export const indexProgress = new IndexProgress();
