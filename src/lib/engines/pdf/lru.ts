/** Memory-bounded LRU. `cost` is bytes (or any unit); `onEvict` releases the value (e.g. ImageBitmap.close). */
export class ByteLru<K, V> {
  private map = new Map<K, { value: V; cost: number }>();
  private total = 0;

  constructor(
    private readonly budget: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }
  get bytes(): number {
    return this.total;
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  /** Read without touching recency. */
  peek(key: K): V | undefined {
    return this.map.get(key)?.value;
  }
  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }
  set(key: K, value: V, cost: number): void {
    this.delete(key);
    this.map.set(key, { value, cost });
    this.total += cost;
    // Evict oldest first, but never the entry just inserted.
    for (const [k, e] of this.map) {
      if (this.total <= this.budget || k === key) break;
      this.map.delete(k);
      this.total -= e.cost;
      this.onEvict?.(k, e.value);
    }
  }
  delete(key: K): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    this.total -= e.cost;
    this.onEvict?.(key, e.value);
  }
  /** Delete every entry whose key matches. */
  deleteWhere(pred: (key: K) => boolean): void {
    for (const k of [...this.map.keys()]) if (pred(k)) this.delete(k);
  }
  clear(): void {
    for (const k of [...this.map.keys()]) this.delete(k);
  }
}
