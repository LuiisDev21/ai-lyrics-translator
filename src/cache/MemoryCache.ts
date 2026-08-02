/**
 * MemoryCache — in-memory translation cache (first cache level).
 *
 * What it does: stores completed translations in a `Map<trackId, string[]>` so
 * revisiting a song within the same Spotify session never triggers a second
 * API call.
 *
 * How it works: `get` returns the stored translations (or null on miss); `set`
 * inserts and then evicts the oldest entry when the map exceeds `maxEntries`,
 * bounding memory for long sessions. Map insertion order makes FIFO eviction
 * trivial. The class conforms structurally to the `TranslationCache` contract
 * consumed by `Translator` (the consumer owns the abstraction — dependency
 * inversion).
 *
 * Why it exists: together with `PersistentCache` it implements the spec's
 * two-level cache ("cada canción solo debe traducirse una vez"). Memory is the
 * fast path; it is also the only place where the app can distinguish "not yet
 * translated this session" from "never translated".
 *
 * How to modify:
 * - Tune the cap via `maxEntries` in the constructor.
 * - To add TTL (e.g. drop entries after N minutes), extend `set` with a
 *   timestamp and check it in `get` — keep the public surface unchanged.
 */
export interface TranslationCache {
  /** Returns the stored translations for `trackId`, or null on miss/corruption. */
  get(trackId: string): string[] | null;
  /** Stores the translations for `trackId`, replacing any previous value. */
  set(trackId: string, translations: string[]): void;
}

/** Default cap: 200 songs in memory ≈ a few dozen KB of strings. */
const DEFAULT_MAX_ENTRIES = 200;

export class MemoryCache implements TranslationCache {
  private readonly entries = new Map<string, string[]>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get(trackId: string): string[] | null {
    return this.entries.get(trackId) ?? null;
  }

  set(trackId: string, translations: string[]): void {
    this.entries.set(trackId, translations);
    this.evictIfNeeded();
  }

  /** Removes every entry (e.g. when the user clears the cache). */
  clear(): void {
    this.entries.clear();
  }

  /** Number of cached songs — exposed for the settings panel. */
  get size(): number {
    return this.entries.size;
  }

  /** FIFO eviction: drops the oldest inserted entry until under the cap. */
  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}
