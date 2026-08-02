/**
 * Tests: Translator — the full pipeline with a fake request function and
 * jsdom, covering cache hits, parse retry, count mismatch, cancellation,
 * refresh and error paths.
 */
import { check, flush, section } from "./helpers";
import { Translator, type TranslationStatus } from "../src/translation/Translator";
import { MemoryCache } from "../src/cache/MemoryCache";
import { PersistentCache } from "../src/cache/PersistentCache";
import { normalizeSettings, type Settings } from "../src/settings/Settings";
import type { CurrentTrack } from "../src/player/SongListener";
import type { BuiltPrompt } from "../src/translation/PromptBuilder";
import type { RequestOptions } from "../src/translation/DeepSeekProvider";

class FakeStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

const TRACK: CurrentTrack = {
  uri: "spotify:track:abc123",
  id: "abc123",
  name: "Test Song",
  artist: "Test Artist",
};

function makeContainer(lines: string[]): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-testid", "fullscreen-lyrics");
  for (const line of lines) {
    const lineEl = document.createElement("div");
    lineEl.setAttribute("data-testid", "fullscreen-lyrics-line");
    lineEl.textContent = line;
    container.appendChild(lineEl);
  }
  document.body.appendChild(container);
  return container;
}

interface Harness {
  translator: Translator;
  memory: MemoryCache;
  persistent: PersistentCache;
  statuses: Array<{ status: TranslationStatus; message?: string }>;
  rendered: Array<{ lines: string[]; translations: string[] }>;
  calls: number;
  setSettings: (settings: Settings) => void;
  container: HTMLElement;
}

function makeHarness(
  responder: (call: number) => Promise<string> | string,
): Harness {
  const memory = new MemoryCache();
  const persistent = new PersistentCache(new FakeStorage());
  let settings = normalizeSettings({ apiKey: "sk-test" });
  const statuses: Harness["statuses"] = [];
  const rendered: Harness["rendered"] = [];
  const calls = { count: 0 };

  const translator = new Translator({
    memoryCache: memory,
    persistentCache: persistent,
    getSettings: () => settings,
    completeRequest: async (
      _prompt: BuiltPrompt,
      _settings: Settings,
      options: RequestOptions,
    ): Promise<string> => {
      calls.count++;
      const result = responder(calls.count);
      if (typeof result === "string") {
        return result;
      }
      // Promise responder honoring the abort signal.
      return new Promise<string>((resolve, reject) => {
        options.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        result.then(resolve, reject);
      });
    },
    onStatus: (status, message) => statuses.push({ status, message }),
    onTranslated: (track, lines, translations) =>
      rendered.push({ lines, translations }),
  });

  return {
    translator,
    memory,
    persistent,
    statuses,
    rendered,
    calls,
    setSettings: (next) => {
      settings = next;
    },
    container: makeContainer(["line one", "line two"]),
  };
}

const OK_JSON = JSON.stringify([
  { original: "line one", translated: "uno" },
  { original: "line two", translated: "dos" },
]);

