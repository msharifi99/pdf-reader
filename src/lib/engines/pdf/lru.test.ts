import { describe, expect, it, vi } from 'vitest';
import { ByteLru } from './lru';

describe('ByteLru', () => {
  it('evicts least recently used when over budget', () => {
    const ev = vi.fn();
    const c = new ByteLru<number, string>(10, ev);
    c.set(1, 'a', 4);
    c.set(2, 'b', 4);
    c.get(1); // 2 is now oldest
    c.set(3, 'c', 4);
    expect(c.has(2)).toBe(false);
    expect(c.has(1) && c.has(3)).toBe(true);
    expect(ev).toHaveBeenCalledWith(2, 'b');
    expect(c.bytes).toBe(8);
  });
  it('keeps a single oversized entry and replaces existing keys', () => {
    const c = new ByteLru<number, string>(5);
    c.set(1, 'big', 50);
    expect(c.has(1)).toBe(true);
    c.set(1, 'x', 2);
    expect(c.bytes).toBe(2);
    expect(c.size).toBe(1);
  });
  it('deleteWhere and clear release everything', () => {
    const ev = vi.fn();
    const c = new ByteLru<string, number>(100, ev);
    c.set('a1', 1, 1);
    c.set('a2', 2, 1);
    c.set('b1', 3, 1);
    c.deleteWhere((k) => k.startsWith('a'));
    expect(c.size).toBe(1);
    c.clear();
    expect(c.bytes).toBe(0);
    expect(ev).toHaveBeenCalledTimes(3);
  });
});
