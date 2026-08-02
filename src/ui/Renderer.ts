/**
 * Renderer — displays translations glued to their lyric lines (v6, content-
 * based flow insertion — the proven pattern, cleaned).
 *
 * What it does: keeps translations attached to their lyric lines using the
 * pattern proven by SpicyLyricTranslator on the current Spotify lyrics view:
 * track lines dynamically by CONTENT, insert each translation INTO THE FLOW
 * right after its line, and re-sync on every container mutation.
 *
 * How it works:
 * - `setContent(lines, translations)` stores the map keyed by the ORIGINAL
 *   LINE TEXT.
 * - `resync(container)` re-queries the CURRENT line elements and attaches a
 *   translation after every line whose text has an entry (`line.after()`).
 *   It is idempotent (lines that already have their translation are left
 *   untouched) and self-healing: React re-renders and row recycling are
 *   caught by the observer's raw `onDomMutated` hook, which re-runs resync
 *   within the same microtask — before the browser paints, so no flicker.
 * - Because the translations are in the flow, the lyrics container's own
 *   layout moves them automatically (the 2026 view animates line heights; the
 *   reflow carries the translations with it). NO positioning loop exists —
 *   previous attempts (a transform-correction loop and a fixed overlay layer)
 *   caused jitter, frozen positions and font mismatches.
 * - The active karaoke line is mirrored by adjacency: the translation whose
 *   previous sibling is the active line gets full opacity + an active class.
 *
 * Why it exists: see "How it works". The overlay layer (v5) broke fonts and
 * froze positions; the correction loop (v3/v4) fought the height animation.
 * Flow insertion + content matching has none of those failure modes.
 *
 * How to modify:
 * - Vertical gap under each line: `settings.lineSpacing` (margin-top).
 * - To place translations ABOVE the line, use `line.before()` instead.
 *
 * ⚠️ Breakage risk: if Spotify stops rendering lines as flow siblings inside
 * one container, `resolveLines` and the adjacency helpers need updating —
 * isolated to this file and `LyricsSelectors`.
 */
import { resolveLines } from "../lyrics/LyricsSelectors";
import {
  applyTranslationStyle,
  createTranslationLine,
  TRANSLATION_LINE_ACTIVE_CLASS,
} from "../components/TranslationLine";
import type { Settings } from "../settings/Settings";

const OWNED_SELECTOR = '[data-ai-lyrics-translation="true"]';

export class Renderer {
  private container: Element | null = null;
  private settings: Settings;
  private readonly translationsByOriginal = new Map<string, string>();
  private translationElements: HTMLElement[] = [];
  private activeIndex: number | null = null;

  constructor(getSettings: () => Settings) {
    this.settings = getSettings();
  }

  /**
   * Stores the translation content, keyed by original line text. Call before
   * `resync`.
   */
  setContent(lines: string[], translations: string[]): void {
    this.translationsByOriginal.clear();
    const count = Math.min(lines.length, translations.length);
    for (let i = 0; i < count; i++) {
      const key = lines[i].trim();
      if (key.length > 0) {
        this.translationsByOriginal.set(key, translations[i]);
      }
    }
  }

  /**
   * Re-syncs translations with the CURRENT lines of `container`. Idempotent.
   * Called after every container mutation (React re-creates line elements),
   * after `setContent`, on panel open and on settings changes.
   */
  /**
   * Re-attaches translations to the current lyric lines in the container.
   * Returns the number of translations present after the sync (0 when the
   * display mode is "original" or no line matched).
   */
  resync(container: Element): number {
    this.container = container;

    // "Original" mode: no translations at all — drop any previous ones.
    if (this.settings.displayMode === "original") {
      this.removeOwned(container);
      this.translationElements = [];
      this.activeIndex = null;
      return 0;
    }

    const owned = new Set<HTMLElement>();

    for (const line of resolveLines(container)) {
      const original = (line.textContent ?? "").trim();
      const translated = this.translationsByOriginal.get(original);
      if (translated === undefined) {
        continue;
      }

      const existing = this.findAttached(line);
      if (existing !== null) {
        owned.add(existing);
        continue;
      }

      const element = createTranslationLine(translated, this.settings);
      line.after(element);
      owned.add(element);
    }

    // Drop translations whose line no longer exists or no longer matches.
    this.removeStale(container, owned);
    this.translationElements = Array.from(owned);
    this.activeIndex = null;
    this.applyActiveState();
    return this.translationElements.length;
  }

  /**
   * Mirrors the karaoke active line by adjacency: the translation attached
   * right after `activeElement` gets full opacity + an active class; the rest
   * return to the configured value.
   */
  setActiveLine(activeElement: Element | null): void {
    let index: number | null = null;
    if (activeElement !== null) {
      index = this.translationElements.findIndex(
        (element) => element.previousElementSibling === activeElement,
      );
      if (index < 0) {
        index = null;
      }
    }
    if (index === this.activeIndex) {
      return;
    }
    this.activeIndex = index;
    this.applyActiveState();
  }

  /** Re-applies the current settings to every attached translation. */
  applySettings(settings: Settings): void {
    this.settings = settings;
    for (const element of this.translationElements) {
      applyTranslationStyle(element, settings);
    }
    this.applyActiveState();
  }

  /** Removes every translation and the content map (song change / panel close). */
  clear(): void {
    if (this.container) {
      this.removeOwned(this.container);
    }
    this.translationElements = [];
    this.container = null;
    this.activeIndex = null;
    this.translationsByOriginal.clear();
  }

  /** The translation attached right after `line`, or null. */
  private findAttached(line: Element): HTMLElement | null {
    const next = line.nextElementSibling;
    if (next !== null && next.matches(OWNED_SELECTOR)) {
      return next as HTMLElement;
    }
    return null;
  }

  private removeOwned(container: Element): void {
    for (const element of Array.from(container.querySelectorAll(OWNED_SELECTOR))) {
      element.remove();
    }
  }

  private removeStale(container: Element, owned: Set<HTMLElement>): void {
    for (const element of Array.from(container.querySelectorAll(OWNED_SELECTOR))) {
      if (!owned.has(element as HTMLElement)) {
        (element as HTMLElement).remove();
      }
    }
  }

  private applyActiveState(): void {
    for (let i = 0; i < this.translationElements.length; i++) {
      const element = this.translationElements[i];
      if (i === this.activeIndex) {
        element.style.opacity = "1";
        element.classList.add(TRANSLATION_LINE_ACTIVE_CLASS);
      } else {
        element.style.opacity = String(
          this.settings.displayMode === "translation" ? 1 : this.settings.opacity,
        );
        element.classList.remove(TRANSLATION_LINE_ACTIVE_CLASS);
      }
    }
  }
}
