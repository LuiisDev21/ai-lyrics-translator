/**
 * ConfigStore — persistent settings store with auto-save and change
 * notification.
 *
 * What it does: loads the extension settings from localStorage, exposes them
 * through `get()`, applies validated updates through `update()`/`reset()`, and
 * notifies subscribed listeners whenever the effective settings change.
 *
 * How it works: on construction the store reads the JSON blob under
 * `STORAGE_KEY`, runs it through `normalizeSettings` (so even a corrupted blob
 * yields valid settings) and caches the result in memory. `update()` merges a
 * partial patch, normalizes, persists synchronously — this is the "save
 * automatically" behavior required by the spec — and then fires every
 * listener. `onChange()` returns an unsubscribe function, so UI modules can
 * subscribe without leaking listeners.
 *
 * Why it exists: every other module needs the current settings, and several
 * (Renderer, Translator, SettingsPanel) need to react to changes. Routing all
 * reads and writes through one store keeps the settings pipeline single-writer
 * and guarantees that persisted state and runtime state can never diverge.
 *
 * How to modify:
 * - The storage backend is injected via the constructor (defaults to
 *   `window.localStorage`), which makes the store unit-testable with an
 *   in-memory `Storage` stub.
 * - To add a setting, extend `Settings`/`normalizeSettings` first; the store
 *   needs no changes.
 *
 * Storage robustness: every read/write is wrapped in try/catch. A private
 * browsing session or a full quota must never break the extension — the store
 * simply falls back to in-memory defaults.
 */
import { normalizeSettings, type Settings } from "./Settings";
import { logger } from "../utils/Logger";

/** Namespaced storage key — the extension prefix avoids collisions with other extensions. */
export const SETTINGS_STORAGE_KEY = "ai-lyrics-translator:settings";

export type SettingsListener = (settings: Settings) => void;

export class ConfigStore {
  private settings: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly storage: Storage = window.localStorage) {
    this.settings = this.load();
  }

  /** Returns the current validated settings. Treat the object as immutable. */
  get(): Settings {
    return this.settings;
  }

  /**
   * Merges `patch` into the current settings, validates, persists and notifies
   * listeners. Safe to call with partial objects.
   */
  update(patch: Partial<Settings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...patch });
    this.persist();
    this.notify();
  }

  /** Restores every setting to its documented default and persists. */
  reset(): void {
    this.settings = normalizeSettings(null);
    this.persist();
    this.notify();
  }

  /**
   * Subscribes to setting changes. Returns an unsubscribe function; always
   * call it when the subscribing module is torn down.
   */
  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private load(): Settings {
    try {
      const raw = this.storage.getItem(SETTINGS_STORAGE_KEY);
      if (raw === null) {
        return normalizeSettings(null);
      }
      return normalizeSettings(JSON.parse(raw));
    } catch (error) {
      logger.warn("Failed to load settings from storage; using defaults.", error);
      return normalizeSettings(null);
    }
  }

  private persist(): void {
    try {
      this.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      logger.warn("Failed to persist settings to storage.", error);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.settings);
      } catch (error) {
        logger.error("Settings listener threw.", error);
      }
    }
  }
}

/** Shared store instance used across the extension. */
export const configStore = new ConfigStore();
