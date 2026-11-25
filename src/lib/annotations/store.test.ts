import { describe, expect, it } from 'vitest';
import type { Annotation } from '../core/bindings';
import { AnnotationStore } from './store.svelte';

function fakeApi(fail = new Set<string>()) {
  const rows = new Map<string, Annotation>();
  let n = 0;
  const api = {
    listAnnotations: async (b: string) => [...rows.values()].filter((a) => a.bookId === b && !a.deletedAt),
    createAnnotation: async (x: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => {
      if (fail.has('create')) throw new Error('disk full');
      const a = { ...x, id: `r${++n}`, createdAt: n, updatedAt: n, deletedAt: null } as Annotation;
      rows.set(a.id, a);
      return a;
    },
    updateAnnotation: async (id: string, p: Partial<Annotation>) => {
      if (fail.has('update')) throw new Error('locked');
      const a = rows.get(id)!;
      for (const [k, v] of Object.entries(p)) if (v != null) (a as Record<string, unknown>)[k] = v;
      return a;
    },
    deleteAnnotation: async (id: string) => ((rows.get(id)!.deletedAt = 1), null),
    restoreAnnotation: async (id: string) => ((rows.get(id)!.deletedAt = null), rows.get(id)!),
  };
  return { api: api as never, rows };
}
const anchor = (page: number, exact = 'q') => ({ locator: { kind: 'fixed' as const, page }, quote: { exact, prefix: '', suffix: '' } });
const pos = (a: { locator: { kind: string; page?: number } }) => (a.locator as { page: number }).page / 10;

describe('AnnotationStore', () => {
  it('shows a create at once, sorted by position, and edits made before the core answers still land', async () => {
    const { api, rows } = fakeApi();
    const s = new AnnotationStore('b', pos, api);
    s.create({ type: 'highlight', color: 'yellow', anchor: anchor(5) });
    const a = s.create({ type: 'highlight', color: 'yellow', anchor: anchor(1) });
    s.update(a.id, { color: 'green', note: 'hi', type: 'note' });
    expect(s.items.map((x) => x.anchor.locator)).toEqual([anchor(1).locator, anchor(5).locator]);
    expect(s.items[0]!.color).toBe('green');
    await s.settled();
    const saved = [...rows.values()].find((r) => (r.anchor as { locator: { page: number } }).locator.page === 1)!;
    expect(saved).toMatchObject({ color: 'green', note: 'hi', type: 'note' });
    expect(s.items[0]!.id).toBe(saved.id);
  });

  it('undoes and redoes create, recolour, note edits and delete', async () => {
    const { api, rows } = fakeApi();
    const s = new AnnotationStore('b', pos, api);
    const a = s.create({ type: 'highlight', color: 'yellow', anchor: anchor(1) });
    s.update(a.id, { color: 'pink' });
    s.update(a.id, { note: 'x', type: 'note' });
    s.remove(a.id);
    expect(s.items).toHaveLength(0);
    s.undo(); // delete
    expect(s.items[0]).toMatchObject({ color: 'pink', note: 'x' });
    s.undo(); // note
    expect(s.items[0]).toMatchObject({ note: null, type: 'highlight' });
    s.undo(); // colour
    expect(s.items[0]!.color).toBe('yellow');
    s.redo();
    expect(s.items[0]!.color).toBe('pink');
    s.undo();
    s.undo(); // create
    expect(s.items).toHaveLength(0);
    await s.settled();
    expect([...rows.values()].every((r) => r.deletedAt)).toBe(true);
    s.redo();
    await s.settled();
    expect(await s['api'].listAnnotations('b')).toHaveLength(1);
  });

  it('undoes one specific deletion, not whatever was done last', async () => {
    const { api } = fakeApi();
    const s = new AnnotationStore('b', pos, api);
    const a = s.create({ type: 'highlight', color: 'yellow', anchor: anchor(1) });
    s.remove(a.id);
    s.create({ type: 'highlight', color: 'green', anchor: anchor(2) }); // a later change
    expect(s.undoRemoval(a)).toBe(true);
    expect(s.items.map((x) => x.color)).toEqual(['yellow', 'green']);
    expect(s.undoRemoval(a)).toBe(false); // already back
    await s.settled();
    s.redo(); // redo removes it again
    expect(s.items.map((x) => x.color)).toEqual(['green']);
  });

  it('rolls back a failed write', async () => {
    const { api } = fakeApi(new Set(['update']));
    const s = new AnnotationStore('b', pos, api);
    const a = s.create({ type: 'highlight', color: 'yellow', anchor: anchor(1) });
    await s.settled();
    s.update(a.id, { color: 'blue' });
    expect(s.items[0]!.color).toBe('blue');
    await s.settled();
    expect(s.items[0]!.color).toBe('yellow');
  });

  it('removes a highlight whose create failed', async () => {
    const { api } = fakeApi(new Set(['create']));
    const s = new AnnotationStore('b', pos, api);
    s.create({ type: 'bookmark', color: null, anchor: anchor(1, '') });
    await s.settled();
    expect(s.items).toHaveLength(0);
  });
});