export async function run(): Promise<void> {
  section("Translator");

  // 1. No lyrics.
  {
    const h = makeHarness(() => OK_JSON);
    const empty = document.createElement("div");
    empty.setAttribute("data-testid", "fullscreen-lyrics");
    document.body.appendChild(empty);
    await h.translator.translate(TRACK, empty);
    check("no-lyrics-error", h.statuses.at(-1)?.status, "error");
    check("no-lyrics-message", h.statuses.at(-1)?.message, "No hay letras disponibles para esta canción.");
    empty.remove();
  }

  // 2. No API key.
  {
    const h = makeHarness(() => OK_JSON);
    h.setSettings(normalizeSettings({ apiKey: "" }));
    await h.translator.translate(TRACK, h.container);
    check("no-key-error", h.statuses.at(-1)?.status, "error");
    check("no-key-message", h.statuses.at(-1)?.message, "Falta la API key de DeepSeek. Configúrala en los ajustes.");
    check("no-key-no-call", h.calls.count, 0);
  }

  // 3. Cache hit (memory).
  {
    const h = makeHarness(() => OK_JSON);
    h.memory.set(TRACK.id, ["uno", "dos"]);
    await h.translator.translate(TRACK, h.container);
    check("cache-hit-rendered", h.rendered.length, 1);
    check("cache-hit-translations", h.rendered[0]?.translations, ["uno", "dos"]);
    check("cache-hit-no-call", h.calls.count, 0);
    check("cache-hit-status", h.statuses.at(-1)?.status, "ready");
  }

  // 4. Persistent cache hit (no memory, no API call).
  {
    const h = makeHarness(() => OK_JSON);
    h.persistent.set(TRACK.id, ["uno", "dos"]);
    await h.translator.translate(TRACK, h.container);
    check("persistent-hit", h.rendered[0]?.translations, ["uno", "dos"]);
    check("persistent-hit-no-call", h.calls.count, 0);
  }

  // 5. Full flow: request → parse → caches written → rendered.
  {
    const h = makeHarness(() => OK_JSON);
    await h.translator.translate(TRACK, h.container);
    check("full-rendered", h.rendered[0]?.translations, ["uno", "dos"]);
    check("full-call-count", h.calls.count, 1);
    check("full-memory-cached", h.memory.get(TRACK.id), ["uno", "dos"]);
    check("full-persistent-cached", h.persistent.get(TRACK.id), ["uno", "dos"]);
    check("full-status", h.statuses.at(-1)?.status, "ready");
    check("translating-status", h.statuses.some((s) => s.status === "translating"), true);
  }

  // 6. Parse retry: garbage first, valid second.
  {
    const h = makeHarness((call) => (call === 1 ? "not json at all" : OK_JSON));
    await h.translator.translate(TRACK, h.container);
    check("retry-rendered", h.rendered[0]?.translations, ["uno", "dos"]);
    check("retry-two-calls", h.calls.count, 2);
  }

  // 7. Count mismatch retry then error.
  {
    const wrongCount = JSON.stringify([{ original: "line one", translated: "uno" }]);
    const h = makeHarness(() => wrongCount);
    await h.translator.translate(TRACK, h.container);
    check("mismatch-calls", h.calls.count, 2);
    check("mismatch-error", h.statuses.at(-1)?.status, "error");
    check("mismatch-no-render", h.rendered.length, 0);
  }

  // 8. Cancellation mid-flight is silent.
  {
    const h = makeHarness(() => new Promise<string>(() => undefined));
    const promise = h.translator.translate(TRACK, h.container);
    await flush(20);
    h.translator.cancel();
    await promise;
    check("cancel-silent", h.statuses.some((s) => s.status === "error"), false);
    check("cancel-statuses", h.statuses.map((s) => s.status), ["translating"]);
  }

  // 9. Refresh bypasses the cache.
  {
    const h = makeHarness((call) => (call === 1 ? OK_JSON : OK_JSON));
    h.memory.set(TRACK.id, ["uno", "dos"]);
    await h.translator.translate(TRACK, h.container);
    check("refresh-precall", h.calls.count, 0);
    await h.translator.refresh(TRACK, h.container);
    check("refresh-calls", h.calls.count, 1);
  }

  // 10. Unknown provider error surfaces as friendly message.
  {
    const h = makeHarness(() => {
      throw new Error("boom");
    });
    await h.translator.translate(TRACK, h.container);
    check("unknown-error-status", h.statuses.at(-1)?.status, "error");
    check("unknown-error-message", h.statuses.at(-1)?.message, "Error inesperado al traducir.");
  }

  // 11. Empty response error.
  {
    const h = makeHarness(() => "");
    await h.translator.translate(TRACK, h.container);
    check("empty-response-status", h.statuses.at(-1)?.status, "error");
    check("empty-response-message", h.statuses.at(-1)?.message, "La IA devolvió una respuesta inválida. Usa «Refrescar» para reintentar.");
    check("empty-response-calls", h.calls.count, 2);
  }

  // Cleanup containers.
  document.body.innerHTML = "";
}
