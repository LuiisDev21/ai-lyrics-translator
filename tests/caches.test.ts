/**
 * Tests: cache layer (MemoryCache, PersistentCache) and ConfigStore.
 */
import { check, section } from "./helpers";
import { MemoryCache } from "../src/cache/MemoryCache";
import { PersistentCache, PERSISTENT_CACHE_PREFIX } from "../src/cache/PersistentCache";
import { ConfigStore, SETTINGS_STORAGE_KEY } from "../src/settings/ConfigStore";
import { DEFAULT_SETTINGS } from "../src/settings/Settings";

/** In-memory Storage stub for tests. */
class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

export async function run(): Promise<void> {
  // --- MemoryCache -------------------------------------------------------------
  section("MemoryCache");
  const mem = new MemoryCache(2);
  check("miss", mem.get("abc"), null);
  mem.set("abc", ["hola"]);
  check("hit", mem.get("abc"), ["hola"]);
  mem.set("def", ["x"]);
  mem.set("ghi", ["y"]);
  check("evicts-oldest", mem.get("abc"), null);
  check("keeps-recent", mem.get("def"), ["x"]);
  mem.clear();
  check("cleared", mem.get("def"), null);

  // --- PersistentCache -----------------------------------------------------------
  section("PersistentCache");
  const fake = new FakeStorage();
  const pers = new PersistentCache(fake);
  check("miss", pers.get("abc"), null);
  pers.set("abc", ["hola", "mundo"]);
  check("hit", pers.get("abc"), ["hola", "mundo"]);
  check("key-prefix", fake.getItem(PERSISTENT_CACHE_PREFIX + "abc"), JSON.stringify(["hola", "mundo"]));
  fake.setItem(PERSISTENT_CACHE_PREFIX + "corrupt", '{"nope": true}');
  check("corrupt-is-miss", pers.get("corrupt"), null);
  fake.setItem(PERSISTENT_CACHE_PREFIX + "badtype", "[1,2,3]");
  check("wrong-type-is-miss", pers.get("badtype"), null);
  fake.setItem("other-ext:key", "keep");
  pers.clearAll();
  check("clear-all", pers.get("abc"), null);
  check("clear-keeps-others", fake.getItem("other-ext:key"), "keep");
  const pers2 = new PersistentCache(fake);
  fake.setItem(PERSISTENT_CACHE_PREFIX + "rt", JSON.stringify(["a", "b"]));
  check("second-instance", pers2.get("rt"), ["a", "b"]);

  // --- ConfigStore ---------------------------------------------------------------
  section("ConfigStore");
  const storage = new FakeStorage();
  const store = new ConfigStore(storage);
  check("defaults", store.get(), DEFAULT_SETTINGS);

  const seen: Array<Record<string, unknown>> = [];
  const unsubscribe = store.onChange((settings) => seen.push({ ...settings }));
  store.update({ providerKeys: { deepseek: "sk-abc" }, fontSize: 20 });
  check("update-applies", store.get().providerKeys.deepseek, "sk-abc");
  check("update-persists", JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? "{}").providerKeys.deepseek, "sk-abc");
  check("listener-fired", seen.length, 1);
  unsubscribe();
  store.update({ targetLanguage: "en" });
  check("unsubscribe-works", seen.length, 1);
  check("update-merges", store.get().targetLanguage, "en");

  const corrupt = new ConfigStore(new FakeStorage());
  check("corrupt-storage-defaults", corrupt.get(), DEFAULT_SETTINGS);

  const resetStorage = new FakeStorage();
  const resettable = new ConfigStore(resetStorage);
  resettable.update({ providerKeys: { deepseek: "sk-x" }, model: "deepseek-v4-pro" });
  resettable.reset();
  const afterReset = resettable.get();
  check(
    "reset-restores-defaults",
    { ...afterReset, providerKeys: {} },
    { ...DEFAULT_SETTINGS, providerKeys: {} },
  );
  check("reset-keeps-keys", afterReset.providerKeys.deepseek, "sk-x");
  check(
    "reset-persists",
    JSON.parse(resetStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}").providerKeys.deepseek,
    "sk-x",
  );

  // Normalization round-trip: out-of-range value is clamped on update.
  const clamped = new ConfigStore(new FakeStorage());
  clamped.update({ fontSize: 999 });
  check("clamped-in-memory", clamped.get().fontSize, 32);
}
