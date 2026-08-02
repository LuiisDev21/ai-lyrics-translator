/**
 * LyricsExtractor — pure extraction of lyric text from the lyrics DOM.
 *
 * What it does: converts a lyrics panel container into plain, trimmed text
 * lines plus the index of the currently active karaoke line (if any).
 *
 * How it works: it asks `LyricsSelectors` for the line elements, reads
 * `textContent` of each (flattening any inner spans Spotify may use), trims
 * each line and drops fully-empty ones. The active line is resolved through
 * the selectors module and mapped to its index in the same element array, so
 * index alignment between extracted text and DOM elements is guaranteed by
 * construction.
 *
 * Why it exists: keeping extraction pure (no observers, no mutation handling,
 * no rendering) makes it trivially testable and lets the Translator call it
 * deterministically whenever it needs a fresh snapshot — on panel open, on
 * content change, or on manual refresh.
 *
 * How to modify:
 * - To preserve blank-line structure (verse gaps), remove the empty-line
 *   filter and instead map lines to their original indexes; note that the
 *   translation alignment in `Renderer` relies on extraction and DOM querying
 *   staying consistent with each other.
 * - To add metadata per line (e.g. timestamps if Spotify ever exposes them),
 *   extend `LyricsExtraction` — the rest of the pipeline treats lines as an
 *   opaque string array.
 */
import {
  resolveActiveLine,
  resolveLines,
} from "./LyricsSelectors";

export interface LyricsExtraction {
  /** The lyric lines, trimmed; fully-empty lines removed. */
  lines: string[];
  /** Index of the active karaoke line within `lines`, or null when unsynced. */
  activeIndex: number | null;
}

export function extractLyrics(container: Element): LyricsExtraction {
  const lineElements = resolveLines(container);

  const lines = lineElements
    .map((el) => (el.textContent ?? "").trim())
    .filter((line) => line.length > 0);

  const activeElement = resolveActiveLine(container);
  const activeIndex = activeElement !== null ? lineElements.indexOf(activeElement) : null;

  return {
    lines,
    // The active element is always part of the resolved line set, so
    // indexOf is reliable; a negative result would mean the active line
    // was filtered out, in which case we report no active line.
    activeIndex: activeIndex !== null && activeIndex >= 0 ? activeIndex : null,
  };
}
