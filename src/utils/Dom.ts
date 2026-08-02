/**
 * Dom — small, typed helpers for the DOM operations the extension repeats.
 *
 * What it does: wraps element creation, attribute setting, queries and
 * insertion/removal in narrow functions with proper TypeScript types.
 *
 * How it works: each helper delegates to the standard DOM API and adds a typed
 * surface (`createElement` returns the specific element type for the tag,
 * `queryAll`/`queryFirst` are generic over the element type). `createElement`
 * reuses `setAttributes` internally, so attribute handling has a single
 * implementation.
 *
 * Why it exists: the UI layer (Renderer, Overlay, StatusIndicator, ...) builds
 * and mutates DOM elements constantly. Centralizing the boilerplate keeps the
 * `ui/` modules declarative and prevents subtle bugs like forgetting
 * `textContent` vs `innerHTML` (we only ever use `textContent` — lyrics are
 * user/AI content and must never be injected as HTML).
 *
 * How to modify: add helpers here when a DOM pattern repeats in at least two
 * modules. Keep them generic — anything lyrics-specific belongs in
 * `src/lyrics/LyricsSelectors.ts`.
 */
export interface ElementSpec {
  className?: string;
  attrs?: Record<string, string>;
  text?: string;
}

/**
 * Creates an element of the given tag with optional class, attributes and
 * text content. Text is always set via `textContent` — never `innerHTML`.
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  spec: ElementSpec = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (spec.className) {
    el.className = spec.className;
  }

  if (spec.attrs) {
    setAttributes(el, spec.attrs);
  }

  if (spec.text !== undefined) {
    el.textContent = spec.text;
  }

  return el;
}

/** Sets multiple attributes on an element in one call. */
export function setAttributes(el: Element, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
}

/** Returns all elements matching `selector` under `root`, as a typed array. */
export function queryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/** Returns the first element matching `selector` under `root`, or null. */
export function queryFirst<T extends Element>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

/** Inserts `newNode` immediately after `referenceNode` (no-op if it has no parent). */
export function insertAfter(newNode: Node, referenceNode: Node): void {
  referenceNode.parentNode?.insertBefore(newNode, referenceNode.nextSibling);
}

/** Removes every child node of `el`. */
export function removeChildren(el: Element): void {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}
