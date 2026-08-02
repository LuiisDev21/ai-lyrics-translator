/**
 * Tests: DeepSeekProvider.complete — HTTP semantics with a stubbed global
 * fetch (node's Response/DOMException globals), covering the official body,
 * typed error mapping, retry behavior, timeout and external abort.
 */
import { check, checkRejects, flush, section } from "./helpers";
import {
  complete,
  DeepSeekError,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
} from "../src/translation/DeepSeekProvider";
import { normalizeSettings, type Settings } from "../src/settings/Settings";
import type { BuiltPrompt } from "../src/translation/PromptBuilder";

const PROMPT: BuiltPrompt = { system: "sys", user: "user" };
const FAST_SETTINGS = normalizeSettings({ apiKey: "sk-test", timeoutMs: 2000 });

type FetchHandler = (
  url: string,
  init: RequestInit,
) => Promise<Response> | Response;

let fetchCalls = 0;
let lastInit: RequestInit | undefined;

function stubFetch(handler: FetchHandler): void {
  fetchCalls = 0;
  lastInit = undefined;
  (globalThis as { fetch?: unknown }).fetch = (url: string, init: RequestInit) => {
    fetchCalls++;
    lastInit = init;
    return Promise.resolve(handler(url, init));
  };
}

function restoreFetch(): void {
  delete (globalThis as { fetch?: unknown }).fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fetch that never settles unless its signal is aborted (like a hung request). */
function hangingFetch(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });
}

export async function run(): Promise<void> {
  section("DeepSeekProvider");

  // 1. Success: returns content, correct URL, method, headers and body.
  stubFetch((url, init) => {
    check("request-url", url, DEEPSEEK_CHAT_COMPLETIONS_URL);
    check("request-method", init.method, "POST");
    check("request-auth", (init.headers as Record<string, string>).Authorization, "Bearer sk-test");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    check("request-model", body.model, "deepseek-v4-flash");
    check("request-json-mode", body.response_format, { type: "json_object" });
    return jsonResponse({
      choices: [{ message: { content: '[{"original":"a","translated":"b"}]' } }],
    });
  });
  const content = await complete(PROMPT, FAST_SETTINGS);
  check("success-content", content, '[{"original":"a","translated":"b"}]');

  // 2. 401 → unauthorized, single attempt, API message preserved.
  stubFetch(() =>
    jsonResponse({ error: { message: "Invalid API key" } }, 401),
  );
  await checkRejects(
    "401-unauthorized",
    () => complete(PROMPT, FAST_SETTINGS),
    (error) =>
      error instanceof DeepSeekError &&
      error.kind === "unauthorized" &&
      error.status === 401 &&
      error.message === "Invalid API key",
  );
  check("401-single-attempt", fetchCalls, 1);

  // 3. Empty content in a 200 → empty-response, single attempt.
  stubFetch(() => jsonResponse({ choices: [{ message: { content: null } }] }));
  await checkRejects(
    "empty-content",
    () => complete(PROMPT, FAST_SETTINGS),
    (error) => error instanceof DeepSeekError && error.kind === "empty-response",
  );
  check("empty-single-attempt", fetchCalls, 1);

  // 4. Timeout: hung request + small timeout override → DeepSeekError("timeout").
  stubFetch(hangingFetch);
  await checkRejects(
    "timeout",
    () => complete(PROMPT, FAST_SETTINGS, { timeoutMs: 80 }),
    (error) => error instanceof DeepSeekError && error.kind === "timeout",
  );

  // 5. External abort → original AbortError propagates (silent cancellation).
  stubFetch(hangingFetch);
  const external = new AbortController();
  setTimeout(() => external.abort(), 20);
  await checkRejects(
    "external-abort",
    () => complete(PROMPT, FAST_SETTINGS, { signal: external.signal }),
    (error) => error instanceof DOMException && error.name === "AbortError",
  );

  // 6. Rate limit: 429 retried 3 times (1.5s + 3s backoff) then typed error.
  stubFetch(() => jsonResponse({ error: { message: "Rate limit" } }, 429));
  await checkRejects(
    "rate-limit-retries-then-fails",
    () => complete(PROMPT, FAST_SETTINGS),
    (error) => error instanceof DeepSeekError && error.kind === "rate-limit",
  );
  check("rate-limit-attempts", fetchCalls, 3);

  // 7. Network failure: retried 3 times then typed error.
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  await checkRejects(
    "network-retries-then-fails",
    () => complete(PROMPT, FAST_SETTINGS),
    (error) => error instanceof DeepSeekError && error.kind === "network",
  );
  check("network-attempts", fetchCalls, 3);

  // 8. Body contract: thinking always disabled → no reasoning_effort key at all.
  stubFetch((_url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    check("thinking-disabled", body.thinking, { type: "disabled" });
    check("no-reasoning-effort", "reasoning_effort" in body, false);
    return jsonResponse({ choices: [{ message: { content: "ok" } }] });
  });
  await complete(PROMPT, FAST_SETTINGS);

  await flush(10);
  restoreFetch();
}
