/**
 * Key contexts.
 *
 * Inheritance (child -> parent), most specific wins:
 *   comic -> reader.fixed -> reader -> global     (comics are fixed-layout, so zoom/fit/tint keys apply)
 *   reader.reflow -> reader -> global
 *   library -> global
 *   find -> global    (transient: pushed on top of a reader context while the find bar has focus)
 *   dialog -> global  (SHADOWING: while a dialog is on top of the stack, nothing below it is reachable
 *                      and only global bindings flagged `inDialog` (palette, fullscreen, Esc) leak through)
 */
export const CONTEXTS = ['global', 'library', 'reader', 'reader.fixed', 'reader.reflow', 'comic', 'find', 'dialog'] as const;
export type Context = (typeof CONTEXTS)[number];

const PARENT: Record<Context, Context | null> = {
  global: null,
  library: 'global',
  reader: 'global',
  'reader.fixed': 'reader',
  'reader.reflow': 'reader',
  comic: 'reader.fixed',
  find: 'global',
  dialog: 'global'
};
const SHADOWING: ReadonlySet<Context> = new Set<Context>(['dialog']);

export function isContext(v: unknown): v is Context {
  return typeof v === 'string' && (CONTEXTS as readonly string[]).includes(v);
}

/** [ctx, parent, ..., 'global'] */
export function ancestors(ctx: Context): Context[] {
  const out: Context[] = [];
  for (let c: Context | null = ctx; c; c = PARENT[c]) out.push(c);
  return out;
}

/** true if `ctx` is `ancestor` or inherits from it */
export function isWithin(ctx: Context, ancestor: Context): boolean {
  return ancestors(ctx).includes(ancestor);
}

/** Ordered lookup chain (most specific first, 'global' last). */
export interface Chain {
  contexts: Context[];
  /** when true only global bindings flagged `inDialog` are visible */
  restrictGlobal: boolean;
}

export function buildChain(stack: readonly Context[]): Chain {
  const contexts: Context[] = [];
  let restrictGlobal = false;
  for (let i = stack.length - 1; i >= 0; i--) {
    for (const c of ancestors(stack[i]!)) if (c !== 'global' && !contexts.includes(c)) contexts.push(c);
    if (SHADOWING.has(stack[i]!)) {
      restrictGlobal = true;
      break;
    }
  }
  contexts.push('global');
  return { contexts, restrictGlobal };
}

/** Active-context stack. Index 0 is the base (library / a reader); overlays push on top. */
export class ContextStack {
  #entries: { ctx: Context; id: number }[] = [];
  #next = 1;
  #listeners = new Set<() => void>();

  constructor(base: Context = 'library') {
    this.#entries.push({ ctx: base, id: 0 });
  }

  get stack(): Context[] {
    return this.#entries.map((e) => e.ctx);
  }
  get top(): Context {
    return this.#entries[this.#entries.length - 1]!.ctx;
  }
  chain(): Chain {
    return buildChain(this.stack);
  }
  /** Replace the base context (e.g. navigating library -> reader). */
  setBase(ctx: Context): void {
    if (this.#entries[0]!.ctx === ctx) return;
    this.#entries[0] = { ctx, id: 0 };
    this.#emit();
  }
  /** Push an overlay context. Returns a pop function that removes exactly this entry (safe out of order). */
  push(ctx: Context): () => void {
    const id = this.#next++;
    this.#entries.push({ ctx, id });
    this.#emit();
    return () => {
      const i = this.#entries.findIndex((e) => e.id === id);
      if (i > 0) {
        this.#entries.splice(i, 1);
        this.#emit();
      }
    };
  }
  /** Pop the top overlay (never the base). */
  pop(): void {
    if (this.#entries.length > 1) {
      this.#entries.pop();
      this.#emit();
    }
  }
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
  #emit() {
    for (const l of [...this.#listeners]) l();
  }
}
