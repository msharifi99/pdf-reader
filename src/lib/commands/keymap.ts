import { ancestors, buildChain, isContext, type Chain, type Context } from './contexts';
import { formatSequence, parseSequence, splitStep } from './keys';

export interface DefaultBinding {
  context: Context;
  keys: string | string[];
  command: string;
  /** fire even when focus is in an input/textarea/contenteditable. Inferred when omitted (see inferAllowInInput). */
  allowInInput?: boolean;
  /** (global only) stays active while a dialog is open */
  inDialog?: boolean;
}

export interface Binding {
  context: Context;
  /** canonical, steps joined by a space */
  sequence: string;
  steps: string[];
  command: string;
  allowInInput: boolean;
  inDialog: boolean;
  isDefault: boolean;
}

/** Persisted user customisation: only the difference from the shipped defaults. */
export interface KeymapDiff {
  version?: 1;
  added: { context: Context; keys: string; command: string; allowInInput?: boolean; inDialog?: boolean }[];
  removed: { context: Context; keys: string; command: string }[];
}

export type KeyResult =
  | { type: 'none'; before?: Binding }
  | { type: 'cancel'; before?: Binding }
  | { type: 'pending'; steps: string[]; before?: Binding }
  | { type: 'run'; binding: Binding; command: string; sequence: string; before?: Binding };

export interface HandleOptions {
  chain: Chain;
  inInput?: boolean;
  /** commands that are unknown/disabled are ignored so keys fall through to less specific bindings */
  isRunnable?: (commandId: string) => boolean;
}

export interface Conflict {
  /** exact: same sequence. prefix: the new sequence is a prefix of this existing one. extends: an existing one is a prefix of the new sequence. */
  kind: 'exact' | 'prefix' | 'extends';
  context: Context;
  sequence: string;
  command: string;
}

export interface ActiveBinding {
  sequence: string;
  label: string;
  command: string;
  context: Context;
}

/** Bindings with Ctrl/Alt/Meta, Escape and F-keys work while typing; plain keys and Shift+key do not. */
export function inferAllowInInput(firstStep: string): boolean {
  const p = splitStep(firstStep);
  return p.ctrl || p.alt || p.meta || p.key === 'Escape' || /^F\d+$/.test(p.key);
}

const bkey = (c: Context, seq: string, cmd: string) => `${c}|${seq}|${cmd}`;

function makeBinding(context: Context, seq: string, command: string, o: { allowInInput?: boolean; inDialog?: boolean }, isDefault: boolean): Binding {
  const steps = parseSequence(seq);
  if (!steps) throw new Error(`Invalid key sequence "${seq}"`);
  return {
    context,
    steps,
    sequence: steps.join(' '),
    command,
    allowInInput: o.allowInInput ?? inferAllowInInput(steps[0]!),
    inDialog: !!o.inDialog,
    isDefault
  };
}

export class Keymap {
  #defaults: Binding[] = [];
  #added: Binding[] = [];
  #removed = new Map<string, { context: Context; keys: string; command: string }>();
  #effective: Binding[] = [];
  #byContext = new Map<Context, Binding[]>();
  #timeoutMs: number;

  #pending: string[] = [];
  #fallback: Binding | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  #changeSubs = new Set<() => void>();
  #pendingSubs = new Set<(p: string[]) => void>();
  #fireSubs = new Set<(b: Binding) => void>();

  constructor(defaults: readonly DefaultBinding[], opts: { timeoutMs?: number } = {}) {
    this.#timeoutMs = opts.timeoutMs ?? 1000;
    const seen = new Set<string>();
    for (const d of defaults) {
      for (const k of Array.isArray(d.keys) ? d.keys : [d.keys]) {
        const b = makeBinding(d.context, k, d.command, d, true);
        const key = bkey(b.context, b.sequence, b.command);
        if (!seen.has(key)) {
          seen.add(key);
          this.#defaults.push(b);
        }
      }
    }
    this.#rebuild(false);
  }

