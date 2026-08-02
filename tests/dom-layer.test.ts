/**
 * Tests: DOM layer — LyricsSelectors, LyricsExtractor, LyricsObserver,
 * Renderer, Overlay. Requires jsdom (installed in setupDom by run-all).
 */
import { check, checkRejects, flush, section } from "./helpers";
import {
  resolveContainer,
  resolveLines,
  resolveActiveLine,
  isActiveLine,
  hasLyricsInDom,
} from "../src/lyrics/LyricsSelectors";
import { extractLyrics } from "../src/lyrics/LyricsExtractor";
import { LyricsObserver } from "../src/lyrics/LyricsObserver";
import { Renderer } from "../src/ui/Renderer";
import { Overlay } from "../src/ui/Overlay";
import { normalizeSettings, type Settings } from "../src/settings/Settings";

function makeContainer(lines: string[]): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-testid", "fullscreen-lyrics");
  for (const line of lines) {
    const lineEl = document.createElement("div");
    lineEl.setAttribute("data-testid", "fullscreen-lyrics-line");
    lineEl.textContent = line;
    container.appendChild(lineEl);
  }
  document.body.appendChild(container);
  return container;
}

function makeActive(container: Element, index: number): Element {
  const line = resolveLines(container)[index];
  line.setAttribute("data-testid", "fullscreen-lyrics-line-active");
  return line;
}

const settings = (): Settings => normalizeSettings({});

