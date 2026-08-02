/**
 * PersistentCache — localStorage-backed translation cache (second level).
 *
 * What it does: stores completed translations under
 * `ai-lyrics-translator:spotify:track:<trackId>`, so translations survive
 * Spotify/extension restarts and are reused across sessions.
 *
 * How it works: `get` reads and validates the JSON blob (an array of strings —
 * anything else is treated as a miss, never a crash); `set` writes it back,
 * replacing any previous value; `clearAll` removes every key with the
 * extension prefix. All storage I/O is wrapped in try/catch: a full quota or
 * a private browsing session degrades the cache to a no-op instead of
 * breaking the extension. The class conforms structurally to the
 * `TranslationCache` contract consumed by `Translator`.
 *
 * Why it exists: the spec requires the cache key to be `spotify:track:<id>`;
 * the extension prefix makes the key collision-proof against other
 * extensions. The two cache levels have identical contracts, so the
 * Translator can chain them (`memory ?? persistent`) without knowing which is
 * which.
 *
 * How to modify:
 * - TTL/expiry: wrap the payload in `{ savedAt, translations }` — bump the
 *   version or the key prefix when the payload shape changes, since old
 *   blobs would fail the array validation and be treated as misses.
 * - Storage backend is injected (defaults to `window.localStorage`) for
 *   testability, same as `ConfigStore`.
 */
import { logger } from "../utils/Logger";
import type { TranslationCache } from "./MemoryCache";

/** Namespaced key prefix — see the module docstring. */
export const PERSISTENT_CACHE_PREFIX = "ai-lyrics-translator:spotify:track:";

export class PersistentCache implements TranslationCache {
  constructor(private readonly storage: Storage = window.localStorage) {}

  get(trackId: string): string[] | null {
    try {
      const raw = this.storage.getItem(PERSISTENT_CACHE_PREFIX + trackId);
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
        return null;
      }
      return parsed;
    } catch (error) {
      logger.warn("Persistent cache read failed; treating as miss.", error);
      return null;
    }
  }

  set(trackId: string, translations: string[]): void {
    try {
      this.storage.setItem(PERSISTENT_CACHE_PREFIX + trackId, JSON.stringify(translations));
    } catch (error) {
      logger.warn("Persistent cache write failed (quota or private mode?).", error);
    }
  }

  /** Removes every cached translation from storage (settings panel action). */
  clearAll(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < this.storage.length; i++) {
        const key = this.storage.key(i);
        if (key !== null && key.startsWith(PERSISTENT_CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        this.storage.removeItem(key);
      }
    } catch (error) {
      logger.warn("Persistent cache clear failed.", error);
    }
  }
}