  // ---------- queries ----------

  get bindings(): readonly Binding[] {
    return this.#effective;
  }
  get pending(): readonly string[] {
    return this.#pending;
  }
  /** e.g. "g …" for the UI */
  get pendingLabel(): string {
    return this.#pending.length ? formatSequence(this.#pending) + ' …' : '';
  }

  bindingsFor(commandId: string): Binding[] {
    return this.#effective.filter((b) => b.command === commandId);
  }

  /** Best shortcut label for a command, preferring bindings reachable in `chain`. */
  shortcutFor(commandId: string, chain?: Chain): string | undefined {
    const all = this.bindingsFor(commandId);
    if (!all.length) return undefined;
    let best = all;
    if (chain) {
      const reachable = all.filter((b) => chain.contexts.includes(b.context) && !(b.context === 'global' && chain.restrictGlobal && !b.inDialog));
      if (reachable.length) best = reachable.sort((a, b) => chain.contexts.indexOf(a.context) - chain.contexts.indexOf(b.context));
    }
    return formatSequence(best[0]!.steps);
  }

  /** Winning bindings visible from a context stack (or prebuilt chain): shadowed ones are omitted. For the "?" overlay. */
  activeBindings(stackOrChain: readonly Context[] | Chain): ActiveBinding[] {
    const chain = Array.isArray(stackOrChain) ? buildChain(stackOrChain as Context[]) : (stackOrChain as Chain);
    const taken = new Set<string>();
    const out: ActiveBinding[] = [];
    for (const ctx of chain.contexts) {
      const claimedHere: string[] = [];
      for (const b of this.#byContext.get(ctx) ?? []) {
        if (ctx === 'global' && chain.restrictGlobal && !b.inDialog) continue;
        if (taken.has(b.sequence)) continue;
        claimedHere.push(b.sequence);
        out.push({ sequence: b.sequence, label: formatSequence(b.steps), command: b.command, context: ctx });
      }
      for (const s of claimedHere) taken.add(s);
    }
    return out;
  }

  // ---------- conflicts ----------

  /** Existing bindings that clash with binding `sequence` in `context` (checks the context and its ancestors, incl. global). */
  findConflicts(context: Context, sequence: string, opts: { command?: string } = {}): Conflict[] {
    const steps = parseSequence(sequence);
    if (!steps) return [];
    const out: Conflict[] = [];
    for (const ctx of ancestors(context)) {
      for (const b of this.#byContext.get(ctx) ?? []) {
        const n = Math.min(b.steps.length, steps.length);
        let same = true;
        for (let i = 0; i < n; i++) if (b.steps[i] !== steps[i]) { same = false; break; }
        if (!same) continue;
        let kind: Conflict['kind'];
        if (b.steps.length === steps.length) {
          if (opts.command && b.command === opts.command) continue;
          kind = 'exact';
        } else kind = b.steps.length > steps.length ? 'prefix' : 'extends';
        out.push({ kind, context: ctx, sequence: b.sequence, command: b.command });
      }
    }
    return out;
  }

  // ---------- mutation ----------

