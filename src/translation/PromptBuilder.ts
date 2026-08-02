/**
 * PromptBuilder — constructs the system/user messages for the translation
 * request.
 *
 * What it does: turns the extracted lyric lines plus song context into the
 * exact messages sent to DeepSeek: a system message with the translation
 * contract and a user message with the numbered lyrics.
 *
 * How it works: the system prompt (a constant template with the target
 * language interpolated) encodes the quality contract — preserve meaning,
 * emotion, metaphors and cultural references; keep line structure; output ONLY
 * a JSON array with the documented schema; no markdown, no commentary. The
 * user message carries the song title/artist (context for the model) and the
 * lines as a numbered list, and states the required entry count explicitly.
 *
 * Why it exists: the spec requires a robust prompt that never accepts
 * non-JSON output. Centralizing it here means the prompt contract and the
 * parser contract (`JsonParser`) are each defined once, in their own module,
 * and can evolve independently.
 *
 * How to modify:
 * - Tone/quality tweaks: edit `SYSTEM_TEMPLATE` — keep the "exactly N entries"
 *   and "JSON only" rules; the alignment of translations to DOM lines depends
 *   on the entry count matching the line count.
 * - The response schema string here MUST match what `JsonParser` accepts:
 *   an array of `{"original": string, "translated": string}`.
 *
 * Note on language: instructions are in English (crisp for instruction
 * following); the target language of the translation is interpolated from the
 * settings and is the only thing the model is told about output language.
 */
export interface PromptContext {
  /** ISO 639-1 target language code, e.g. "es". */
  targetLanguage: string;
  /** Song title, for context. */
  songTitle: string;
  /** Artist name(s), for context. */
  artist: string;
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

const SYSTEM_TEMPLATE = `You are a professional song lyric translator.
Translate the lyrics provided by the user into {targetLanguage}.

Requirements:
- Preserve the meaning, emotion, metaphors and cultural references of the original as faithfully as possible; adapt them only when a literal translation would be meaningless.
- Preserve the line structure: one output entry per input line, in the same order, with exactly the same number of entries.
- The "original" field must reproduce the input line EXACTLY (same text, same order).
- The "translated" field must contain the translation of that single line into {targetLanguage}.
- Keep proper nouns (names, places) unless they have a well-known translation in {targetLanguage}.

Output rules:
- Output ONLY a valid JSON array. No markdown, no code fences, no explanations, no text before or after.
- Escape JSON strings correctly (quotes, backslashes, control characters).
- If the input contains a line that is empty, keep the corresponding entry with an empty "translated" value.

Response schema:
[
  {"original": "...", "translated": "..."}
]`;

/**
 * Builds the messages for one translation request. `lines` must be the exact
 * lines the renderer will align against (same order, same count).
 */
export function buildPrompt(
  lines: string[],
  context: PromptContext,
): BuiltPrompt {
  const system = SYSTEM_TEMPLATE.replace(/\{targetLanguage\}/g, context.targetLanguage);

  const numberedLines = lines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");

  const user = [
    `Song: "${context.songTitle}" — ${context.artist}`,
    `Target language: ${context.targetLanguage}`,
    `Lyrics (${lines.length} lines):`,
    numberedLines,
    `Return exactly ${lines.length} JSON objects, one per line, in the same order.`,
  ].join("\n");

  return { system, user };
}
