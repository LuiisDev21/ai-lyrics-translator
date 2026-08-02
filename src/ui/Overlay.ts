/**
 * Overlay — discreet status label for the lyrics panel.
 *
 * What it does: hosts ONLY the `StatusIndicator` (a small "Translating…" text
 * that hides itself once the translation finishes, or an error message on
 * failure), anchored STATICALLY to the bottom-right of the lyrics window.
 *
 * How it works: `mount(anchor)` appends a fixed-position container to
 * `document.body` and positions it once against the viewport bottom and the
 * lyrics container's right edge. It NEVER re-anchors on scroll or karaoke
 * movement (the container's height is content-driven — re-reading its rect
 * during the dance makes anything anchored to it bounce). It re-anchors only
 * on window resize.
 *
 * Why it exists: previous versions had Translate/Refresh buttons and then a
 * round toggle button — all of them fought Spotify's layout and moved around.
 * The user asked to remove the button entirely: a discreet text label is all
 * that remains. No handlers, no interaction: the overlay is display-only.
 *
 * How to modify: to change the anchor edge, edit `position()`. To add an
 * inline spinner for the translating state, style
 * `.ai-lyrics-translator__status` via a `<style>` block.
 */
import { createElement } from "../utils/Dom";
import { StatusIndicator } from "../components/StatusIndicator";
import type { TranslationStatus } from "../translation/Translator";

/** Fallback position used when mounting without an anchor. */
const FALLBACK_BOTTOM = "32px";
const FALLBACK_RIGHT = "32px";
/** Gap between the label and the lyrics panel edge, in px. */
const EDGE_GAP_PX = 12;

export class Overlay {
  private readonly root: HTMLElement;
  private readonly status = new StatusIndicator();
  private mounted = false;
  private anchor: Element | null = null;

  constructor() {
    this.root = createElement("div", { className: "ai-lyrics-translator__overlay" });
    this.root.style.position = "fixed";
    this.root.style.zIndex = "1000";
    this.root.style.display = "flex";
    this.root.style.flexDirection = "column";
    this.root.style.alignItems = "flex-end";
    this.root.style.gap = "4px";
    this.root.append(this.status.element);
  }

  /**
   * Shows the overlay, anchored to the bottom-right of `anchor` (the lyrics
   * container). Safe to call repeatedly; re-anchors on each fresh mount.
   */
  mount(anchor?: Element): void {
    if (this.mounted) {
      return;
    }
    this.anchor = anchor ?? null;
    document.body.appendChild(this.root);
    this.mounted = true;
    window.addEventListener("resize", this.onWindowResize);
    // NOTE: intentionally NO scroll/mutation listeners. The label is STATIC:
    // positioned once, never moved by lyrics scrolling or the karaoke dance.
    this.position();
  }

  /** Hides and removes the overlay. Safe to call repeatedly. */
  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.root.remove();
    this.mounted = false;
    this.anchor = null;
    window.removeEventListener("resize", this.onWindowResize);
  }

  /** True while the overlay is attached to the document. */
  isMounted(): boolean {
    return this.mounted;
  }

  /** Forwards translation state to the status label. */
  setStatus(status: TranslationStatus, message?: string): void {
    this.status.set(status, message);
  }

  private readonly onWindowResize = (): void => {
    this.position();
  };

  /**
   * Places the label at the BOTTOM-right of the lyrics window — STATIC. The
   * bottom is pinned to the viewport (the lyrics window's bottom edge is
   * stable; only the lyrics CONTENT moves inside it) and the right edge uses
   * the container's rect computed at mount/resize.
   */
  private position(): void {
    if (this.anchor) {
      const rect = this.anchor.getBoundingClientRect();
      this.root.style.bottom = `${Math.max(window.innerHeight - 16, 8)}px`;
      this.root.style.right = `${Math.max(window.innerWidth - rect.right + EDGE_GAP_PX, 8)}px`;
      this.root.style.top = "auto";
    } else {
      this.root.style.bottom = FALLBACK_BOTTOM;
      this.root.style.right = FALLBACK_RIGHT;
      this.root.style.top = "auto";
    }
  }
}
