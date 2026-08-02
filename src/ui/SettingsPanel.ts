/**
 * SettingsPanel — the extension's settings modal (styled, Spotify-like).
 *
 * What it does: opens a Spicetify `PopupModal` with a user-friendly settings
 * form: provider selector (DeepSeek, OpenRouter, Gemini, Groq, custom
 * endpoint, DeepL), per-provider API key, model suggestions, target language
 * dropdown, auto-translate, display mode (segmented) and typography, plus
 * "Reset" and "Clear cache".
 *
 * How it works: the form is a plain DOM tree passed straight to
 * `Spicetify.PopupModal.display` — the official API accepts a raw `Element`
 * as content (verified in `globals.d.ts`), so no React is needed. A scoped
 * `<style>` block (injected once) gives it a Spotify-like look. Every control
 * writes directly to the `ConfigStore` on `change`/`input` (auto-save); the
 * store validates and persists.
 *
 * Provider-aware UI: switching the provider reloads the API-key field (each
 * provider keeps its own key in `settings.providerKeys`), swaps the model
 * suggestions (datalist — any model id is allowed), shows the base-URL field
 * for the "custom" endpoint, and hides the model row for direct providers
 * (DeepL).
 *
 * Why it exists: the only module that edits settings; it talks only to
 * `ConfigStore` + the caches (for "Clear cache") — no pipeline logic.
 *
 * How to modify: add a setting to `Settings`/`normalizeSettings` first, then
 * a row here. All styles live in the injected `<style>` (class prefix
 * `ailt-`); inputs inherit Spotify's theme via `var(--spice-*)`.
 */
import { createElement } from "../utils/Dom";
import type { ConfigStore } from "../settings/ConfigStore";
import {
  DISPLAY_MODES,
  TARGET_LANGUAGES,
  type DisplayMode,
  type Settings,
} from "../settings/Settings";
import { PROVIDERS, getProvider } from "../providers/registry";
import type { TranslationProvider } from "../providers/types";
import type { MemoryCache } from "../cache/MemoryCache";
import type { PersistentCache } from "../cache/PersistentCache";

export interface SettingsPanelDeps {
  store: ConfigStore;
  memoryCache: MemoryCache;
  persistentCache: PersistentCache;
}

type Control = HTMLInputElement | HTMLSelectElement;

export function openSettingsPanel(deps: SettingsPanelDeps): void {
  Spicetify.PopupModal.display({
    title: "AI Lyrics Translator",
    content: buildSettingsForm(deps),
    isLarge: true,
  });
}

const PANEL_STYLES = `
.ailt-settings { display: flex; flex-direction: column; gap: 12px; min-width: 460px; max-width: 520px; font-size: 13px; color: var(--spice-text); }
.ailt-section { background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.ailt-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--spice-subtext); margin: 0 0 2px; display: flex; align-items: center; gap: 6px; }
.ailt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ailt-label { color: var(--spice-subtext); font-size: 12px; white-space: nowrap; }
.ailt-input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; color: var(--spice-text); padding: 6px 10px; font-size: 12px; min-width: 0; flex: 1; max-width: 220px; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.ailt-input:focus { outline: none; border-color: var(--spice-button); box-shadow: 0 0 0 2px color-mix(in srgb, var(--spice-button) 30%, transparent); }
.ailt-input:disabled { opacity: 0.45; cursor: not-allowed; }
.ailt-input[type="color"] { padding: 2px 4px; height: 30px; width: 60px; cursor: pointer; }
.ailt-input[type="range"] { accent-color: var(--spice-button); }
.ailt-check { accent-color: var(--spice-button); width: 16px; height: 16px; cursor: pointer; }
.ailt-segmented { display: flex; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 3px; gap: 3px; }
.ailt-seg-btn { border: none; background: transparent; color: var(--spice-subtext); font-size: 12px; padding: 5px 12px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease, color 0.15s ease; }
.ailt-seg-btn:hover { color: var(--spice-text); }
.ailt-seg-btn.is-active { background: var(--spice-button); color: var(--spice-text); }
.ailt-btn { border: none; border-radius: 16px; padding: 6px 16px; font-size: 12px; cursor: pointer; background: rgba(255,255,255,0.1); color: var(--spice-text); transition: background 0.15s ease; }
.ailt-btn:hover { background: rgba(255,255,255,0.18); }
.ailt-btn.is-primary { background: var(--spice-button); color: var(--spice-text); font-weight: 600; }
.ailt-btn.is-primary:hover { background: var(--spice-button); filter: brightness(1.12); }
.ailt-btn.is-danger { color: var(--spice-notification-error, #f15e6c); }
.ailt-btn.is-danger:hover { background: rgba(241,94,108,0.12); }
.ailt-hint { font-size: 11px; color: var(--spice-subtext); opacity: 0.8; margin-top: -4px; }
`;

