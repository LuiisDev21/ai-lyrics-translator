/**
 * Tests: providers — the generic LLM provider (createLLMProvider), the
 * registry and the DeepL direct provider, with a stubbed global fetch.
 */
import { check, checkRejects, flush, section } from "./helpers";
import { normalizeSettings } from "../src/settings/Settings";
import {
  buildRequestBody,
  createLLMProvider,
  type LLMProviderConfig,
} from "../src/providers/llm";
import {
  PROVIDERS,
  getProvider,
  getProviderIds,
  getProviderLabel,
} from "../src/providers/registry";
import { ProviderError } from "../src/providers/types";

const PROMPT = { system: "sys", user: "user" };
const BASE = normalizeSettings({ providerKeys: { deepseek: "sk-test" } });

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

const GEMINI_CONFIG: LLMProviderConfig = {
  id: "gemini",
  label: "Google Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  models: ["gemini-2.0-flash"],
  defaultModel: "gemini-2.0-flash",
  keyPlaceholder: "AIza",
  jsonMode: "prompt",
};

const deepseek = createLLMProvider(DS_CONFIG);

// --- fetch stub helpers -------------------------------------------------------
let fetchCalls = 0;
let lastUrl = "";
let lastHeaders: Record<string, string> = {};
let lastBody: Record<string, unknown> = {};

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls++;
    lastUrl = String(url);
    lastHeaders = (init?.headers ?? {}) as Record<string, string>;
    lastBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return Promise.resolve(handler(String(url), init ?? {}));
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

const hangingFetch = (): Promise<Response> => new Promise(() => undefined);

export async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;

  // --- buildRequestBody contract -----------------------------------------------
  section("LLM body contract");
  check("deepseek-body", buildRequestBody(PROMPT, BASE, DS_CONFIG, false), {
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
  const geminiBody = buildRequestBody(PROMPT, BASE, GEMINI_CONFIG, false);
  check("gemini-no-response-format", "response_format" in geminiBody, false);
  check("gemini-no-thinking", "thinking" in geminiBody, false);
  check("gemini-model", geminiBody.model, "deepseek-v4-flash");

  // --- complete() HTTP semantics ------------------------------------------------
  section("LLM complete");
  // 1. Success: returns the content, sends the right URL/auth.
  stubFetch((url, init) => {
    check("success-url", url, "https://api.deepseek.com/chat/completions");
    check("success-auth", lastHeaders.Authorization, "Bearer sk-test");
    return jsonResponse({ choices: [{ message: { content: "hola" } }] });
  });
  const result = await deepseek.complete!(PROMPT, BASE);
  check("success-content", result, "hola");

  // 2. 401 → unauthorized, single attempt.
  fetchCalls = 0;
  stubFetch(() => jsonResponse({ error: { message: "Invalid API key" } }, 401));
  await checkRejects(
    "401-unauthorized",
    () => deepseek.complete!(PROMPT, BASE),
    (error) => error instanceof ProviderError && error.kind === "unauthorized",
  );
  check("401-single-attempt", fetchCalls, 1);

  // 3. Empty content in a 200 → empty-response, single attempt.
  fetchCalls = 0;
  stubFetch(() => jsonResponse({ choices: [{ message: { content: null } }] }));
  await checkRejects(
    "empty-content",
    () => deepseek.complete!(PROMPT, BASE),
    (error) => error instanceof ProviderError && error.kind === "empty-response",
  );
  check("empty-single-attempt", fetchCalls, 1);

  // 4. Timeout: hung request + small timeout override → ProviderError("timeout").
  stubFetch(hangingFetch);
  await checkRejects(
    "timeout",
    () => deepseek.complete!(PROMPT, BASE, { timeoutMs: 80 }),
    (error) => error instanceof ProviderError && error.kind === "timeout",
  );

  // 5. External abort → original AbortError propagates (silent cancellation).
  stubFetch(hangingFetch);
  const external = new AbortController();
  setTimeout(() => external.abort(), 20);
  await checkRejects(
    "external-abort",
    () => deepseek.complete!(PROMPT, BASE, { signal: external.signal }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );

  // 6. Rate limit: 429 retried 3 times (1.5s + 3s backoff) then typed error.
  fetchCalls = 0;
  stubFetch(() => jsonResponse({ error: { message: "Rate limit" } }, 429));
  await checkRejects(
    "rate-limit-retries-then-fails",
    () => deepseek.complete!(PROMPT, BASE),
    (error) => error instanceof ProviderError && error.kind === "rate-limit",
  );
  check("rate-limit-attempts", fetchCalls, 3);

  // 7. Network failure: retried 3 times then typed error.
  fetchCalls = 0;
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  await checkRejects(
    "network-retries-then-fails",
    () => deepseek.complete!(PROMPT, BASE),
    (error) => error instanceof ProviderError && error.kind === "network",
  );
  check("network-attempts", fetchCalls, 3);

  // 8. Custom provider reads the base URL from settings and needs no key.
  const customConfig: LLMProviderConfig = {
    id: "custom",
    label: "Custom",
    baseUrl: "",
    baseUrlFromSettings: true,
    models: [],
    defaultModel: "",
    keyPlaceholder: "",
    jsonMode: "response_format",
    needsKey: false,
  };
  const customProvider = createLLMProvider(customConfig);
  const customSettings = normalizeSettings({
    customBaseUrl: "http://localhost:11434/v1",
    providerKeys: {},
  });
  stubFetch(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
  await customProvider.complete!(PROMPT, customSettings);
  check("custom-url", lastUrl, "http://localhost:11434/v1/chat/completions");
  check("custom-auth-empty", lastHeaders.Authorization, "Bearer ");

  await flush(10);

  // --- Registry ------------------------------------------------------------------
  section("Registry");
  check("providers-count", PROVIDERS.length, 5);
  check(
    "provider-ids",
    getProviderIds(),
    ["deepseek", "openrouter", "gemini", "groq", "custom"],
  );
  check("get-by-id", getProvider("openrouter").label, "OpenRouter");
  check("get-unknown-falls-back", getProvider("nope").id, "deepseek");
  check("label", getProviderLabel("gemini"), "Google Gemini");
  check("custom-needs-no-key", getProvider("custom").needsKey, false);

  await flush(10);
  globalThis.fetch = originalFetch;
}
