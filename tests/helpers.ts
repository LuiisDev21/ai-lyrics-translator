/**
 * Test helpers — tiny assertion framework + jsdom bootstrap.
 * Bundled with esbuild (jsdom kept external) and run with node via `npm test`.
 */
import { JSDOM } from "jsdom";

let failures = 0;
let currentSection = "";
let checksInSection = 0;

/** Asserts deep equality (JSON serialization) and records the result. */
export function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${currentSection} › ${name}`);
  if (!pass) {
    console.log(`  got:      ${a}`);
    console.log(`  expected: ${e}`);
  }
}

/** Asserts that `fn` rejects with an error satisfying `predicate`. */
export async function checkRejects(
  name: string,
  fn: () => Promise<unknown>,
  predicate: (error: unknown) => boolean,
): Promise<void> {
  try {
    await fn();
    failures++;
    console.log(`FAIL ${currentSection} › ${name} (did not reject)`);
  } catch (error) {
    const pass = predicate(error);
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"} ${currentSection} › ${name}`);
    if (!pass) console.log(`  error: ${String(error)}`);
  }
}

export function section(name: string): void {
  currentSection = name;
  checksInSection = 0;
  console.log(`\n== ${name} ==`);
}

/** Flushes pending timers/microtasks. */
export function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Installs a jsdom browser environment on the node globals. */
export function setupDom(): void {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "https://open.spotify.com/",
  });
  const g = globalThis as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.MutationObserver = dom.window.MutationObserver;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  g.getComputedStyle = dom.window.getComputedStyle;
}

/** Prints the summary and sets the process exit code. */
export function finalize(): void {
  console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
