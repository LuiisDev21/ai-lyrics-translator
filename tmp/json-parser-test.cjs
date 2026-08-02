"use strict";

// src/translation/JsonParser.ts
var FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;
var TRAILING_COMMA_PATTERN = /,\s*([}\]])/g;
function parseTranslationResponse(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty-response" };
  }
  const candidates = [trimmed];
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
function repairJson(text) {
  const variants = /* @__PURE__ */ new Set([text]);
  const noTrailingCommas = text.replace(TRAILING_COMMA_PATTERN, "$1");
  if (noTrailingCommas !== text) {
    variants.add(noTrailingCommas);
  }
  if (!/\]\s*$/.test(noTrailingCommas)) {
    variants.add(noTrailingCommas + "]");
  }
  if (!/\}\s*\]\s*$/.test(noTrailingCommas)) {
    variants.add(noTrailingCommas + "}]");
  }
  return Array.from(variants);
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}
function validateEntries(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      return null;
    }
    const record = item;
    if (typeof record.original !== "string" || typeof record.translated !== "string") {
      return null;
    }
    entries.push({
      original: record.original.trim(),
      translated: record.translated.trim()
    });
  }
  return entries;
}

// test-json-parser.ts
var failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const pass = a === e;
  if (!pass)
    failures++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}
  got:      ${a}
  expected: ${e}`);
}
check("clean", parseTranslationResponse('[{"original":"Hello","translated":"Hola"}]'), {
  ok: true,
  entries: [{ original: "Hello", translated: "Hola" }]
});
check(
  "fence",
  parseTranslationResponse('Sure! Here it is:\n```json\n[{"original":"A","translated":"B"}]\n```\nHope that helps.'),
  { ok: true, entries: [{ original: "A", translated: "B" }] }
);
check(
  "prose",
  parseTranslationResponse('Here is the translation: [{"original":"X","translated":"Y"}] done!'),
  { ok: true, entries: [{ original: "X", translated: "Y" }] }
);
check(
  "trailing-commas",
  parseTranslationResponse('[{"original":"A","translated":"B",},{"original":"C","translated":"D",}]'),
  {
    ok: true,
    entries: [
      { original: "A", translated: "B" },
      { original: "C", translated: "D" }
    ]
  }
);
check(
  "unterminated",
  parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C","translated":"D"}'),
  {
    ok: true,
    entries: [
      { original: "A", translated: "B" },
      { original: "C", translated: "D" }
    ]
  }
);
check("truncated-string", parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C","tran'), {
  ok: false,
  reason: "unparseable"
});
check("empty", parseTranslationResponse("   \n  "), { ok: false, reason: "empty-response" });
check("not-array", parseTranslationResponse('{"original":"A","translated":"B"}'), {
  ok: false,
  reason: "unparseable"
});
check(
  "bad-entry",
  parseTranslationResponse('[{"original":"A","translated":"B"},{"original":"C"}]'),
  { ok: false, reason: "unparseable" }
);
check(
  "trimming",
  parseTranslationResponse('[{"original":"  A  ","translated":" B "}]'),
  { ok: true, entries: [{ original: "A", translated: "B" }] }
);
check(
  "escaping",
  parseTranslationResponse(`[{"original":"Don't stop","translated":"No pares"},{"original":"He said \\"hi\\"","translated":"Dijo \\"hola\\""}]`),
  {
    ok: true,
    entries: [
      { original: "Don't stop", translated: "No pares" },
      { original: 'He said "hi"', translated: 'Dijo "hola"' }
    ]
  }
);
console.log(failures === 0 ? "\nALL TESTS PASSED" : `
${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
