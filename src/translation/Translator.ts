/**
 * Translator — orchestration of the translation pipeline.
 *
 * What it does: given a track and the lyrics container, it runs the full
 * pipeline — extract lines → check caches → build prompt → request DeepSeek →
 * tolerant parse (with one retry on invalid JSON, per spec) → validate line
 * count → persist to both caches → emit the aligned result. It also exposes
 * `cancel()` (aborts any in-flight request) and `refresh()` (skips the cache
 * read).
 *
 * How it works: each call owns an `AbortController`; starting a new
 * translation automatically cancels the previous one, and the composition root
 * calls `cancel()` on song change so a stale request can never render onto a
 * different song. Status and results are emitted through the callbacks in
 * `TranslatorDeps` — the UI subscribes to `onStatus` (loading/error states)
 * and `onTranslated` (aligned original + translated line arrays).
 *
 * Why it exists: this is the only module allowed to sequence the pipeline.
 * Lyrics extraction, prompting, parsing, caching and rendering are all
 * isolated; the Translator is the glue, which keeps every other module single-
 * responsibility and independently testable.
 *
 * How to modify:
 * - Error texts live in `friendlyMessage` — the single place mapping provider
 *   errors to user-facing messages.
 * - Retry policy: parse failures retry once (`MAX_PARSE_ATTEMPTS = 2`);
 *   transient network/rate-limit retries belong to the provider, not here.
 * - The cache contract (`TranslationCache`) is defined in the cache layer and
 *   imported here — the Translator consumes the abstraction, never the
 *   concrete classes.
 */
import { extractLyrics } from "../lyrics/LyricsExtractor";
import { buildPrompt, type BuiltPrompt } from "./PromptBuilder";
import { parseTranslationResponse } from "./JsonParser";
import { complete, DeepSeekError, type RequestOptions } from "./DeepSeekProvider";
import type { TranslationCache } from "../cache/MemoryCache";
import { logger } from "../utils/Logger";
import type { CurrentTrack } from "../player/SongListener";
import type { Settings } from "../settings/Settings";

export type TranslationStatus = "idle" | "translating" | "ready" | "error";

export type TranslationStatusListener = (
  status: TranslationStatus,
  message?: string,
) => void;

/** Emitted with aligned arrays — `lines[i]` ↔ `translations[i]`. */
export type TranslationListener = (
  track: CurrentTrack,
  lines: string[],
  translations: string[],
) => void;

export interface TranslatorDeps {
  memoryCache: TranslationCache;
  persistentCache: TranslationCache;
  /** Returns the current validated settings on every call. */
  getSettings: () => Settings;
  /** Injectable request function (defaults to the DeepSeek provider). */
  completeRequest?: (
    prompt: BuiltPrompt,
    settings: Settings,
    options: RequestOptions,
  ) => Promise<string>;
  onStatus?: TranslationStatusListener;
  onTranslated?: TranslationListener;
}

/** Total attempts for a translation (1 initial + 1 retry on invalid JSON). */
const MAX_PARSE_ATTEMPTS = 2;

export class Translator {
  private activeController: AbortController | null = null;

  constructor(private readonly deps: TranslatorDeps) {}

  /** Aborts any in-flight translation (e.g. on song change). Silent. */
  cancel(): void {
    this.activeController?.abort();
    this.activeController = null;
  }

  /** Translates `track`'s lyrics found in `container`, cache-first. */
  async translate(track: CurrentTrack, container: Element): Promise<void> {
    await this.run(track, container, false);
  }

  /** Re-translates from scratch, bypassing the cache read (still writes). */
  async refresh(track: CurrentTrack, container: Element): Promise<void> {
    await this.run(track, container, true);
  }

  private async run(
    track: CurrentTrack,
    container: Element,
    force: boolean,
  ): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.activeController = controller;

    const extraction = extractLyrics(container);
    if (extraction.lines.length === 0) {
      this.emitStatus("error", "No hay letras disponibles para esta canción.");
      return;
    }

    if (!force) {
      const cached =
        this.deps.memoryCache.get(track.id) ?? this.deps.persistentCache.get(track.id);
      if (cached !== null && cached.length === extraction.lines.length) {
        logger.debug(`Cache hit for ${track.id}.`);
        this.emitTranslated(track, extraction.lines, cached);
        this.emitStatus("ready");
        return;
      }
    }

