/**
 * Settings — typed settings model, defaults and validation.
 *
 * What it does: defines the complete configuration surface of the extension
 * (DeepSeek credentials, translation behavior and rendering style) as a single
 * immutable interface, plus a `normalizeSettings` function that takes any
 * unknown/partial value (typically parsed from localStorage) and returns a
 * fully valid `Settings` object.
 *
 * How it works: `normalizeSettings` starts from `DEFAULT_SETTINGS` and only
 * overrides fields whose raw value is present AND valid. Invalid or missing
 * fields silently fall back to the default, so a corrupted storage entry can
 * never produce a broken runtime state. Numeric fields are clamped to their
 * documented ranges; enum-like fields are checked against their allowed
 * values.
 *
 * Why it exists: configuration is the single most common source of runtime
 * bugs in extensions (a `null` temperature, a 4-character hex color, an empty
 * model name). Centralizing the shape and the sanitization in one module means
 * every consumer (`ConfigStore`, `DeepSeekProvider`, `Renderer`,
 * `SettingsPanel`) can trust the object it receives.
 *
 * How to modify:
 * - To add a setting: add the field to `Settings`, give it a default in
 *   `DEFAULT_SETTINGS` and a validation branch in `normalizeSettings`.
 * - To change ranges (e.g. allow bigger fonts), adjust the clamp constants.
 *
 * Design decision — display mode: the spec lists "show original", "show
 * translation" and "show both" as three flags. Three booleans with a
 * mutual-exclusion invariant are a bug farm (what happens when all are
 * false?), so this is modeled as one `DisplayMode` union instead. The settings
 * panel renders it as three exclusive options.
 */
export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro";
export type DisplayMode = "original" | "translation" | "both";

/** Models officially documented by DeepSeek (api-docs.deepseek.com). */
export const DEEPSEEK_MODELS: readonly DeepSeekModel[] = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
];

export const DISPLAY_MODES: readonly DisplayMode[] = [
  "original",
  "translation",
  "both",
];

/**
 * Selectable target languages (ISO 639-1 code + display name). The settings
 * panel renders these as a dropdown; `normalizeSettings` still accepts any
 * ISO code for backwards compatibility with stored values.
 */
export const TARGET_LANGUAGES: readonly { code: string; name: string }[] = [
  { code: "es", name: "Español" },
  { code: "en", name: "English" },
  { code: "pt", name: "Português" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "sv", name: "Svenska" },
  { code: "da", name: "Dansk" },
  { code: "no", name: "Norsk" },
  { code: "fi", name: "Suomi" },
  { code: "el", name: "Ελληνικά" },
  { code: "ru", name: "Русский" },
  { code: "uk", name: "Українська" },
  { code: "tr", name: "Türkçe" },
  { code: "ar", name: "العربية" },
  { code: "he", name: "עברית" },
  { code: "hi", name: "हिन्दी" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
  { code: "th", name: "ไทย" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "id", name: "Bahasa Indonesia" },
];

export interface Settings {
  /** DeepSeek API key (sk-...). Stored locally, sent only to api.deepseek.com. */
  apiKey: string;
  /**
   * Model id. Default `deepseek-v4-flash` (fast, cheap, current). This is the
   * only AI parameter exposed to the user — temperature, thinking mode and
   * reasoning effort are intentionally not configurable: sensible constants
   * live in `DeepSeekProvider` (temperature 1.3, thinking disabled), which is
   * what the official DeepSeek docs recommend for translation.
   */
  model: DeepSeekModel;
  /** Target language for translations (ISO 639-1 code, e.g. "es"). */
  targetLanguage: string;
  /** Translate automatically on song change (vs. only via the manual button). */
  autoTranslate: boolean;
  /** What to render under each lyric line. */
  displayMode: DisplayMode;
  /** Font family for translations. Empty string inherits Spotify's font. */
  fontFamily: string;
  /** Font size of the translation lines, in px. */
  fontSize: number;
  /** Text color of the translation lines (hex, e.g. "#a7a7a7"). */
  color: string;
  /** Vertical gap between an original line and its translation, in px. */
  lineSpacing: number;
  /** Opacity of the translation lines, 0.1–1. */
  opacity: number;
}

/** Numeric ranges — kept as constants so validation and docs never drift. */
export const FONT_SIZE_RANGE: readonly [number, number] = [8, 32];
export const LINE_SPACING_RANGE: readonly [number, number] = [0, 32];
export const OPACITY_RANGE: readonly [number, number] = [0.1, 1];

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  model: "deepseek-v4-flash",
  targetLanguage: "es",
  autoTranslate: true,
  displayMode: "both",
  fontFamily: "",
  fontSize: 13,
  color: "#a7a7a7",
  lineSpacing: 4,
  opacity: 0.85,
};

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clamp(value: number, range: readonly [number, number]): number {
  return Math.min(Math.max(value, range[0]), range[1]);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Sanitizes an arbitrary value into a complete, valid `Settings` object.
 * Unknown input (null, garbage, partial JSON from storage) is safe.
 */
export function normalizeSettings(raw: unknown): Settings {
  const source: Record<string, unknown> =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const settings: Settings = { ...DEFAULT_SETTINGS };

  if (typeof source.apiKey === "string") {
    settings.apiKey = source.apiKey.trim();
  }

  if (
    typeof source.model === "string" &&
    (DEEPSEEK_MODELS as readonly string[]).includes(source.model)
  ) {
    settings.model = source.model as DeepSeekModel;
  }

  if (typeof source.targetLanguage === "string") {
    const language = source.targetLanguage.trim().toLowerCase();
    if (language.length > 0) {
      settings.targetLanguage = language;
    }
  }

  if (typeof source.autoTranslate === "boolean") {
    settings.autoTranslate = source.autoTranslate;
  }

  if (
    typeof source.displayMode === "string" &&
    (DISPLAY_MODES as readonly string[]).includes(source.displayMode)
  ) {
    settings.displayMode = source.displayMode as DisplayMode;
  }

  if (typeof source.fontFamily === "string") {
    settings.fontFamily = source.fontFamily.trim();
  }

  if (isFiniteNumber(source.fontSize)) {
    settings.fontSize = clamp(Math.round(source.fontSize), FONT_SIZE_RANGE);
  }

  if (typeof source.color === "string" && HEX_COLOR_PATTERN.test(source.color.trim())) {
    settings.color = source.color.trim();
  }

  if (isFiniteNumber(source.lineSpacing)) {
    settings.lineSpacing = clamp(Math.round(source.lineSpacing), LINE_SPACING_RANGE);
  }

  if (isFiniteNumber(source.opacity)) {
    settings.opacity = clamp(source.opacity, OPACITY_RANGE);
  }

  return settings;
}
