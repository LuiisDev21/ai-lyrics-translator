/**
 * Entry shim required by spicetify-creator.
 *
 * Why this file exists: `spicetify-creator` resolves the extension entry
 * point with a fixed glob (`src/app.(ts|tsx|js|jsx)`) and expects a default
 * export named `main`. Keeping the real bootstrap in `src/index.ts` lets us
 * treat this file as pure build-tool plumbing: if the tool ever changes its
 * glob, only this shim needs to be updated.
 *
 * How to modify: this file should never contain logic. All application code
 * lives in `src/index.ts` and is re-exported from here verbatim.
 */
export { default } from "./index";
