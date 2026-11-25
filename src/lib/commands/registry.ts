import { isWithin, type Context } from './contexts';

export interface Command {
  id: string;
  title: string;
  category: string;
  /** where the command is relevant (palette filtering). [] = everywhere. A context also covers its descendants. */
  contexts: Context[];
  run(args?: unknown): unknown | Promise<unknown>;
  enabled?(state: unknown): boolean;
  keywords?: string[];
  icon?: string;
  hidden?: boolean;
  /** key auto-repeat may re-run it (movement, zoom). Toggles are not repeatable. */
  repeatable?: boolean;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
export interface ExecuteEvent {
  id: string;
  args: unknown;
  ok: boolean;
  error?: unknown;
}
export interface RegistryOptions {
  /** MRU persistence. Default: localStorage when available, else in-memory. Pass null to disable. */
  storage?: StorageLike | null;
  mruKey?: string;
  mruMax?: number;
  getState?: () => unknown;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class CommandRegistry {
  #cmds = new Map<string, Command>();
  #subs = new Set<() => void>();
  #execSubs = new Set<(e: ExecuteEvent) => void>();
  #errSubs = new Set<(err: unknown, cmd: Command | undefined) => void>();
  #mru: string[] = [];
  #storage: StorageLike | null;
  #mruKey: string;
  #mruMax: number;
  #getState: () => unknown;

  constructor(opts: RegistryOptions = {}) {
    this.#storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.#mruKey = opts.mruKey ?? 'quire.commands.mru';
    this.#mruMax = opts.mruMax ?? 30;
    this.#getState = opts.getState ?? (() => undefined);
    try {
      const raw = this.#storage?.getItem(this.#mruKey);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) this.#mru = arr.filter((x): x is string => typeof x === 'string').slice(0, this.#mruMax);
    } catch {
      /* corrupt storage: start empty */
    }
  }

  setStateProvider(fn: () => unknown): void {
    this.#getState = fn;
  }

  /** Register one or many commands. A later registration of the same id replaces the earlier one. */
  register(cmd: Command | Command[]): () => void {
    const list = Array.isArray(cmd) ? cmd : [cmd];
    for (const c of list) this.#cmds.set(c.id, c);
    this.#emit();
    return () => {
      let changed = false;
      for (const c of list) if (this.#cmds.get(c.id) === c) changed = this.#cmds.delete(c.id) || changed;
      if (changed) this.#emit();
    };
  }

  get(id: string): Command | undefined {
    return this.#cmds.get(id);
  }
  has(id: string): boolean {
    return this.#cmds.has(id);
  }

  /** Commands relevant in `context` (or all). Hidden ones are excluded unless includeHidden. */
  list(context?: Context, opts: { includeHidden?: boolean } = {}): Command[] {
    const out: Command[] = [];
    for (const c of this.#cmds.values()) {
      if (c.hidden && !opts.includeHidden) continue;
      if (context && c.contexts.length && !c.contexts.some((cc) => isWithin(context, cc))) continue;
      out.push(c);
    }
    return out;
  }

  isEnabled(id: string): boolean {
    const c = this.#cmds.get(id);
    if (!c) return false;
    if (!c.enabled) return true;
    try {
      return !!c.enabled(this.#getState());
    } catch (err) {
      this.#emitError(err, c);
      return false;
    }
  }

  isRepeatable(id: string): boolean {
    return !!this.#cmds.get(id)?.repeatable;
  }

  /** Never throws. Resolves false when unknown, disabled, or the command failed. */
  async execute(id: string, args?: unknown): Promise<boolean> {
    const c = this.#cmds.get(id);
    if (!c || !this.isEnabled(id)) return false;
    try {
      await c.run(args);
    } catch (error) {
      this.#emitError(error, c);
      this.#emitExec({ id, args, ok: false, error });
      return false;
    }
    this.#touch(id);
    this.#emitExec({ id, args, ok: true });
    return true;
  }

  /** Most recently used command ids that are still registered, newest first. */
  recent(limit = 10): string[] {
    return this.#mru.filter((id) => this.#cmds.has(id)).slice(0, limit);
  }
  /** 0 = most recent, -1 = never used. */
  recencyRank(id: string): number {
    return this.#mru.indexOf(id);
  }
  clearRecent(): void {
    this.#mru = [];
    this.#persist();
    this.#emit();
  }

  onExecute(fn: (e: ExecuteEvent) => void): () => void {
    this.#execSubs.add(fn);
    return () => this.#execSubs.delete(fn);
  }
  onError(fn: (err: unknown, cmd: Command | undefined) => void): () => void {
    this.#errSubs.add(fn);
    return () => this.#errSubs.delete(fn);
  }
  /** Fires on register / unregister / MRU change. */
  subscribe(fn: () => void): () => void {
    this.#subs.add(fn);
    return () => this.#subs.delete(fn);
  }

  #touch(id: string) {
    this.#mru = [id, ...this.#mru.filter((x) => x !== id)].slice(0, this.#mruMax);
    this.#persist();
    this.#emit();
  }
  #persist() {
    try {
      this.#storage?.setItem(this.#mruKey, JSON.stringify(this.#mru));
    } catch {
      /* quota / unavailable */
    }
  }
  #emit() {
    for (const s of [...this.#subs]) this.#safe(() => s());
  }
  #emitExec(e: ExecuteEvent) {
    for (const s of [...this.#execSubs]) this.#safe(() => s(e));
  }
  #emitError(err: unknown, cmd: Command | undefined) {
    if (!this.#errSubs.size) {
      console.error(`[commands] ${cmd?.id ?? '?'} failed`, err);
      return;
    }
    for (const s of [...this.#errSubs]) this.#safe(() => s(err, cmd));
  }
  #safe(fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.error('[commands] listener threw', err);
    }
  }
}
