/**
 * providers/registry — the provider registry (single registration point).
 *
 * What it does: instantiates every translation provider (LLM providers via
 * `createLLMProvider` with their config, direct providers as standalone
 * objects) and exposes lookup by id with a safe fallback.
 *
 * Why it exists: the Translator, the settings panel and the composition root
 * all resolve providers through `getProvider(id)` — adding or removing a
 * provider touches ONLY this file (plus `PROVIDER_IDS` in `types.ts`).
 *
 * How to modify: to add a provider, create the instance here and add its id
 * to `PROVIDER_IDS`. The default fallback is DeepSeek, so an unknown stored
 * provider id degrades gracefully instead of breaking the extension.
 */
import { createLLMProvider } from "./llm";
import type { ProviderId, TranslationProvider } from "./types";

const deepseek = createLLMProvider({
  id: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  models: ["deepseek-v4-flash", "deepseek-v4-pro"],
  defaultModel: "deepseek-v4-flash",
  keyPlaceholder: "sk-...",
  jsonMode: "response_format",
  sendsThinking: true,
});

const openrouter = createLLMProvider({
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  models: [
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct",
    "openai/gpt-4o-mini",
    "anthropic/claude-3-5-haiku",
    "google/gemini-2.0-flash-001",
  ],
  defaultModel: "deepseek/deepseek-chat",
  keyPlaceholder: "sk-or-...",
  jsonMode: "response_format",
});

const gemini = createLLMProvider({
  id: "gemini",
  label: "Google Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  defaultModel: "gemini-2.0-flash",
  keyPlaceholder: "AIza...",
  // Gemini's OpenAI-compat layer has limited response_format support: rely on
  // the prompt + the tolerant parser instead.
  jsonMode: "prompt",
});

const groq = createLLMProvider({
  id: "groq",
  label: "Groq",
  baseUrl: "https://api.groq.com/openai/v1",
  models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  defaultModel: "llama-3.3-70b-versatile",
  keyPlaceholder: "gsk_...",
  jsonMode: "response_format",
});

/** Catch-all for any OpenAI-compatible endpoint (Ollama, LM Studio, ...). */
const custom = createLLMProvider({
  id: "custom",
  label: "Endpoint personalizado",
  baseUrl: "",
  baseUrlFromSettings: true,
  models: [],
  defaultModel: "",
  keyPlaceholder: "(opcional para servidores locales)",
  jsonMode: "response_format",
  needsKey: false,
});

export const PROVIDERS: readonly TranslationProvider[] = [
  deepseek,
  openrouter,
  gemini,
  groq,
  custom,
];

const BY_ID = new Map<string, TranslationProvider>(
  PROVIDERS.map((provider) => [provider.id, provider]),
);

/** Resolves a provider by id, falling back to DeepSeek for unknown ids. */
export function getProvider(id: string): TranslationProvider {
  return BY_ID.get(id) ?? deepseek;
}

/** Human-readable label for the settings panel. */
export function getProviderLabel(id: string): string {
  return getProvider(id).label;
}

/** List of provider ids in display order. */
export function getProviderIds(): readonly ProviderId[] {
  return PROVIDERS.map((provider) => provider.id);
}
