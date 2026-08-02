/**
 * JsonParser — tolerant parser for the model's JSON translation response.
 *
 * What it does: takes the raw string returned by DeepSeek and produces either
 * a validated list of translation entries or a structured failure reason. It
 * attempts to repair common deviations — surrounding prose, markdown code
 * fences, trailing commas, missing closing brackets — before giving up.
 *
 * How it works: candidate extraction, then progressive repair:
 *   1. Trim and try the raw text as-is.
 *   2. If a ```json fence is present, try the fenced content.
 *   3. Try the substring from the first "[" to the last "]" (handles prose
 *      before/after the JSON).
 *   4. For each candidate, apply safe repairs in order: strip trailing commas
 *      before `]`/`}`, then (if the array is unterminated) append `]` and
 *      `}]` as fallback candidates.
 *   5. `validateEntries` enforces the schema: an array of objects with string
 *      `original`/`translated` fields. Any malformed entry invalidates the
 *      whole result — a partial array is worse than a clean retry, because
 *      the renderer aligns translations by index.
 *
 * Why it exists: JSON mode reduces but does not eliminate malformed output
 * (truncation, fences, prose). The repair policy lives in exactly one place
 * and is pure — no logging, no retries — so it is trivially unit-testable.
 *
 * How to modify:
 * - The spec's "retry once on failure" policy is NOT implemented here; the
 *   caller (`Translator`) owns retry orchestration and logging.
 * - If DeepSeek ever returns a different envelope (e.g. wrapped in an
 *   object), extend the candidate extraction — keep `validateEntries` strict.
 */
export interface TranslationEntry {
  original: string;
  translated: string;
}

export type ParseResult =
  | { ok: true; entries: TranslationEntry[] }
  | { ok: false; reason: string };

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
const TRAILING_COMMA_PATTERN = /,\s*([}\]])/g;

export function parseTranslationResponse(raw: string): ParseResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: false, reason: "empty-response" };
  }

  const candidates: string[] = [trimmed];

  const fenceMatch = FENCE_PATTERN.exec(trimmed);
  if (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    for (const repaired of repairJson(candidate)) {
      const parsed = safeParse(repaired);
      if (parsed === null) {
        continue;
      }
      const entries = validateEntries(parsed);
      if (entries !== null) {
        return { ok: true, entries };
      }
    }
  }

  return { ok: false, reason: "unparseable" };
}

/**
 * Produces progressively repaired variants of `text`. The original is always
 * first; later variants fix trailing commas and unterminated arrays. Variants
 * are deduplicated so identical repairs are only attempted once.
 */
function repairJson(text: string): string[] {
  const variants = new Set<string>([text]);

  const noTrailingCommas = text.replace(TRAILING_COMMA_PATTERN, "$1");
  if (noTrailingCommas !== text) {
    variants.add(noTrailingCommas);
  }

  // Unterminated array: try minimal closing brackets.
  if (!/\]\s*$/.test(noTrailingCommas)) {
    variants.add(noTrailingCommas + "]");
  }
  if (!/\}\s*\]\s*$/.test(noTrailingCommas)) {
    variants.add(noTrailingCommas + "}]");
  }

  return Array.from(variants);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Enforces the translation schema. Returns null when `value` is not an array
 * of {original, translated} string objects; entry texts are trimmed.
 */
function validateEntries(value: unknown): TranslationEntry[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries: TranslationEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.original !== "string" || typeof record.translated !== "string") {
      return null;
    }
    entries.push({
      original: record.original.trim(),
      translated: record.translated.trim(),
    });
  }

  return entries;
}