let stylesInjected = false;

function ensureStyles(): void {
  if (stylesInjected) {
    return;
  }
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = PANEL_STYLES;
  document.head.appendChild(style);
}

function buildSettingsForm(deps: SettingsPanelDeps): HTMLElement {
  ensureStyles();

  const form = createElement("div", { className: "ailt-settings" });
  const controls: Record<string, Control> = {};
  const settings = deps.store.get();

  const update = (patch: Partial<Settings>): void => {
    deps.store.update(patch);
  };

  // --- Provider ------------------------------------------------------------
  const provider = selectInput(PROVIDERS.map((p) => p.id), settings.provider);
  controls.provider = provider;
  let activeProvider = getProvider(provider.value);

  // --- API key (per provider) ------------------------------------------------
  const apiKey = textInput(settings.providerKeys[activeProvider.id] ?? "", {
    placeholder: activeProvider.keyPlaceholder,
    type: "password",
  });
  apiKey.disabled = !activeProvider.needsKey;
  apiKey.addEventListener("change", () => {
    const id = provider.value;
    const current = deps.store.get().providerKeys;
    update({ providerKeys: { ...current, [id]: apiKey.value.trim() } });
  });
  controls.apiKey = apiKey;

  const showKey = checkbox(false, "Show");
  showKey.addEventListener("change", () => {
    apiKey.type = showKey.checked ? "text" : "password";
  });

  // --- Model (suggestions per provider, free text allowed) --------------------
  const model = textInput(settings.model, { placeholder: "Modelo (ej. deepseek-v4-flash)" });
  model.addEventListener("change", () => update({ model: model.value.trim() }));
  controls.model = model;
  const modelDatalist = document.createElement("datalist");
  modelDatalist.id = "ailt-model-list";
  model.setAttribute("list", modelDatalist.id);

  // --- Custom base URL (only for the "custom" provider) ----------------------
  const baseUrl = textInput(settings.customBaseUrl, {
    placeholder: "http://localhost:11434/v1",
  });
  baseUrl.addEventListener("change", () => update({ customBaseUrl: baseUrl.value.trim() }));
  controls.baseUrl = baseUrl;
  const baseUrlRow = fieldRow("Base URL (custom)", baseUrl);

  // --- Provider switch side effects ------------------------------------------
  const refreshForProvider = (): void => {
    const p = getProvider(provider.value);
    activeProvider = p;
    const keys = deps.store.get().providerKeys;
    apiKey.value = keys[p.id] ?? "";
    apiKey.placeholder = p.keyPlaceholder;
    apiKey.disabled = !p.needsKey;
    model.disabled = p.kind !== "llm";
    if (!p.models.includes(model.value)) {
      model.value = p.defaultModel;
    }
    refreshModelList(modelDatalist, p);
    baseUrlRow.style.display = p.id === "custom" ? "flex" : "none";
    modelRow.style.display = p.kind === "llm" ? "flex" : "none";
  };
  provider.addEventListener("change", refreshForProvider);
  refreshModelList(modelDatalist, activeProvider);

  const modelRow = fieldRow("Modelo", row(model, modelDatalist));
  modelRow.style.display = activeProvider.kind === "llm" ? "flex" : "none";
  baseUrlRow.style.display = activeProvider.id === "custom" ? "flex" : "none";

  // --- Target language (dropdown, no manual ISO codes) ----------------------
  const language = languageSelect(settings.targetLanguage);
  language.addEventListener("change", () => update({ targetLanguage: language.value }));
  controls.language = language;

  // --- Auto translate -------------------------------------------------------
  const autoTranslate = checkbox(settings.autoTranslate, "");
  autoTranslate.addEventListener("change", () =>
    update({ autoTranslate: autoTranslate.checked }),
  );
  controls.autoTranslate = autoTranslate;

  // --- Display mode (segmented control) --------------------------------------
  const segmented = segmentedControl(settings.displayMode, (mode) => {
    update({ displayMode: mode });
    syncSegmented(segmented, mode);
  });
  // The hidden select mirrors the control; it MUST start on the actual
  // display mode — a select defaults to its FIRST option ("original"), so an
  // uninitialized mirror silently saved "original" on every Save click.
  controls.displayMode = segmentedButtons(segmented, settings.displayMode);
  syncSegmented(segmented, settings.displayMode);

  // --- Typography -----------------------------------------------------------
  const fontFamily = textInput(settings.fontFamily, { placeholder: "Heredar" });
  fontFamily.addEventListener("change", () => update({ fontFamily: fontFamily.value }));
  controls.fontFamily = fontFamily;

  const fontSize = numberInput(settings.fontSize, 8, 32, 1);
  fontSize.addEventListener("input", () => update({ fontSize: Number(fontSize.value) }));
  controls.fontSize = fontSize;

  const color = colorInput(settings.color);
  color.addEventListener("input", () => update({ color: color.value }));
  controls.color = color;

  const lineSpacing = numberInput(settings.lineSpacing, 0, 32, 1);
  lineSpacing.addEventListener("input", () =>
    update({ lineSpacing: Number(lineSpacing.value) }),
  );
  controls.lineSpacing = lineSpacing;

  const opacity = rangeInput(settings.opacity);
  opacity.addEventListener("input", () => update({ opacity: Number(opacity.value) }));
  controls.opacity = opacity;

  // --- Actions --------------------------------------------------------------
  const saveButton = button("Guardar", () => {
    // Explicit save: read every control's current value straight from the
    // DOM and persist it. The store auto-saves on each change anyway — this
    // is the "just in case" confirmation (e.g. text typed but not blurred).
    const current = deps.store.get();
    deps.store.update(collectFormValues(controls, current));
    Spicetify.showNotification("Ajustes guardados.");
  }, false, true);

  const resetButton = button("Restablecer", () => {
    deps.store.reset();
    syncControls(controls, deps.store.get());
    refreshForProvider();
    Spicetify.showNotification("Ajustes restablecidos.");
  });

  const clearCacheButton = button("Borrar caché", () => {
    deps.memoryCache.clear();
    deps.persistentCache.clearAll();
    Spicetify.showNotification("Caché de traducciones borrada.");
  }, true);

  // --- Assemble -------------------------------------------------------------
  form.append(
    section(
      "Proveedor y traducción",
      fieldRow("Proveedor", provider),
      fieldRow("API Key", row(apiKey, showKey)),
      modelRow,
      baseUrlRow,
      fieldRow("Idioma destino", language),
      fieldRow("Auto-traducir", autoTranslate),
    ),
    section("Mostrar", segmented),
    section(
      "Apariencia",
      fieldRow("Fuente", fontFamily),
      fieldRow("Tamaño (px)", fontSize),
      fieldRow("Color", color),
      fieldRow("Separación (px)", lineSpacing),
      fieldRow("Opacidad", opacity),
    ),
    hint(
      "Tu clave se guarda solo en este equipo y se envía únicamente al proveedor elegido. Los parámetros de la IA (temperatura, modo pensante) usan los valores recomendados.",
    ),
    row(saveButton, resetButton, clearCacheButton),
  );

  return form;
}

