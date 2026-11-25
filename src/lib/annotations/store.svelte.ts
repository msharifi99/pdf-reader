/**
 * Per-book annotation store (runes). Every change shows at once and is written to the core right
 * away (story 114); core calls run one at a time in order, so an edit made a millisecond after a
 * create still reaches the right row. A failed write rolls the change back with a calm toast.
 * Create, delete, recolour and note edits are undoable (story 94).
 */
import { core } from '../core/core';
import type { AnnotationKind, AnnotationPatch } from '../core/bindings';
import type { Anchor } from '../engines/types';
import { toast } from '../ui';
import { toAnn, type Ann } from './model';

export interface NewMark {
  type: AnnotationKind;
  color: string | null;
  anchor: Anchor;
  note?: string | null;
  label?: string | null;
}

/** Fields the UI edits. `null`/'' clears note and label. */
export type Edit = Partial<Pick<Ann, 'type' | 'color' | 'note' | 'label' | 'anchor'>>;

interface Op {
  undo(): void;
  redo(): void;
}

type Api = Pick<typeof core, 'listAnnotations' | 'createAnnotation' | 'updateAnnotation' | 'deleteAnnotation' | 'restoreAnnotation'>;

const empty = (s: string | null | undefined) => (s?.trim() ? s : null);

export class AnnotationStore {
  /** live annotations in reading order */
  items = $state.raw<Ann[]>([]);
  /** ids whose passage could not be found in the file (kept, shown, never deleted) */
  orphans = $state.raw<ReadonlySet<string>>(new Set());
  loaded = $state(false);
  #undo = $state.raw<Op[]>([]);
  #redo = $state.raw<Op[]>([]);
  #queue: Promise<unknown> = Promise.resolve();
  /** optimistic id -> core id */
  #alias = new Map<string, string>();
  #seq = 0;

  constructor(
    readonly bookId: string,
    /** reading-order key of an anchor (0..1) */
    private readonly pos: (a: Anchor) => number,
    private readonly api: Api = core,
  ) {}

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  async load(): Promise<void> {
    const list = await this.api.listAnnotations(this.bookId);
    this.#set(list.map(toAnn));
    this.loaded = true;
  }

  get(id: string): Ann | undefined {
    const real = this.#alias.get(id) ?? id;
    return this.items.find((a) => a.id === real || a.id === id);
  }

  // ---- public edits (undoable) ------------------------------------------------------------

  create(n: NewMark): Ann {
    const a = this.#create(n);
    this.#push({ undo: () => this.#remove(a.id), redo: () => this.#restore(a) });
    return a;
  }

  update(id: string, edit: Edit): void {
    const before = this.get(id);
    if (!before) return;
    const prev: Edit = {};
    for (const k of Object.keys(edit) as (keyof Edit)[]) (prev as Record<string, unknown>)[k] = before[k];
    if (Object.keys(edit).every((k) => JSON.stringify(edit[k as keyof Edit] ?? null) === JSON.stringify(prev[k as keyof Edit] ?? null))) return;
    this.#update(id, edit);
    this.#push({ undo: () => this.#update(id, prev), redo: () => this.#update(id, edit) });
  }

  remove(id: string): Ann | undefined {
    const a = this.get(id);
    if (!a) return;
    this.#remove(id);
    this.#push({ undo: () => this.#restore(a), redo: () => this.#remove(a.id) });
    return a;
  }

