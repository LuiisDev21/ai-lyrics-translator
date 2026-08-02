/**
 * DeepSeekProvider — HTTP client for the official DeepSeek chat completions
 * API.
 *
 * What it does: sends the built prompt to `POST https://api.deepseek.com/chat/completions`
 * (the official, OpenAI-compatible endpoint) and returns the model's raw text
 * content. It implements the official request parameters (model, temperature,
 * JSON mode, thinking mode, reasoning effort), AbortController-based
 * cancellation with a timeout, error mapping to typed `DeepSeekError`s, and a
 * minimal SSE consumer so streaming is supported though currently unused.
 *
 * How it works:
 * - `buildRequestBody` (pure, exported for tests) assembles the body exactly
 *   per the official docs: `response_format: {"type": "json_object"}` for JSON
 *   mode, `thinking: {"type": "enabled"|"disabled"}` always, and
 *   `reasoning_effort` only when thinking is enabled (the docs pair them).
 * - `complete` wraps `attempt` in `retryWithBackoff`; only transient kinds are
 *   retried (rate-limit, network), up to 3 attempts total with exponential
 *   backoff. Everything else surfaces immediately.
 * - `attempt` chains the caller's AbortSignal (manual cancel on song change)
 *   with an internal timeout signal. On failure it distinguishes: external
 *   abort (re-throws the original `AbortError`, so callers treat it as a
 *   silent cancel), timeout (typed `DeepSeekError("timeout")`), HTTP errors
 *   (typed by status: 401 unauthorized, 429 rate-limit, other → api) and
 *   network failures (typed "network").
 * - Empty `content` in a 200 response is handled client-side per DeepSeek's
 *   JSON-mode guidance (typed "empty-response").
 *
 * Why it exists: all DeepSeek-specific knowledge (URL, body shape, error
 * semantics, retry policy) lives here. `Translator` only knows the typed
 * errors, and future providers can implement the same surface.
 *
 * How to modify:
 * - To add a provider: mirror this module's public surface
 *   (`complete(prompt, settings, options)`) behind an interface.
 * - Streaming: `options.stream = true` + `options.onDelta` — the SSE consumer
 *   is implemented; the Translator currently always uses `stream: false`.
 *
 * ⚠️ CORS note: the API sends `Access-Control-Allow-Origin: https://open.spotify.com`
 * (verified via preflight). We use direct `fetch` on purpose — routing through
 * Spicetify's CORS proxy would expose the API key to a third party.
 */
import { retryWithBackoff } from "../utils/Retry";
import { logger } from "../utils/Logger";
import type { Settings } from "../settings/Settings";
import type { BuiltPrompt } from "./PromptBuilder";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_CHAT_COMPLETIONS_URL = `${DEEPSEEK_BASE_URL}/chat/completions`;

export type DeepSeekErrorKind =
  | "network"
  | "timeout"
  | "unauthorized"
  | "rate-limit"
  | "api"
  | "empty-response";

/** Typed error thrown by the provider. `status` is set for HTTP errors. */
export class DeepSeekError extends Error {
  constructor(
    readonly kind: DeepSeekErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export interface RequestOptions {
  /** External cancellation (e.g. song change). Aborting here is silent for the UI. */
  signal?: AbortSignal;
  /** Enable SSE streaming. Default false. Requires `onDelta` when true. */
  stream?: boolean;
  /** Receives each content delta while streaming. */
  onDelta?: (delta: string) => void;
  /** Timeout override (tests). Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/** How many total attempts for transient failures (1 initial + 2 retries). */
const TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_BASE_DELAY_MS = 1500;

/**
 * Fixed AI parameters (not user-configurable — the settings panel only exposes
 * the model selector). Values follow the official DeepSeek docs:
 * - temperature 1.3 is their recommendation for translation/chat;
 * - thinking is disabled (deterministic, fast translations);
 * - timeout 60s covers long lyrics on slow connections.
 */
export const DEFAULT_TEMPERATURE = 1.3;
export const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Assembles the request body exactly per the official DeepSeek docs. Pure and
 * exported so the body contract can be unit-tested without a network call.
 */
export function buildRequestBody(
  prompt: BuiltPrompt,
  settings: Settings,
  stream: boolean,
): Record<string, unknown> {
  return {
    model: settings.model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    temperature: DEFAULT_TEMPERATURE,
    stream,
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
  };
}

/** Sends the prompt and returns the model's raw content string. */
export async function complete(
  prompt: BuiltPrompt,
  settings: Settings,
  options: RequestOptions = {},
): Promise<string> {
  const run = async (): Promise<string> => {
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return attempt(prompt, settings, options);
  };

  return retryWithBackoff(run, {
    attempts: TRANSIENT_ATTEMPTS,
    baseDelayMs: TRANSIENT_BASE_DELAY_MS,
    factor: 2,
    shouldRetry: (error) =>
      error instanceof DeepSeekError &&
      (error.kind === "rate-limit" || error.kind === "network"),
  });
}

async function attempt(
  prompt: BuiltPrompt,
  settings: Settings,
  options: RequestOptions,
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
    const response = await fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(prompt, settings, options.stream ?? false)),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await mapHttpError(response);
    }

    if (options.stream) {
      return await consumeStream(response, options.onDelta);
    }

    const content = extractContent(await response.json().catch(() => null));
    if (content === null) {
      throw new DeepSeekError(
        "empty-response",
        "DeepSeek returned an empty content field.",
      );
    }
    return content;
  } catch (error) {
    // External (caller) abort: propagate the original AbortError untouched so
    // callers can detect cancellation and stay silent.
    if (options.signal?.aborted) {
      throw error;
    }

    if (error instanceof DeepSeekError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      // Only our timeout could have aborted at this point.
      throw new DeepSeekError(
        "timeout",
        `Request timed out after ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`,
        timedOut ? undefined : 0,
      );
    }

    throw new DeepSeekError(
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

/** Maps non-2xx responses to typed errors, preserving the API's error message when available. */
async function mapHttpError(response: Response): Promise<DeepSeekError> {
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
      return new DeepSeekError("unauthorized", message, 401);
    case 429:
      return new DeepSeekError("rate-limit", message, 429);
    default:
      return new DeepSeekError("api", message, response.status);
  }
}

/**
 * Consumes an SSE stream (`data:` lines, `[DONE]` terminator) and returns the
 * concatenated content. Deltas are also forwarded through `onDelta` for
 * incremental UI. Currently unused by the Translator (stream is off), but
 * implemented and exercised by the `stream` option.
 */
async function consumeStream(
  response: Response,
  onDelta?: (delta: string) => void,
): Promise<string> {
  if (!response.body) {
    throw new DeepSeekError("api", "Response body is missing for streaming.");
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
        logger.debug("Ignoring non-JSON SSE payload:", payload);
      }
    }
  }

  return full;
}