  /** Add a binding. No-op if already effective. Throws on invalid sequences. Does not resolve conflicts. */
  bind(context: Context, sequence: string, command: string, o: { allowInInput?: boolean; inDialog?: boolean } = {}): Binding {
    const b = makeBinding(context, sequence, command, o, false);
    const key = bkey(b.context, b.sequence, b.command);
    const existing = this.#effective.find((x) => bkey(x.context, x.sequence, x.command) === key);
    if (existing) return existing;
    const def = this.#defaults.find((x) => bkey(x.context, x.sequence, x.command) === key);
    if (def && this.#removed.has(key)) this.#removed.delete(key);
    else this.#added.push(b);
    this.#rebuild();
    return this.#effective.find((x) => bkey(x.context, x.sequence, x.command) === key)!;
  }

  unbind(context: Context, sequence: string, command: string): boolean {
    const steps = parseSequence(sequence);
    if (!steps) return false;
    const key = bkey(context, steps.join(' '), command);
    const ai = this.#added.findIndex((x) => bkey(x.context, x.sequence, x.command) === key);
    if (ai >= 0) this.#added.splice(ai, 1);
    else if (this.#defaults.some((x) => bkey(x.context, x.sequence, x.command) === key) && !this.#removed.has(key)) this.#removed.set(key, { context, keys: steps.join(' '), command });
    else return false;
    this.#rebuild();
    return true;
  }

  unbindCommand(command: string): void {
    for (const b of this.bindingsFor(command)) this.unbind(b.context, b.sequence, b.command);
  }

  /**
   * Shortcut-editor "swap": give `command` the sequence (in `context`), and hand the displaced exact-conflict
   * commands the sequence `command` is giving up (`oldSequence`), if any. Prefix conflicts are left to the caller.
   */
  swap(context: Context, sequence: string, command: string, oldSequence?: string): void {
    const exact = this.findConflicts(context, sequence, { command }).filter((c) => c.kind === 'exact');
    for (const c of exact) this.unbind(c.context, c.sequence, c.command);
    if (oldSequence) this.unbind(context, oldSequence, command);
    this.bind(context, sequence, command);
    if (oldSequence) for (const c of exact) this.bind(context, oldSequence, c.command);
  }

  resetCommand(command: string): void {
    this.#added = this.#added.filter((b) => b.command !== command);
    for (const [k, v] of [...this.#removed]) if (v.command === command) this.#removed.delete(k);
    this.#rebuild();
  }
  resetAll(): void {
    this.#added = [];
    this.#removed.clear();
    this.#rebuild();
  }
  /** true if the user changed anything for this command */
  isModified(command: string): boolean {
    return this.#added.some((b) => b.command === command) || [...this.#removed.values()].some((v) => v.command === command);
  }

  serialize(): KeymapDiff {
    const added = this.#added.map((b) => ({
      context: b.context,
      keys: b.sequence,
      command: b.command,
      ...(b.allowInInput !== inferAllowInInput(b.steps[0]!) ? { allowInInput: b.allowInInput } : {}),
      ...(b.inDialog ? { inDialog: true } : {})
    }));
    const removed = [...this.#removed.values()].map((v) => ({ ...v }));
    return { version: 1, added, removed };
  }

  /** Replace user customisation. Malformed entries are skipped, never thrown. */
  load(diff: unknown): void {
    this.#added = [];
    this.#removed.clear();
    const d = (diff ?? {}) as Partial<KeymapDiff>;
    const valid = (e: any) => e && isContext(e.context) && typeof e.keys === 'string' && typeof e.command === 'string' && parseSequence(e.keys);
    for (const e of Array.isArray(d.added) ? d.added : []) {
      if (!valid(e)) continue;
      const b = makeBinding(e.context, e.keys, e.command, e, false);
      if (!this.#added.some((x) => bkey(x.context, x.sequence, x.command) === bkey(b.context, b.sequence, b.command))) this.#added.push(b);
    }
    for (const e of Array.isArray(d.removed) ? d.removed : []) {
      if (!valid(e)) continue;
      {
        const keys = parseSequence(e.keys)!.join(' ');
        this.#removed.set(bkey(e.context, keys, e.command), { context: e.context, keys, command: e.command });
      }
    }
    this.#rebuild();
  }

  // ---------- events ----------

  onChange(fn: () => void): () => void {
    this.#changeSubs.add(fn);
    return () => this.#changeSubs.delete(fn);
  }
  onPending(fn: (p: string[]) => void): () => void {
    this.#pendingSubs.add(fn);
    return () => this.#pendingSubs.delete(fn);
  }
  /** Fired when a pending ambiguous prefix times out and its shorter binding should run (e.g. `g` while `g g` exists). */
  onFire(fn: (b: Binding) => void): () => void {
    this.#fireSubs.add(fn);
    return () => this.#fireSubs.delete(fn);
  }

  // ---------- key handling ----------

  cancelPending(): void {
    this.#clear();
  }

  /**
   * Feed one canonical step. Pure state machine apart from the 1 s timer:
   *  - exact match in a more specific context than any longer one: run immediately
   *  - only a longer sequence matches: pending (UI shows "g …")
   *  - both (`g` and `g g`): pending; on timeout or a non-continuing key the shorter binding fires
   *  - a pending prefix broken by a non-matching key is discarded and the key is re-processed fresh
   *  - Escape cancels a pending prefix
   */
  handle(step: string, opts: HandleOptions): KeyResult {
    const ctx: Required<HandleOptions> = { inInput: false, isRunnable: () => true, ...opts };
    let before: Binding | undefined;
    if (this.#pending.length) {
      const seq = [...this.#pending, step];
      const r = this.#lookup(seq, ctx);
      if (r.exact.length || r.longer.length) return this.#advance(seq, r, ctx);
      if (step === 'Escape') {
        this.#clear();
        return { type: 'cancel' };
      }
      before = this.#fallback ?? undefined;
      this.#clear();
    }
    const r = this.#lookup([step], ctx);
    const res: KeyResult = r.exact.length || r.longer.length ? this.#advance([step], r, ctx) : { type: 'none' };
    return before ? { ...res, before } : res;
  }

  #lookup(seq: string[], ctx: Required<HandleOptions>) {
    const exact: Binding[] = [];
    const longer: Binding[] = [];
    for (const c of ctx.chain.contexts) {
      for (const b of this.#byContext.get(c) ?? []) {
        if (c === 'global' && ctx.chain.restrictGlobal && !b.inDialog) continue;
        if (ctx.inInput && !b.allowInInput) continue;
        if (b.steps.length < seq.length) continue;
        let ok = true;
        for (let i = 0; i < seq.length; i++) if (b.steps[i] !== seq[i]) { ok = false; break; }
        if (!ok || !ctx.isRunnable(b.command)) continue;
        (b.steps.length === seq.length ? exact : longer).push(b);
      }
    }
    return { exact, longer };
  }

  #advance(seq: string[], r: { exact: Binding[]; longer: Binding[] }, ctx: Required<HandleOptions>): KeyResult {
    const rank = (b: Binding) => ctx.chain.contexts.indexOf(b.context);
    const exactRank = r.exact.length ? rank(r.exact[0]!) : Infinity;
    const longerRank = r.longer.length ? Math.min(...r.longer.map(rank)) : Infinity;
    if (r.exact.length && exactRank < longerRank) {
      this.#clear();
      const b = r.exact[0]!;
      return { type: 'run', binding: b, command: b.command, sequence: b.sequence };
    }
    this.#fallback = r.exact[0] ?? null;
    this.#pending = seq;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#timeout(), this.#timeoutMs);
    this.#emitPending();
    return { type: 'pending', steps: seq };
  }

  #timeout() {
    const fb = this.#fallback;
    this.#clear();
    if (fb) for (const f of [...this.#fireSubs]) f(fb);
  }

  #clear() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#fallback = null;
    if (this.#pending.length) {
      this.#pending = [];
      this.#emitPending();
    }
  }

  #emitPending() {
    for (const f of [...this.#pendingSubs]) f([...this.#pending]);
  }

  #rebuild(notify = true) {
    const removed = this.#removed;
    const seen = new Set<string>();
    const eff: Binding[] = [];
    for (const b of [...this.#defaults, ...this.#added]) {
      const k = bkey(b.context, b.sequence, b.command);
      if (seen.has(k)) continue;
      if (b.isDefault && removed.has(k)) continue;
      seen.add(k);
      eff.push(b);
    }
    this.#effective = eff;
    this.#byContext = new Map();
    for (const b of eff) {
      const l = this.#byContext.get(b.context);
      if (l) l.push(b);
      else this.#byContext.set(b.context, [b]);
    }
    this.#clear();
    if (notify) for (const f of [...this.#changeSubs]) f();
  }
}
