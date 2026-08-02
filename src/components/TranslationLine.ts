/**
 * TranslationLine — builds and styles a single translated lyric line.
 *
 * What it does: creates the `<div>` that is inserted directly under a Spotify
 * lyric line, and applies the user's rendering settings (color, font size,
 * font family, spacing, opacity) to it via inline styles.
 *
 * How it works: `createTranslationLine` creates a div flagged with
 * `data-ai-lyrics-translation` (so the Renderer can find and remove its own
 * elements without touching Spotify's), then delegates to
 * `applyTranslationStyle`. Opacity is a separate concern
 * (`applyTranslationOpacity`) because the Renderer toggles it when mirroring
 * the karaoke active line: active = full opacity, inactive = the configured
 * value. In "translation" display mode the configured opacity is ignored and
 * translations render at full emphasis (the "show translation" mode); in
 * "both" mode they render at `settings.opacity`.
 *
 * Why it exists: rendering settings live in exactly one place, so restyling
 * after a settings change is a single call per element.
 *
 * How to modify:
 * - To change what a translation line looks like, edit
 *   `applyTranslationStyle`. Keep margin-top as the spacing driver — the
 *   Renderer's index alignment assumes nothing about element geometry.
 * - Never set `innerHTML` here: lyrics/translations are untrusted content.
 */
import { createElement } from "../utils/Dom";
import type { Settings } from "../settings/Settings";

/** Attribute flagging elements owned by the extension (for cleanup). */
export const TRANSLATION_LINE_ATTR = "data-ai-lyrics-translation";
export const TRANSLATION_LINE_CLASS = "ai-lyrics-translator__line";
export const TRANSLATION_LINE_ACTIVE_CLASS = "ai-lyrics-translator__line--active";

export function createTranslationLine(
  text: string,
  settings: Settings,
): HTMLDivElement {
  const el = createElement("div", {
    className: TRANSLATION_LINE_CLASS,
    attrs: { [TRANSLATION_LINE_ATTR]: "true" },
    text,
  });
  applyTranslationStyle(el, settings);
  return el;
}

/** Applies the full rendering style for `settings` to an existing element. */
export function applyTranslationStyle(el: HTMLElement, settings: Settings): void {
  el.style.color = settings.color;
  el.style.fontSize = `${settings.fontSize}px`;
  el.style.lineHeight = "1.4";
  el.style.fontWeight = "400";
  el.style.textAlign = "inherit";
  el.style.marginTop = `${settings.lineSpacing}px`;
  el.style.marginBottom = "0";
  el.style.marginLeft = "0";
  el.style.marginRight = "0";

  if (settings.fontFamily.length > 0) {
    el.style.fontFamily = settings.fontFamily;
  } else {
    el.style.removeProperty("font-family");
  }

  applyTranslationOpacity(el, settings);
}

/**
 * Applies just the opacity: full in "translation" mode, configured value in
 * "both" mode. The Renderer overrides this for the active karaoke line.
 */
export function applyTranslationOpacity(el: HTMLElement, settings: Settings): void {
  el.style.opacity =
    settings.displayMode === "translation" ? "1" : String(settings.opacity);
}
