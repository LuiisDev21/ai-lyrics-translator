/**
 * providers/llm — generic OpenAI-compatible chat provider factory.
 *
 * What it does: one implementation of the "llm" provider kind for every
 * OpenAI-compatible chat completions API: DeepSeek, OpenRouter, Google Gemini
 * (via its official OpenAI-compat endpoint), Groq and custom endpoints
 * (Ollama, LM Studio, llama.cpp, OpenWebUI…). The only differences between
 * them are the base URL, the model list and two request-body flags
 * (`jsonMode`, `sendsThinking`), so a single parameterized factory covers all
 * of them.
 *
 * How it works: `createLLMProvider(config)` returns a `TranslationProvider`
 * whose `complete()` POSTs the built prompt to `<baseUrl>/chat/completions`
 * with `Authorization: Bearer <key from settings.providerKeys[provider.id]>`.
 * The request body follows the official DeepSeek docs (temperature 1.3,
 * thinking disabled) with provider-specific knobs:
 * - `jsonMode: "response_format"` sends `response_format: {type: "json_object"}`
 *   (DeepSeek, OpenRouter, Groq, custom); `"prompt"` omits it (Gemini) and
 *   relies on the prompt + the tolerant parser.
 * - `sendsThinking: true` sends `thinking: {type: "disabled"}` (DeepSeek);
 *   other OpenAI-compatible servers may reject unknown fields, so it is
 *   omitted for them.
 * Transient failures (429 / network) retry 3 times with exponential backoff;
 * external aborts propagate as AbortError (silent cancellation); timeouts
 * become `ProviderError("timeout")`. SSE streaming is implemented (used by
 * the `stream` option) although the Translator keeps `stream: false`.
 *
 * Why it exists: five providers share ~95% of their code; duplicating it per
 * provider would be a maintenance nightmare. The registry instantiates each
 * provider from a small config object.
 *
 * How to modify: add a provider by instantiating `createLLMProvider` in
 * `registry.ts` with its base URL, models and flags — no code changes here.
 */
import type { BuiltPrompt } from "../translation/PromptBuilder";
import type { Settings } from "../settings/Settings";
import {
  ProviderError,
  type RequestOptions,
  type TranslationProvider,
} from "./types";
import { logger } from "../utils/Logger";
import { retryWithBackoff } from "../utils/Retry";

/**
 * Fixed AI parameters (not user-configurable — the settings panel only exposes
 * the model). Values follow the official DeepSeek docs: temperature 1.3 for
 * translation/chat, thinking disabled, 60s timeout.
 */
export const DEFAULT_TEMPERATURE = 1.3;
export const DEFAULT_TIMEOUT_MS = 60000;

/** How many total attempts for transient failures (1 initial + 2 retries). */
const TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_BASE_DELAY_MS = 1500;

export interface LLMProviderConfig {
  id: TranslationProvider["id"];
  label: string;
  baseUrl: string;
  models: readonly string[];
  defaultModel: string;
  keyPlaceholder: string;
  /** "response_format" (OpenAI json_object) vs "prompt" (Gemini: no response_format). */
  jsonMode: "response_format" | "prompt";
  /** DeepSeek sends `thinking`; other OpenAI-compatible servers may reject it. */
  sendsThinking?: boolean;
  /** Custom providers read the base URL from `settings.customBaseUrl`. */
  baseUrlFromSettings?: boolean;
  needsKey?: boolean;
}

/**
 * Assembles the request body per the OpenAI-compatible contract. Pure and
 * exported so the body can be unit-tested without a network call.
 */
export function buildRequestBody(
  prompt: BuiltPrompt,
  settings: Settings,
  config: LLMProviderConfig,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: DEFAULT_TEMPERATURE,
    stream,
  };
  if (config.jsonMode === "response_format") {
    body.response_format = { type: "json_object" };
  }
  if (config.sendsThinking) {
    body.thinking = { type: "disabled" };
  }
  return body;
}

/** Resolves the base URL (custom providers take it from settings). */
function resolveBaseUrl(config: LLMProviderConfig, settings: Settings): string {
  if (config.baseUrlFromSettings) {
    const custom = settings.customBaseUrl.trim();
    if (custom.length === 0) {
      throw new ProviderError("api", "Falta la URL base del endpoint personalizado.");
    }
    return custom.replace(/\/+$/, "");
  }
  return config.baseUrl;
}