/**
 * Reads every control's current value straight from the DOM and returns it as
 * a settings patch. Used by the explicit Save button so nothing typed but not
 * yet blurred is lost.
 */
function collectFormValues(
  controls: Record<string, Control>,
  current: Settings,
): Partial<Settings> {
  return {
    provider: controls.provider.value,
    providerKeys: {
      ...current.providerKeys,
      [controls.provider.value]: controls.apiKey.value.trim(),
    },
    customBaseUrl: controls.baseUrl.value.trim(),
    model: controls.model.value.trim(),
    targetLanguage: controls.language.value,
    autoTranslate: (controls.autoTranslate as HTMLInputElement).checked,
    displayMode: controls.displayMode.value as DisplayMode,
    fontFamily: controls.fontFamily.value,
    fontSize: Number(controls.fontSize.value),
    color: controls.color.value,
    lineSpacing: Number(controls.lineSpacing.value),
    opacity: Number(controls.opacity.value),
  };
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const el = createElement("div", { className: "ailt-section" });
  const titleEl = createElement("div", { className: "ailt-section-title", text: title });
  el.append(titleEl, ...children);
  return el;
}

function hint(text: string): HTMLElement {
  return createElement("div", { className: "ailt-hint", text });
}

function fieldRow(label: string, control: HTMLElement): HTMLElement {
  const row = createElement("div", { className: "ailt-row" });
  const labelEl = createElement("label", { className: "ailt-label", text: label });
  row.append(labelEl, control);
  return row;
}

