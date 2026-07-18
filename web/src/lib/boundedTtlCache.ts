interface BoundedTtlCacheOptions {
  maxEntries: number;
  ttlMs: number;
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Small deterministic TTL/LRU cache for bounded browser-owned read models. */
export class BoundedTtlCache<K, V> {
  readonly #entries = new Map<K, CacheEntry<V>>();
  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor({ maxEntries, ttlMs, now = Date.now }: BoundedTtlCacheOptions) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError('maxEntries must be a positive safe integer');
    }
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive finite number');
    }
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  get size(): number {
    this.#pruneExpired(this.#now());
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    const now = this.#now();
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.#entries.delete(key);
      return undefined;
    }

    // Map iteration is insertion ordered. Reinsert a hit so the first key is
    // always the least recently used live entry.
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const now = this.#now();
    this.#pruneExpired(now);
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: now + this.#ttlMs });

    while (this.#entries.size > this.#maxEntries) {
      const leastRecentlyUsed = this.#entries.keys().next();
      if (leastRecentlyUsed.done) break;
      this.#entries.delete(leastRecentlyUsed.value);
    }
  }

  #pruneExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}
