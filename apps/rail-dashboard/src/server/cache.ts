// Tiny in-memory TTL cache that can also hand back stale entries, so an
// upstream failure can fall back to the last good response (clearly flagged).

interface Entry<V> {
  value: V;
  storedAt: number;
  freshUntil: number;
  keepUntil: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxEntries = 500, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  /** Fresh value or undefined. */
  get(key: string): { value: V; storedAt: number } | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (this.now() > e.freshUntil) return undefined;
    return { value: e.value, storedAt: e.storedAt };
  }

  /** Value even if past its freshness (but within keep time). */
  getStale(key: string): { value: V; storedAt: number } | undefined {
    const e = this.entries.get(key);
    if (!e || this.now() > e.keepUntil) return undefined;
    return { value: e.value, storedAt: e.storedAt };
  }

  set(key: string, value: V, ttlMs: number, keepMs = ttlMs * 10): void {
    const now = this.now();
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: now, freshUntil: now + ttlMs, keepUntil: now + Math.max(ttlMs, keepMs) });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