function row(...elements: HTMLElement[]): HTMLElement {
  const container = createElement("div", { className: "ailt-row" });
  container.style.justifyContent = "flex-start";
  container.append(...elements);
  return container;
}

function button(
  text: string,
  onClick: () => void,
  danger = false,
  primary = false,
): HTMLButtonElement {
  const className = [
    "ailt-btn",
    danger ? "is-danger" : "",
    primary ? "is-primary" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const el = createElement("button", { className, text });
  el.addEventListener("click", onClick);
  return el;
}

/**
 * Segmented control for the display mode. Returns the container; the active
 * segment is tracked via `.is-active`. A hidden select keeps `syncControls`
 * working after a reset.
 *
 * The active state is matched by the `data-mode` attribute, NEVER by the
 * visible label text: the label is user-facing Spanish ("Solo original")
 * while the mode value is the machine id ("original") — comparing text to
 * value would never match and the control would show no selection at all
 * (the exact bug that hid the display mode from the user).
 */
function segmentedControl(
  value: DisplayMode,
  onChange: (mode: DisplayMode) => void,
): HTMLElement {
  const container = createElement("div", { className: "ailt-segmented" });
  const labels: Record<DisplayMode, string> = {
    original: "Solo original",
    translation: "Solo traducción",
    both: "Ambas",
  };
  for (const mode of DISPLAY_MODES) {
    const btn = createElement("button", {
      className: `ailt-seg-btn${mode === value ? " is-active" : ""}`,
      text: labels[mode],
      attrs: { type: "button", "data-mode": mode },
    });
    btn.addEventListener("click", () => onChange(mode));
    container.append(btn);
  }
  return container;
}

/**
 * The hidden select mirroring the segmented control (used by Save/reset).
 * Its initial value must be the CURRENT display mode — a fresh select
 * defaults to its first option ("original"), which used to silently reset
 * the display mode to "original" whenever the user clicked Save.
 */
function segmentedButtons(container: HTMLElement, value: DisplayMode): HTMLSelectElement {
  const select = createElement("select", { className: "ailt-seg-hidden" });
  select.style.display = "none";
  for (const mode of DISPLAY_MODES) {
    const option = createElement("option", { text: mode });
    option.value = mode;
    select.append(option);
  }
  select.value = value;
  container.append(select);
  return select;
}

function syncSegmented(container: HTMLElement, mode: DisplayMode): void {
  for (const btn of Array.from(container.querySelectorAll<HTMLButtonElement>(".ailt-seg-btn"))) {
    btn.classList.toggle("is-active", btn.dataset.mode === mode);
  }
  const select = container.querySelector<HTMLSelectElement>(".ailt-seg-hidden");
  if (select) {
    select.value = mode;
  }
}

/** Fills the model datalist with the provider's suggested models. */
function refreshModelList(datalist: HTMLDataListElement, provider: TranslationProvider): void {
  datalist.replaceChildren();
  for (const model of provider.models) {
    const option = document.createElement("option");
    option.value = model;
    datalist.append(option);
  }
}

/** Re-applies store values to every control (used after reset). */
function syncControls(controls: Record<string, Control>, settings: Settings): void {
  controls.provider.value = settings.provider;
  controls.apiKey.value = settings.providerKeys[settings.provider] ?? "";
  controls.model.value = settings.model;
  controls.baseUrl.value = settings.customBaseUrl;
  controls.language.value = settings.targetLanguage;
  setCheckbox(controls.autoTranslate, settings.autoTranslate);
  controls.displayMode.value = settings.displayMode;
  syncSegmented(controls.displayMode.closest(".ailt-segmented") as HTMLElement, settings.displayMode);
  controls.fontFamily.value = settings.fontFamily;
  controls.fontSize.value = String(settings.fontSize);
  controls.color.value = toHex6(settings.color);
  controls.lineSpacing.value = String(settings.lineSpacing);
  controls.opacity.value = String(settings.opacity);
}

/** Checkboxes expose state through `.checked`, not `.value`. */
function setCheckbox(control: Control, checked: boolean): void {
  if (control instanceof HTMLInputElement) {
    control.checked = checked;
  }
}

function textInput(
  value: string,
  opts: { placeholder?: string; type?: string; maxLength?: number } = {},
): HTMLInputElement {
  const input = createElement("input", {
    className: "ailt-input",
    attrs: { type: opts.type ?? "text" },
  });
  input.value = value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.maxLength !== undefined) input.maxLength = opts.maxLength;
  return input;
}