    const settings = this.deps.getSettings();
    if (!settings.apiKey) {
      this.emitStatus("error", "Falta la API key de DeepSeek. Configúrala en los ajustes.");
      return;
    }

    this.emitStatus("translating");
    logger.info(`Translating ${track.name} (${extraction.lines.length} lines).`);

    const prompt = buildPrompt(extraction.lines, {
      targetLanguage: settings.targetLanguage,
      songTitle: track.name,
      artist: track.artist,
    });

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      if (controller.signal.aborted) {
        return;
      }

      try {
        const raw = await this.request(prompt, settings, controller.signal);

        const parsed = parseTranslationResponse(raw);
        if (!parsed.ok) {
          logger.warn(
            `Invalid translation JSON (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}): ${parsed.reason}`,
          );
          if (attempt < MAX_PARSE_ATTEMPTS) {
            continue;
          }
          this.emitStatus(
            "error",
            "La IA devolvió una respuesta inválida. Usa «Refrescar» para reintentar.",
          );
          return;
        }

        if (parsed.entries.length !== extraction.lines.length) {
          logger.warn(
            `Translation count mismatch (attempt ${attempt}): got ${parsed.entries.length}, expected ${extraction.lines.length}`,
          );
          if (attempt < MAX_PARSE_ATTEMPTS) {
            continue;
          }
          this.emitStatus(
            "error",
            "La traducción no coincide con las líneas de la canción. Usa «Refrescar».",
          );
          return;
        }

        const translations = parsed.entries.map((entry) => entry.translated);
        this.deps.memoryCache.set(track.id, translations);
        this.deps.persistentCache.set(track.id, translations);
        logger.info(`Translation ready for ${track.id}.`);

        this.emitTranslated(track, extraction.lines, translations);
        this.emitStatus("ready");
        return;
      } catch (error) {
        if (this.isCancellation(error, controller)) {
          logger.debug("Translation cancelled.");
          return;
        }
        logger.error("Translation failed.", error);
        this.emitStatus("error", friendlyMessage(error));
        return;
      }
    }
  }

  private async request(
    prompt: BuiltPrompt,
    settings: Settings,
    signal: AbortSignal,
  ): Promise<string> {
    if (this.deps.completeRequest) {
      return this.deps.completeRequest(prompt, settings, { signal });
    }
    return complete(prompt, settings, { signal });
  }

  /** True when the failure is a user/song-change cancellation (stay silent). */
  private isCancellation(error: unknown, controller: AbortController): boolean {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    if (error instanceof DeepSeekError && error.kind === "network") {
      // A fetch aborted mid-flight can surface as a network error on some
      // Chromium versions; a cancelled controller is authoritative.
      return controller.signal.aborted;
    }
    return controller.signal.aborted;
  }

  private emitStatus(status: TranslationStatus, message?: string): void {
    try {
      this.deps.onStatus?.(status, message);
    } catch (error) {
      logger.error("Status listener threw.", error);
    }
  }

  private emitTranslated(
    track: CurrentTrack,
    lines: string[],
    translations: string[],
  ): void {
    try {
      this.deps.onTranslated?.(track, lines, translations);
    } catch (error) {
      logger.error("Translation listener threw.", error);
    }
  }
}

/** Maps typed provider errors (and unknown errors) to user-facing messages. */
function friendlyMessage(error: unknown): string {
  if (error instanceof DeepSeekError) {
    switch (error.kind) {
      case "unauthorized":
        return "API key de DeepSeek inválida. Revísala en los ajustes.";
      case "rate-limit":
        return "Límite de peticiones de DeepSeek alcanzado. Espera unos segundos e inténtalo de nuevo.";
      case "timeout":
        return "La traducción tardó demasiado. Aumenta el timeout en los ajustes.";
      case "network":
        return "Error de red. Comprueba tu conexión e inténtalo de nuevo.";
      case "empty-response":
        return "DeepSeek devolvió una respuesta vacía. Usa «Refrescar» para reintentar.";
      case "api":
        return `Error de DeepSeek${error.status !== undefined ? ` (${error.status})` : ""}. Inténtalo de nuevo.`;
    }
  }
  return "Error inesperado al traducir.";
}