  undo(): boolean {
    const op = this.#undo.at(-1);
    if (!op) return false;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, op];
    op.undo();
    return true;
  }

  redo(): boolean {
    const op = this.#redo.at(-1);
    if (!op) return false;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, op];
    op.redo();
    return true;
  }

  /** Re-anchoring: store a repaired anchor (not an undoable edit). */
  repair(id: string, anchor: Anchor): void {
    this.#update(id, { anchor }, true);
    this.setOrphan(id, false);
  }

  setOrphan(id: string, on: boolean): void {
    if (this.orphans.has(id) === on) return;
    const s = new Set(this.orphans);
    if (on) s.add(id);
    else s.delete(id);
    this.orphans = s;
  }

  /** Resolves once every queued write has reached the core. */
  settled(): Promise<void> {
    return this.#queue.then(() => undefined);
  }

  // ---- internals --------------------------------------------------------------------------

  #push(op: Op) {
    this.#undo = [...this.#undo.slice(-99), op];
    this.#redo = [];
  }

  #set(list: Ann[]) {
    this.items = [...list].sort((a, b) => this.pos(a.anchor) - this.pos(b.anchor) || a.createdAt - b.createdAt);
  }

  #real(id: string): string {
    return this.#alias.get(id) ?? id;
  }

  /** Queue a core write; on failure undo the local change and say so once. */
  #write<T>(call: () => Promise<T>, rollback: () => void, what: string): Promise<T | undefined> {
    const p = this.#queue.then(call).catch((err) => {
      console.warn('[annotations]', what, err);
      rollback();
      toast(`Couldn’t save ${what}, so it was undone.`, { kind: 'warning' });
      return undefined;
    });
    this.#queue = p;
    return p;
  }

  #create(n: NewMark): Ann {
    const now = Date.now();
    const tmp = `tmp-${++this.#seq}-${now}`;
    const a: Ann = { id: tmp, bookId: this.bookId, type: n.type, color: n.color, anchor: n.anchor, note: empty(n.note), label: empty(n.label), createdAt: now, updatedAt: now, deletedAt: null };
    this.#set([...this.items, a]);
    void this.#write(
      () => this.api.createAnnotation({ bookId: this.bookId, type: a.type, color: a.color, anchor: $state.snapshot(a.anchor) as never, note: a.note, label: a.label }),
      () => this.#set(this.items.filter((x) => x.id !== tmp)),
      a.type === 'bookmark' ? 'that bookmark' : 'that highlight',
    ).then((saved) => {
      if (!saved) return;
      this.#alias.set(tmp, saved.id);
      // keep whatever was edited locally meanwhile; only the id changes
      this.items = this.items.map((x) => (x.id === tmp ? { ...x, id: saved.id, createdAt: saved.createdAt } : x));
      if (this.orphans.has(tmp)) this.setOrphan(tmp, false);
    });
    return a;
  }

  #update(id: string, edit: Edit, quiet = false) {
    const cur = this.get(id);
    if (!cur) return;
    const next: Ann = { ...cur, ...edit, updatedAt: Date.now() };
    if ('note' in edit) next.note = empty(edit.note);
    if ('label' in edit) next.label = empty(edit.label);
    this.#set(this.items.map((x) => (x.id === cur.id ? next : x)));
    const patch: AnnotationPatch = {};
    if (edit.type) patch.type = edit.type;
    if ('color' in edit && edit.color) patch.color = edit.color;
    if ('note' in edit) patch.note = next.note ?? ''; // the core treats null as "unchanged": '' clears
    if ('label' in edit) patch.label = next.label ?? '';
    if (edit.anchor) patch.anchor = $state.snapshot(edit.anchor) as never;
    void this.#write(
      () => this.api.updateAnnotation(this.#real(id), patch),
      () => this.#set(this.items.map((x) => (x.id === next.id ? { ...x, ...pick(cur, Object.keys(edit) as (keyof Edit)[]) } : x))),
      quiet ? 'a repaired highlight' : 'that change',
    );
  }

  #remove(id: string) {
    const cur = this.get(id);
    if (!cur) return;
    this.#set(this.items.filter((x) => x.id !== cur.id));
    void this.#write(
      () => this.api.deleteAnnotation(this.#real(id)),
      () => this.#set([...this.items.filter((x) => x.id !== cur.id), cur]),
      'that deletion',
    );
  }

  #restore(a: Ann) {
    const cur = { ...a, id: this.#real(a.id) };
    if (this.items.some((x) => x.id === cur.id)) return;
    this.#set([...this.items, cur]);
    void this.#write(
      () => this.api.restoreAnnotation(this.#real(a.id)),
      () => this.#set(this.items.filter((x) => x.id !== cur.id)),
      'that restore',
    );
  }
}

function pick(a: Ann, keys: (keyof Edit)[]): Edit {
  const o: Edit = {};
  for (const k of keys) (o as Record<string, unknown>)[k] = a[k];
  return o;
}