function numberInput(value: number, min: number, max: number, step: number): HTMLInputElement {
  const input = createElement("input", { className: "ailt-input", attrs: { type: "number" } });
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

function checkbox(checked: boolean, labelText: string): HTMLInputElement {
  const input = createElement("input", { className: "ailt-check", attrs: { type: "checkbox" } });
  input.checked = checked;
  if (labelText.length > 0) {
    input.setAttribute("aria-label", labelText);
  }
  return input;
}

function selectInput(options: readonly string[], value: string): HTMLSelectElement {
  const select = createElement("select", { className: "ailt-input" });
  for (const option of options) {
    const optionEl = createElement("option", { text: option });
    optionEl.value = option;
    select.append(optionEl);
  }
  select.value = value;
  return select;
}

/**
 * Language dropdown. If the stored value is not in the curated list (e.g. a
 * legacy manual ISO code), it is appended so it is never silently lost.
 */
function languageSelect(value: string): HTMLSelectElement {
  const select = createElement("select", { className: "ailt-input" });
  let found = false;
  for (const { code, name } of TARGET_LANGUAGES) {
    const optionEl = createElement("option", { text: `${name} (${code})` });
    optionEl.value = code;
    select.append(optionEl);
    if (code === value) {
      found = true;
    }
  }
  if (!found && value.length > 0) {
    const optionEl = createElement("option", { text: `${value} (custom)` });
    optionEl.value = value;
    select.append(optionEl);
  }
  select.value = value;
  return select;
}

function colorInput(value: string): HTMLInputElement {
  const input = createElement("input", { className: "ailt-input", attrs: { type: "color" } });
  input.value = toHex6(value);
  return input;
}

function rangeInput(value: number): HTMLInputElement {
  const input = createElement("input", { className: "ailt-input", attrs: { type: "range" } });
  input.min = "0.1";
  input.max = "1";
  input.step = "0.05";
  input.value = String(value);
  return input;
}

/** Normalizes a hex color to #rrggbb (the `<input type="color">` requires 6 digits). */
function toHex6(color: string): string {
  const match = /^#([0-9a-fA-F]{3})$/.exec(color);
  if (!match) {
    return color;
  }
  const [r, g, b] = match[1].split("");
  return `#${r}${r}${g}${g}${b}${b}`;
}
