/**
 * LyricsSelectors — the ONLY module that knows the Spotify lyrics DOM.
 *
 * What it does: centralizes every DOM selector the extension uses to find the
 * lyrics panel and its lines, plus the resolution helpers built on top of
 * them. No other module in the codebase may contain a lyrics selector.
 *
 * How it works: each role (container, line, active line) is a list of
 * candidate selectors tried in order. `resolveContainer` returns the first
 * container that actually contains lyric lines; `resolveLines` returns every
 * line element in document order (the combined selector keeps DOM order, which
 * is what guarantees index alignment between extracted text and DOM elements);
 * `resolveActiveLine` finds the line Spotify marks as active during karaoke.
 *
 * Why it exists: the spec requires that Spotify DOM changes are survivable.
 * When Spotify renames an element, the fix is exactly one line in this file —
 * add the new `data-testid` at the top of the relevant list. The selectors
 * rely on `data-testid` attributes (stable, semantic) instead of CSS classes
 * (generated, unstable).
 *
 * How to modify:
 * - New Spotify DOM layout: prepend the new testid to the candidate lists.
 *   The resolution helpers pick the first candidate that matches, so old and
 *   new layouts can coexist during transitions.
 * - The legacy inline lyrics view (`lyrics-line`) is kept as a fallback for
 *   extraction only; it has no active-line concept, so karaoke sync silently
 *   degrades to "no active line" for that layout.
 *
 * ⚠️ Breakage risk: these selectors are the parts most likely to break on a
 * Spotify update. They are isolated here by design — nothing else in the
 * project references the DOM structure of the lyrics panel.
 */

/**
 * Container of the lyrics view. Two layouts are supported:
 * - 2026 "Now Playing" lyrics view: `.lyrics-lyrics-container` (verified live
 *   on Spotify 1.2.x, 2026-08 — lines use class-based state, no data-testid).
 * - Pre-2026 fullscreen lyrics view: `[data-testid="fullscreen-lyrics"]`
 *   (verified in production extensions). Kept as fallback for older clients.
 */
export const LYRICS_CONTAINER_SELECTORS: readonly string[] = [
  ".lyrics-lyrics-container",
  '[data-testid="fullscreen-lyrics"]',
];

/**
 * Every lyric line, including the active one. The 2026 view marks line state
 * with classes (`lyrics-lyricsContent-previous/active/upcoming`); the legacy
 * view flips the `data-testid` of the active line, so the combined selector
 * must mention both. Order in the result follows document order (guaranteed
 * by querySelectorAll).
 */
export const LYRICS_LINE_SELECTORS: readonly string[] = [
  ".lyrics-lyricsContent-lyric",
  '[data-testid="fullscreen-lyrics-line"]',
  '[data-testid="fullscreen-lyrics-line-active"]',
];

/**
 * The line Spotify highlights during karaoke. 2026 view: the
 * `lyrics-lyricsContent-active` class; legacy view: the
 * `fullscreen-lyrics-line-active` testid.
 */
export const LYRICS_ACTIVE_LINE_SELECTORS: readonly string[] = [
  ".lyrics-lyricsContent-active",
  '[data-testid="fullscreen-lyrics-line-active"]',
];

/** Legacy inline lyrics view (pre-fullscreen UI). Extraction-only fallback. */
export const LEGACY_LYRICS_LINE_SELECTORS: readonly string[] = [
  '[data-testid="lyrics-line"]',
];

function combine(selectors: readonly string[]): string {
  return selectors.join(", ");
}

/**
 * Finds the lyrics panel under `root`. Returns the first container candidate
 * that actually contains lyric lines (or, failing that, legacy lines), or
 * null when the lyrics panel is not present.
 */
export function resolveContainer(root: ParentNode): Element | null {
  for (const selector of LYRICS_CONTAINER_SELECTORS) {
    const container = root.querySelector(selector);
    if (container && hasLyricsInDom(container)) {
      return container;
    }
  }
  return null;
}

/** Returns all lyric line elements under `root` in document order. */
export function resolveLines(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(combine(LYRICS_LINE_SELECTORS)));
}

/** Returns the currently active karaoke line under `root`, or null. */
export function resolveActiveLine(root: ParentNode): Element | null {
  return root.querySelector(combine(LYRICS_ACTIVE_LINE_SELECTORS));
}

/** True when `root` contains lyric lines (modern or legacy layout). */
export function hasLyricsInDom(root: ParentNode): boolean {
  return (
    root.querySelector(combine(LYRICS_LINE_SELECTORS)) !== null ||
    root.querySelector(combine(LEGACY_LYRICS_LINE_SELECTORS)) !== null
  );
}

/** True when `element` is the currently active karaoke line. */
export function isActiveLine(element: Element): boolean {
  return element.matches(combine(LYRICS_ACTIVE_LINE_SELECTORS));
}
