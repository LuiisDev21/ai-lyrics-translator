/**
 * LyricsObserver — MutationObserver-based detection of the lyrics panel
 * lifecycle.
 *
 * What it does: watches the DOM and reports four kinds of events through
 * callbacks: panel opened, panel closed, lyric content changed, and active
 * karaoke line changed. No polling, no setInterval — purely mutation-driven.
 *
 * How it works: two MutationObservers with complementary scopes:
 *
 * 1. Body watcher: an observer on `document.body` (childList + subtree) that
 *    stays armed for the whole lifetime of the observer. While the panel is
 *    closed it detects when the container appears; while it is open it detects
 *    when the container is removed — a removal happens on an ANCESTOR (body),
 *    which the container-scoped observer can never see, so the body watcher is
 *    the authoritative open/close detector. Its per-mutation cost is a single
 *    `querySelector`.
 *
 * 2. Container observer: while the panel is open, an observer scoped to the
 *    container detects (a) attribute mutations on `data-testid` and `class` —
 *    the karaoke active line is marked either by a testid flip (legacy view)
 *    or by a state class change (2026 view); (b) childList/characterData
 *    mutations — lines being added, removed or re-rendered. Content mutations
 *    are debounced (default 120 ms) and gated by a text signature, so
 *    re-renders that change nothing emit nothing.
 *
 * Why it exists: the Translator and Renderer need to react to a panel that
 * Spotify opens, closes and re-renders asynchronously. Encapsulating the
 * observer lifecycle (arm/disarm, debounce, dedupe) in one class keeps the
 * consumers free of DOM bookkeeping.
 *
 * How to modify:
 * - Debounce tuning: pass `debounceMs` in the constructor. Longer = fewer
 *   emissions during heavy re-renders, at the cost of latency.
 * - The signature gate compares the joined line texts; if Spotify ever
 *   changes non-text content that matters (e.g. line timestamps), extend
 *   `signatureOf` accordingly.
 *
 * ⚠️ Breakage risk: if Spotify stops unmounting/remounting the container and
 * instead hides it (display:none), the open/close detection must switch from
 * "is it in the DOM" to "is it visible". That change is isolated to this file.
 */
import {
  resolveActiveLine,
  resolveContainer,
  resolveLines,
} from "./LyricsSelectors";

export interface LyricsObserverCallbacks {
  /** The lyrics panel appeared. `container` is the resolved panel element. */
  onOpen: (container: Element) => void;
  /** The lyrics panel disappeared (closed or navigated away). */
  onClose: () => void;
  /**
   * The lyric lines changed (added, removed or re-rendered with different
   * text). `container` is the panel element. Not emitted for active-line
   * attribute flips.
   */
  onContentChanged: (container: Element) => void;
  /**
   * Raw DOM mutation inside the container (childList/characterData), fired
   * immediately WITHOUT the signature gate — React re-renders that keep the
   * same text still destroy and recreate line elements, and consumers that
   * attach foreign nodes (the Renderer) must re-sync on every such mutation.
   */
  onDomMutated?: (container: Element) => void;
  /** The karaoke active line changed. `activeLine` is null when none. */
  onActiveLineChanged: (activeLine: Element | null) => void;
}

export class LyricsObserver {
  private containerObserver: MutationObserver | null = null;
  private bodyWatcher: MutationObserver | null = null;
  private container: Element | null = null;
  private lastActiveLine: Element | null = null;
  private lastSignature = "";
  private debounceTimer: number | null = null;

  constructor(
    private readonly callbacks: LyricsObserverCallbacks,
    private readonly debounceMs = 120,
  ) {}

  /** Starts observing. Safe to call once; call `stop()` to release. */
  start(): void {
    this.armBodyWatcher();
    this.scan();
  }

  /** Stops all observers and clears pending debounce. */
  stop(): void {
    this.disconnectBodyWatcher();
    this.disconnectContainerObserver();
    this.clearDebounce();
    this.container = null;
    this.lastActiveLine = null;
    this.lastSignature = "";
  }

  /**
   * Re-evaluates whether the lyrics panel is present and transitions state
   * accordingly (open → close, close → open). Cheap enough to run on every
   * body mutation while the panel is closed.
   */
  private scan(): void {
    const next = resolveContainer(document);

    if (next === this.container) {
      return;
    }

    // Panel closed.
    if (next === null && this.container !== null) {
      this.disconnectContainerObserver();
      this.clearDebounce();
      this.container = null;
      this.lastActiveLine = null;
      this.lastSignature = "";
      this.callbacks.onClose();
      this.armBodyWatcher();
      return;
    }

    // Panel opened.
    if (next !== null) {
      this.container = next;
      this.lastSignature = this.signatureOf(next);
      this.armContainerObserver(next);
      this.callbacks.onOpen(next);
    }
  }

  private armBodyWatcher(): void {
    if (this.bodyWatcher) {
      return;
    }
    this.bodyWatcher = new MutationObserver(() => this.scan());
    this.bodyWatcher.observe(document.body, { childList: true, subtree: true });
  }

  private disconnectBodyWatcher(): void {
    this.bodyWatcher?.disconnect();
    this.bodyWatcher = null;
  }

  private armContainerObserver(container: Element): void {
    this.containerObserver = new MutationObserver((mutations) => {
      // Container was removed from the document → panel closed.
      if (!container.isConnected) {
        this.scan();
        return;
      }

      let contentChanged = false;
      let activeChanged = false;

      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          activeChanged = true;
        } else if (mutation.type === "childList" || mutation.type === "characterData") {
          contentChanged = true;
        }
      }

      if (contentChanged) {
        // Raw hook first: consumers re-sync foreign nodes on ANY DOM change,
        // even when the text signature is unchanged (React row recycling).
        this.callbacks.onDomMutated?.(container);
        this.scheduleContentCheck(container);
      }
      if (activeChanged) {
        this.checkActiveLine(container);
      }
    });

    this.containerObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      // data-testid: legacy active-line marker; class: 2026 active-line state.
      attributeFilter: ["data-testid", "class"],
    });
  }

  private disconnectContainerObserver(): void {
    this.containerObserver?.disconnect();
    this.containerObserver = null;
  }

  private scheduleContentCheck(container: Element): void {
    this.clearDebounce();
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      const signature = this.signatureOf(container);
      if (signature === this.lastSignature) {
        return;
      }
      this.lastSignature = signature;
      this.callbacks.onContentChanged(container);
    }, this.debounceMs);
  }

  private checkActiveLine(container: Element): void {
    const activeLine = resolveActiveLine(container);
    if (activeLine === this.lastActiveLine) {
      return;
    }
    this.lastActiveLine = activeLine;
    this.callbacks.onActiveLineChanged(activeLine);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Text signature of the current lines; used to dedupe content emissions. */
  private signatureOf(container: Element): string {
    return resolveLines(container)
      .map((el) => el.textContent ?? "")
      .join("\u0000");
  }
}