export function createLLMProvider(config: LLMProviderConfig): TranslationProvider {
  const complete = async (
    prompt: BuiltPrompt,
    settings: Settings,
    options: RequestOptions = {},
  ): Promise<string> => {
    const run = async (): Promise<string> => {
      if (options.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return attempt(prompt, settings, options, config);
    };

    return retryWithBackoff(run, {
      attempts: TRANSIENT_ATTEMPTS,
      baseDelayMs: TRANSIENT_BASE_DELAY_MS,
      factor: 2,
      shouldRetry: (error) =>
        error instanceof ProviderError &&
        (error.kind === "rate-limit" || error.kind === "network"),
    });
  };

  return {
    id: config.id,
    label: config.label,
    kind: "llm",
    models: config.models,
    defaultModel: config.defaultModel,
    keyPlaceholder: config.keyPlaceholder,
    needsKey: config.needsKey ?? true,
    complete,
  };
}

async function attempt(
  prompt: BuiltPrompt,
  settings: Settings,
  options: RequestOptions,
  config: LLMProviderConfig,
): Promise<string> {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", onExternalAbort);

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const url = `${resolveBaseUrl(config, settings)}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.providerKeys[config.id] ?? ""}`,
      },
      body: JSON.stringify(buildRequestBody(prompt, settings, config, options.stream ?? false)),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await mapHttpError(response, config.label);
    }

    if (options.stream) {
      return await consumeStream(response, options.onDelta, config.label);
    }

    const content = extractContent(await response.json().catch(() => null));
    if (content === null) {
      throw new ProviderError(
        "empty-response",
        `${config.label} returned an empty content field.`,
      );
    }
    return content;
  } catch (error) {
    // External (caller) abort: propagate the original AbortError untouched so
    // callers can detect cancellation and stay silent.
    if (options.signal?.aborted) {
      throw error;
    }

    if (error instanceof ProviderError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      // Only our timeout could have aborted at this point.
      throw new ProviderError(
        "timeout",
        `Request timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
        timedOut ? undefined : 0,
      );
    }

    throw new ProviderError(
      "network",
      error instanceof Error ? error.message : "Network error.",
    );
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/** Reads the model content out of the OpenAI-compatible response envelope. */
function extractContent(data: unknown): string | null {
  if (data === null || typeof data !== "object") {
    return null;
  }
  const firstChoice = Array.isArray((data as { choices?: unknown }).choices)
    ? (data as { choices: unknown[] }).choices[0]
    : undefined;
  if (firstChoice === null || typeof firstChoice !== "object") {
    return null;
  }
  const message = (firstChoice as { message?: unknown }).message;
  if (message === null || typeof message !== "object") {
    return null;
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/** Maps non-2xx responses to typed errors, keeping the API's message when available. */
async function mapHttpError(
  response: Response,
  label: string,
): Promise<ProviderError> {
  let message = `HTTP ${response.status} ${response.statusText}`;
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object") {
      const apiMessage = (body as { error?: { message?: unknown } }).error?.message;
      if (typeof apiMessage === "string" && apiMessage.length > 0) {
        message = apiMessage;
      }
    }
  } catch {
    // Non-JSON error body — keep the status-based message.
  }

  switch (response.status) {
    case 401:
      return new ProviderError("unauthorized", message, 401);
    case 429:
      return new ProviderError("rate-limit", message, 429);
    default:
      return new ProviderError("api", `${label}: ${message}`, response.status);
  }
}

/**
 * Consumes an SSE stream (`data:` lines, `[DONE]` terminator) and returns the
 * concatenated content. Deltas are forwarded through `onDelta` for
 * incremental UI. Currently unused by the Translator (stream is off).
 */
async function consumeStream(
  response: Response,
  onDelta?: (delta: string) => void,
  label = "Provider",
): Promise<string> {
  if (!response.body) {
    throw new ProviderError("api", "Response body is missing for streaming.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") {
        return full;
      }
      try {
        const chunk: unknown = JSON.parse(payload);
        const delta = (chunk as { choices?: { delta?: { content?: unknown } }[] })
          ?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") {
          full += delta;
          onDelta?.(delta);
        }
      } catch {
        logger.debug(`[${label}] Ignoring non-JSON SSE payload:`, payload);
      }
    }
  }
  return full;
}