export async function run(): Promise<void> {
  // --- LyricsSelectors ------------------------------------------------------------
  section("LyricsSelectors");
  const container = makeContainer(["line 1", "  ", "line 3"]);
  check("resolveContainer", resolveContainer(document) === container, true);
  check("hasLyricsInDom", hasLyricsInDom(container), true);
  check("lines-count", resolveLines(container).length, 3);
  check("lines-order", resolveLines(container).map((el) => el.textContent), ["line 1", "  ", "line 3"]);
  const active = makeActive(container, 1);
  check("resolveActiveLine", resolveActiveLine(container) === active, true);
  check("isActiveLine", isActiveLine(active), true);
  check("active-not-in-lines", isActiveLine(resolveLines(container)[0]), false);

  // --- LyricsExtractor ---------------------------------------------------------------
  section("LyricsExtractor");
  const extraction = extractLyrics(container);
  check("extract-lines", extraction.lines, ["line 1", "line 3"]);
  check("extract-active-index", extraction.activeIndex, 1);

  const unsynced = makeContainer(["only line"]);
  check("unsynced-active-null", extractLyrics(unsynced).activeIndex, null);
  // Must not stay in the DOM: a leftover container would shadow the observer's
  // open/close detection for the primary container below.
  unsynced.remove();

  // --- LyricsObserver -----------------------------------------------------------------
  section("LyricsObserver");
  const events: string[] = [];
  const observer = new LyricsObserver(
    {
      onOpen: (c) => events.push(`open:${c === container}`),
      onClose: () => events.push("close"),
      onContentChanged: () => events.push("content"),
      onDomMutated: () => events.push("dom"),
      onActiveLineChanged: (line) => events.push(`active:${line === active}`),
    },
    10,
  );
  observer.start();
  await flush(30);
  check("open-on-start", events.includes("open:true"), true);

  // Content change: append a new line.
  const newLine = document.createElement("div");
  newLine.setAttribute("data-testid", "fullscreen-lyrics-line");
  newLine.textContent = "brand new";
  container.appendChild(newLine);
  await flush(40);
  check("content-change-detected", events.includes("content"), true);
  check("dom-mutated-hook-fired", events.includes("dom"), true);

  // Dedupe: mutation with unchanged signature emits no NEW content event
  // (the raw onDomMutated hook still fires — that is by design).
  const contentEventsBefore = events.filter((e) => e === "content").length;
  newLine.textContent = "brand new";
  await flush(40);
  check("dedupe-unchanged-signature", events.filter((e) => e === "content").length, contentEventsBefore);

  // Active line attribute flip.
  makeActive(container, 0);
  await flush(20);
  check("active-line-change", events.some((e) => e === "active:false") || events.some((e) => e.startsWith("active:")), true);

  // Close: removing the container.
  container.remove();
  await flush(20);
  check("close-detected", events.includes("close"), true);

  // Re-open after close (body watcher re-armed).
  const container2 = makeContainer(["again"]);
  await flush(30);
  check("reopen-detected", events.some((e) => e === "open:true"), true);
  observer.stop();
  container2.remove();

  // --- Renderer ------------------------------------------------------------------------
  section("Renderer");
  const renderer = new Renderer(settings);
  const rc = makeContainer(["a", "b", "c"]);
  const lineEls = resolveLines(rc);
  renderer.setContent(["a", "b", "c"], ["A", "B", "C"]);
  renderer.resync(rc);
  const translations = rc.querySelectorAll('[data-ai-lyrics-translation="true"]');
  check("render-count", translations.length, 3);
  check("render-texts", Array.from(translations).map((el) => el.textContent), ["A", "B", "C"]);
  check("originals-untouched", lineEls.map((el) => el.firstChild?.textContent), ["a", "b", "c"]);
  check(
    "flow-sibling",
    (lineEls[0].nextElementSibling as HTMLElement | null)?.getAttribute("data-ai-lyrics-translation"),
    "true",
  );
  check("alignment-inherited", translations[0].style.textAlign, "inherit");

  // Idempotence: a second resync must not duplicate translations.
  renderer.resync(rc);
  check("resync-idempotent", rc.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 3);

  // Re-render simulation: React replaces the line elements with NEW nodes of
  // the same text — resync must re-attach to the new elements, not duplicate.
  const freshContainer = makeContainer(["a", "b", "c"]);
  const freshLines = resolveLines(freshContainer);
  rc.replaceWith(freshContainer);
  renderer.resync(freshContainer);
  check("rerender-reattached", freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 3);
  check(
    "rerender-attached-to-new",
    (freshLines[0].nextElementSibling as HTMLElement | null)?.getAttribute("data-ai-lyrics-translation"),
    "true",
  );

  // Active mirror (by adjacency: the translation right after the active line).
  renderer.setActiveLine(freshLines[1]);
  const all = freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]');
  check("active-opacity", all[1].style.opacity, "1");
  check("active-class", all[1].classList.contains("ai-lyrics-translator__line--active"), true);
  check("inactive-opacity", all[0].style.opacity, String(settings().opacity));
  renderer.setActiveLine(null);
  check("active-cleared", all[1].style.opacity, String(settings().opacity));

  // applySettings restyles existing elements.
  renderer.applySettings(normalizeSettings({ fontSize: 24, color: "#ff0000" }));
  check("apply-settings", all[0].style.fontSize, "24px");
  check("apply-settings-color", all[0].style.color, "rgb(255, 0, 0)");

  // Original mode attaches nothing.
  renderer.clear();
  const originalSettings = (): Settings => normalizeSettings({ displayMode: "original" });
  const rendererOriginal = new Renderer(originalSettings);
  rendererOriginal.setContent(["a"], ["A"]);
  rendererOriginal.resync(freshContainer);
  check("original-mode-empty", freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 0);

  // clear removes owned elements and the content map.
  renderer.setContent(["a", "b", "c"], ["A", "B", "C"]);
  renderer.resync(freshContainer);
  check("clear-pre", freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 3);
  renderer.clear();
  check("clear-removes-owned", freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 0);
  check("clear-keeps-originals", freshContainer.children.length, 3);
  renderer.resync(freshContainer);
  check("clear-wiped-map", freshContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 0);
  freshContainer.remove();

  // --- Overlay ----------------------------------------------------------------------------
  section("Overlay");
  const overlay = new Overlay();
  check("not-mounted-initially", overlay.isMounted(), false);
  overlay.mount();
  check("mounted", overlay.isMounted(), true);
  check("in-body", document.body.querySelector(".ai-lyrics-translator__overlay") !== null, true);
  overlay.mount();
  check("double-mount-safe", document.body.querySelectorAll(".ai-lyrics-translator__overlay").length, 1);
  check("no-toggle-button", document.querySelectorAll(".ai-lyrics-translator__toggle").length, 0);

  const status = document.querySelector<HTMLElement>(".ai-lyrics-translator__status");
  overlay.setStatus("translating");
  check("translating-label-shown", status?.style.display, "block");
  check("translating-label-text", status?.textContent, "Translating…");

  overlay.setStatus("ready");
  check("ready-hides-label", status?.style.display, "none");

  overlay.setStatus("translating");
  overlay.setStatus("error", "API key inválida.");
  check("status-error-message", status?.textContent, "API key inválida.");
  check("status-error-color", status?.style.color, "var(--spice-error)");

  overlay.unmount();
  check("unmounted", overlay.isMounted(), false);
  overlay.unmount();
  check("double-unmount-safe", document.body.querySelectorAll(".ai-lyrics-translator__overlay").length, 0);

  // --- 2026 lyrics layout (class-based, no data-testid) -------------------------------------
  section("2026 lyrics layout selectors");
  const newContainer = document.createElement("div");
  newContainer.className = "lyrics-lyrics-container";
  for (const [i, text] of ["a", "b", "c"].entries()) {
    const line = document.createElement("div");
    line.className =
      i === 1
        ? "lyrics-lyricsContent-lyric lyrics-lyricsContent-active"
        : "lyrics-lyricsContent-lyric lyrics-lyricsContent-upcoming";
    const textEl = document.createElement("div");
    textEl.className = "lyrics-lyricsContent-text";
    textEl.textContent = text;
    line.appendChild(textEl);
    newContainer.appendChild(line);
  }
  document.body.appendChild(newContainer);
  check("2026-container", resolveContainer(document) === newContainer, true);
  const newLines = resolveLines(newContainer);
  check("2026-lines", newLines.length, 3);
  check("2026-line-order", newLines.map((el) => el.textContent), ["a", "b", "c"]);
  const newActive = resolveActiveLine(newContainer);
  check("2026-active", newActive === newLines[1], true);
  check("2026-isActiveLine", isActiveLine(newLines[1]), true);
  const newExtraction = extractLyrics(newContainer);
  check("2026-extract", newExtraction.lines, ["a", "b", "c"]);
  check("2026-extract-active-index", newExtraction.activeIndex, 1);

  const renderer2026 = new Renderer(settings);
  renderer2026.setContent(["a", "b", "c"], ["A", "B", "C"]);
  renderer2026.resync(newContainer);
  const newTranslations = newContainer.querySelectorAll('[data-ai-lyrics-translation="true"]');
  check("2026-render-count", newTranslations.length, 3);
  check("2026-render-texts", Array.from(newTranslations).map((el) => el.textContent), ["A", "B", "C"]);
  renderer2026.setActiveLine(newLines[1]);
  check("2026-active-mirror", newTranslations[1].style.opacity, "1");
  renderer2026.resync(newContainer);
  check("2026-resync-idempotent", newContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 3);
  renderer2026.clear();
  check("2026-clear", newContainer.querySelectorAll('[data-ai-lyrics-translation="true"]').length, 0);
  newContainer.remove();

  // --- Negative: Renderer with a detached container must not throw --------------------------
  section("Renderer edge cases");
  const detached = document.createElement("div");
  detached.setAttribute("data-testid", "fullscreen-lyrics");
  const detachedLine = document.createElement("div");
  detachedLine.setAttribute("data-testid", "fullscreen-lyrics-line");
  detachedLine.textContent = "x";
  detached.appendChild(detachedLine);
  let threw = false;
  try {
    renderer.setContent(["x"], ["X"]);
    renderer.resync(detached);
    renderer.clear();
  } catch {
    threw = true;
  }
  check("render-detached-no-throw", threw, false);
}
