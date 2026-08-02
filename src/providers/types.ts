/**
 * providers/types — the provider contract (pure types, no logic).
 *
 * What it does: defines the abstraction every translation provider implements
 * and the shared error type the whole pipeline understands.
 *
 * Why it exists: the Translator must be provider-agnostic. Two provider kinds
 * exist:
 * - "llm" — OpenAI-compatible chat completions (DeepSeek, OpenRouter, Gemini
 *   via its OpenAI endpoint, Groq, custom endpoints). They receive a built
 *   prompt and return raw text; the Translator owns prompting, tolerant JSON
 *   parsing and retries.
 * - "direct" — dedicated translation APIs (DeepL) that translate plain lines
 *   in one REST call and return the translated lines directly; no JSON
 *   parsing needed.
 *
 * How to modify: to add a provider, implement this interface in a new file,
 * register it in `registry.ts`, and add its id to `PROVIDER_IDS`. The
 * settings panel, Translator and caches need no changes.
 */
import type { BuiltPrompt } from "../translation/PromptBuilder";
import type { Settings } from "../settings/Settings";

/** All registered provider ids. Settings validation uses this list. */
export const PROVIDER_IDS = [
  "deepseek",
  "openrouter",
  "gemini",
  "groq",
  "custom",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** "llm" = OpenAI-compatible chat; "direct" = dedicated translation API. */
export type ProviderKind = "llm" | "direct";

export interface RequestOptions {
  /** External cancellation (e.g. song change). Aborting here is silent for the UI. */
  signal?: AbortSignal;
  /** Enable SSE streaming. Default false. Requires `onDelta` when true. */
  stream?: boolean;
  /** Receives each content delta while streaming. */
  onDelta?: (delta: string) => void;
  /** Timeout override (tests). Defaults to the provider's constant. */
  timeoutMs?: number;
}

export type ProviderErrorKind =
  | "network"
  | "timeout"
  | "unauthorized"
  | "rate-limit"
  | "api"
  | "empty-response";

/** Typed provider failure — the Translator maps kinds to friendly messages. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface TranslationProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: ProviderKind;
  /** Model suggestions for the panel (rendered as a datalist). Empty = free text only. */
  readonly models: readonly string[];
  readonly defaultModel: string;
  /** Placeholder shown in the API-key field. */
  readonly keyPlaceholder: string;
  /** False for local endpoints (custom/Ollama) that need no key. */
  readonly needsKey: boolean;
  /** LLM providers: raw OpenAI-compatible completion. */
  complete?(
    prompt: BuiltPrompt,
    settings: Settings,
    options: RequestOptions,
  ): Promise<string>;
  /** Direct providers: translate lines in one REST call, returning aligned texts. */
  translateLines?(
    lines: string[],
    targetLanguage: string,
    settings: Settings,
    options: RequestOptions,
  ): Promise<string[]>;
}
