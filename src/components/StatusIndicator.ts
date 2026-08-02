/**
 * StatusIndicator — discreet status label for the lyrics panel.
 *
 * What it does: shows a small "Translating…" label while a translation is in
 * flight, or a friendly error message on failure. In the ready and idle
 * states it hides itself completely — once translated, nothing stays on
 * screen (the user explicitly asked for a discreet indicator, not a toolbar).
 *
 * How it works: the indicator is a plain div whose text, color and visibility
 * are driven by `set(status, message)`. Errors show the friendly message from
 * the Translator; colors come from Spicetify CSS variables (`--spice-error`,
 * `--spice-subtext`), so the indicator follows light/dark themes.
 *
 * Why it exists: status presentation is a single, dumb component — the
 * Overlay owns placement, the Translator owns state, this owns appearance.
 *
 * How to modify: to add an inline spinner for the translating state, extend
 * `set` to toggle a class and style it via a `<style>` block — keep the
 * public surface (`element`, `set`) unchanged.
 */
import { createElement } from "../utils/Dom";
import type { TranslationStatus } from "../translation/Translator";

const LABELS: Record<"translating", string> = {
  translating: "Translating…",
};

export class StatusIndicator {
  private readonly el: HTMLElement;

  constructor() {
    this.el = createElement("div", { className: "ai-lyrics-translator__status" });
    this.el.style.display = "none";
    this.el.style.fontSize = "11px";
    this.el.style.padding = "2px 4px";
    this.el.style.color = "var(--spice-subtext)";
    this.el.style.maxWidth = "260px";
    this.el.style.textAlign = "right";
    this.el.style.background = "rgba(0, 0, 0, 0.55)";
    this.el.style.borderRadius = "8px";
    this.el.style.backdropFilter = "blur(4px)";
  }

  get element(): HTMLElement {
    return this.el;
  }

  set(status: TranslationStatus, message?: string): void {
    // Idle and ready both hide the indicator: nothing on screen once the
    // translation finished.
    if (status === "idle" || status === "ready") {
      this.el.style.display = "none";
      this.el.textContent = "";
      return;
    }

    this.el.style.display = "block";
    if (status === "error") {
      this.el.textContent = message ?? "Error";
      this.el.style.color = "var(--spice-error)";
    } else {
      this.el.textContent = LABELS[status];
      this.el.style.color = "var(--spice-subtext)";
    }
  }
}
