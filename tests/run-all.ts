/**
 * Test runner — bundles and executes every test module in order.
 * Run with: npm test
 *
 * Note: modules are imported dynamically AFTER setupDom() because some
 * modules instantiate singletons at import time that need a browser
 * environment (e.g. ConfigStore → window.localStorage).
 */
import { setupDom, finalize } from "./helpers";

async function main(): Promise<void> {
  setupDom();

  const { run: runParsersUtils } = await import("./parsers-utils.test");
  const { run: runCaches } = await import("./caches.test");
  const { run: runDomLayer } = await import("./dom-layer.test");
  const { run: runTranslator } = await import("./translator.test");
  const { run: runProvider } = await import("./provider.test");

  await runParsersUtils();
  await runCaches();
  await runDomLayer();
  await runTranslator();
  await runProvider();
  finalize();
}

void main();
