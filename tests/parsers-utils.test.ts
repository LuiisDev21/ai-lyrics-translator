/**
 * Tests: pure logic — JsonParser, request body contract, settings
 * normalization, track-id extraction, prompt builder, retry, DOM helpers.
 */
import { check, checkRejects, section } from "./helpers";
import { parseTranslationResponse } from "../src/translation/JsonParser";
import { buildRequestBody, type LLMProviderConfig } from "../src/providers/llm";
import { normalizeSettings, DISPLAY_MODES, TARGET_LANGUAGES } from "../src/settings/Settings";
import { extractTrackId } from "../src/player/SongListener";
import { buildPrompt } from "../src/translation/PromptBuilder";
import { retryWithBackoff, delay } from "../src/utils/Retry";

const DS_CONFIG: LLMProviderConfig = {
  id: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  defaultModel: "deepseek-v4-flash",
  keyPlaceholder: "sk-",
  jsonMode: "response_format",
  sendsThinking: true,
};
import { createElement, insertAfter, removeChildren, queryAll, queryFirst, setAttributes } from "../src/utils/Dom";

export async function run(): Promise<void> {
  // --- JsonParser ------------------------------------------------------------
  section("JsonParser");
  check("clean", parseTranslationResponse('[{"original":"Hello","translated":"Hola"}]'), {
    ok: true,
    entries: [{ original: "Hello", translated: "Hola" }],
  });
  check(
    "fence",
    parseTranslationResponse('Sure! Here it is:\n```json\n[{"original":"A","translated":"B"}]\n```\nHope that helps.'),
    { ok: true, entries: [{ original: "A", translated: "B" }] },
  );
  check(
    "prose",
    parseTranslationResponse('Here is the translation: [{"original":"X","translated":"Y"}] done!'),
    { ok: true, entries: [{ original: "X", translated: "Y" }] },
  );
  check(
    "trailing-commas",
    parseTranslationResponse('[{"original":"A","translated":"B",},{"original":"C","translated":"D",}]'),
    { ok: true, entries: [{ original: "A", translated: "B" }, { original: "C", translated: "D" }] },
  );
  check(
    "unterminated",
    parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C","translated":"D"}'),
    { ok: true, entries: [{ original: "A", translated: "B" }, { original: "C", translated: "D" }] },
  );
  check(
    "truncated-string",
    parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C","tran'),
    { ok: false, reason: "unparseable" },
  );
  check("empty", parseTranslationResponse("   \n  "), { ok: false, reason: "empty-response" });
  check("not-array", parseTranslationResponse('{"original":"A","translated":"B"}'), {
    ok: false,
    reason: "unparseable",
  });
  check(
    "bad-entry",
    parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C"}]'),
    { ok: false, reason: "unparseable" },
  );
  check(
    "trimming",
    parseTranslationResponse('[{"original":"  A  ","translated":" B "}]'),
    { ok: true, entries: [{ original: "A", translated: "B" }] },
  );
  check(
    "escaping",
    parseTranslationResponse('[{"original":"Don\'t stop","translated":"No pares"},{"original":"He said \\"hi\\"","translated":"Dijo \\"hola\\""}]'),
    { ok: true, entries: [{ original: "Don't stop", translated: "No pares" }, { original: 'He said "hi"', translated: 'Dijo "hola"' }] },
  );

  // --- buildRequestBody ------------------------------------------------------
  section("DeepSeek request body");
  const base = normalizeSettings({ providerKeys: { deepseek: "sk-test" } });
  check("defaults", buildRequestBody({ system: "sys", user: "user" }, base, DS_CONFIG, false), {
    model: "deepseek-v4-flash",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ],
    temperature: 1.3,
    stream: false,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  });
  const custom = normalizeSettings({ providerKeys: { deepseek: "sk-test" }, model: "deepseek-v4-pro" });
  const body = buildRequestBody({ system: "sys", user: "user" }, custom, DS_CONFIG, true);
  check("custom-model", [body.model, body.temperature, body.stream], ["deepseek-v4-pro", 1.3, true]);

  // --- normalizeSettings ------------------------------------------------------
  section("Settings normalization");
  check("garbage-input", normalizeSettings("garbage"), normalizeSettings(null));
  check("clamps-opacity-low", normalizeSettings({ opacity: 0 }).opacity, 0.1);
  check("clamps-font-size-low", normalizeSettings({ fontSize: 5 }).fontSize, 8);
  check("default-provider", normalizeSettings(null).provider, "deepseek");
  check("default-model", normalizeSettings(null).model, "deepseek-v4-flash");
  check("model-free-string", normalizeSettings({ model: "gpt-4" }).model, "gpt-4");
  check("unknown-provider-falls-back", normalizeSettings({ provider: "deepl" }).provider, "deepseek");
  check("known-provider-kept", normalizeSettings({ provider: "openrouter" }).provider, "openrouter");
  check("invalid-color", normalizeSettings({ color: "notacolor" }).color, "#a7a7a7");
  check("valid-color-3-digit", normalizeSettings({ color: "#fff" }).color, "#fff");
  check("trims-api-key", normalizeSettings({ apiKey: "  sk-123  " }).providerKeys.deepseek, "sk-123");
  check("keeps-provider-keys", normalizeSettings({ providerKeys: { openrouter: "or-x", gemini: "g-x" } }).providerKeys.openrouter, "or-x");
  check("trims-custom-base-url", normalizeSettings({ customBaseUrl: "  http://localhost:11434/v1  " }).customBaseUrl, "http://localhost:11434/v1");
  check("invalid-display-mode", normalizeSettings({ displayMode: "sideways" }).displayMode, "both");
  check("valid-display-mode", normalizeSettings({ displayMode: "original" }).displayMode, "original");
  check("language-lowercased", normalizeSettings({ targetLanguage: "ES" }).targetLanguage, "es");
  // Removed AI knobs: old stored values are ignored, defaults apply.
  check(
    "legacy-ai-keys-ignored",
    normalizeSettings({ temperature: 99, thinkingMode: true, reasoningEffort: "max", timeoutMs: 5000 }),
    normalizeSettings(null),
  );
  check("display-list", DISPLAY_MODES, ["original", "translation", "both"]);
  check(
    "language-list",
    TARGET_LANGUAGES.map((l) => l.code),
    ["es", "en", "pt", "fr", "de", "it", "nl", "pl", "sv", "da", "no", "fi", "el", "ru", "uk", "tr", "ar", "he", "hi", "ja", "ko", "zh", "th", "vi", "id"],
  );
  check("language-default-is-es", TARGET_LANGUAGES[0].code, "es");

  // --- extractTrackId ----------------------------------------------------------
  section("Track id extraction");
  check("valid", extractTrackId("spotify:track:4uLU6hMCjMI75M1A2tKUQC"), "4uLU6hMCjMI75M1A2tKUQC");
  check("ad", extractTrackId("spotify:ad:123"), null);
  check("podcast", extractTrackId("spotify:episode:4uLU6h"), null);
  check("local", extractTrackId("spotify:local:artist:album:title:123"), null);
  check("garbage", extractTrackId("not-a-uri"), null);

  // --- PromptBuilder ------------------------------------------------------------
  section("PromptBuilder");
  const prompt = buildPrompt(["line one", "line two"], { targetLanguage: "fr", songTitle: "Song", artist: "Artist" });
  check("system-language", prompt.system.includes("into fr"), true);
  check("system-json-only", prompt.system.includes("Output ONLY a valid JSON array"), true);
  check("system-schema", prompt.system.includes('{"original": "...", "translated": "..."}'), true);
  check("user-count", prompt.user.includes("Return exactly 2 JSON objects"), true);
  check("user-numbered", prompt.user.includes("1. line one\n2. line two"), true);
  check("user-context", prompt.user.includes('Song: "Song" — Artist'), true);

  // --- Retry ----------------------------------------------------------------------
  section("Retry");
  let attempts = 0;
  const flaky = async (): Promise<string> => {
    attempts++;
    if (attempts < 3) throw new Error("boom");
    return "ok";
  };
  const result = await retryWithBackoff(flaky, { attempts: 3, baseDelayMs: 1 });
  check("succeeds-after-retries", result, "ok");
  check("attempt-count", attempts, 3);

  let single = 0;
  await checkRejects(
    "shouldRetry-false-stops",
    () =>
      retryWithBackoff(
        async () => {
          single++;
          throw new Error("nope");
        },
        { attempts: 3, baseDelayMs: 1, shouldRetry: () => false },
      ),
    (error) => error instanceof Error && error.message === "nope",
  );
  check("single-attempt", single, 1);

  await checkRejects(
    "exhausts-attempts",
    () => retryWithBackoff(async () => { throw new Error("always"); }, { attempts: 2, baseDelayMs: 1 }),
    (error) => error instanceof Error && error.message === "always",
  );
  await delay(1);
  check("delay-resolves", true, true);

  // --- Dom helpers ------------------------------------------------------------------
  section("Dom helpers");
  const el = createElement("div", { className: "c", attrs: { "data-x": "1" }, text: "hi" });
  check("createElement", [el.className, el.getAttribute("data-x"), el.textContent], ["c", "1", "hi"]);
  setAttributes(el, { "data-y": "2" });
  check("setAttributes", el.getAttribute("data-y"), "2");

  const parent = createElement("div");
  const a = createElement("span", { text: "a" });
  const b = createElement("span", { text: "b" });
  const c = createElement("span", { text: "c" });
  parent.append(a, c);
  insertAfter(b, a);
  check("insertAfter-order", Array.from(parent.children).map((n) => n.textContent), ["a", "b", "c"]);
  check("queryAll", queryAll<HTMLElement>(parent, "span").length, 3);
  check("queryFirst", queryFirst<HTMLElement>(parent, "span")?.textContent, "a");
  removeChildren(parent);
  check("removeChildren", parent.children.length, 0);
}
