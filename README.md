# AI Lyrics Translator

Spicetify extension that translates the lyrics shown by Spotify **in place** —
each translated line is rendered underneath its original — using exclusively
the official [DeepSeek API](https://api.deepseek.com). Built with
TypeScript + [Spicetify Creator](https://spicetify.app/docs/development/spicetify-creator/).

## Requirements

- Node.js 18+
- Spicetify CLI ([install guide](https://spicetify.app/docs/getting-started/))

## Development

```bash
npm install
npm run build        # builds to the Spicetify Extensions folder
npm run build-local  # builds to ./dist (for inspection/repo)
npm run watch        # rebuilds on every change
```

To enable the extension:

```bash
spicetify config extensions ai-lyrics-translator.js
spicetify apply
```

Hot-reload development: run `npm run watch` in one terminal and
`spicetify watch -le` in another.

## Architecture

See the module headers under `src/`. Key design decisions:

- **DOM extraction, not private APIs**: `Spicetify.Player.getLyrics` does not
  exist in the public API, so lyrics are read from the rendered lyrics panel
  via stable `data-testid` selectors, centralized in `src/lyrics/LyricsSelectors.ts`.
- **Direct `fetch` to DeepSeek**: the API sends CORS headers allowing the
  Spotify origin (verified), so no proxy is used and the API key never passes
  through a third party.
- **One request per song**: the whole song is translated in a single chat
  completion (JSON mode), never per line.
- **Two-level cache**: in-memory `Map` + `localStorage`, so a song is only
  translated once.

## Status

Implemented and compiling. To use it:

```bash
npm install
npm run build        # writes dist to the Spicetify Extensions folder
spicetify config extensions ai-lyrics-translator.js
spicetify apply
```

Then open Settings → AI Lyrics Translator (top-bar icon) and add your
DeepSeek API key. Open the lyrics view of any song — translations render
under each line. The top-right overlay offers **Translate** (cache-first)
and **Refresh Translation** (bypasses the cache).

### Verified behaviors (automated test suite — `npm test`)

166 assertions across 5 suites (node + jsdom, esbuild-bundled runner):

- **JsonParser**: fences, prose, trailing commas, truncation, escaping
- **DeepSeek request body**: thinking/reasoning/JSON-mode contract
- **Settings normalization**: clamping, enum validation, corrupted input
- **Retry / DOM helpers / track-id extraction / PromptBuilder**
- **Caches + ConfigStore**: eviction, corruption-as-miss, reset, pub/sub
- **DOM layer (jsdom)**: selectors, extractor, observer open/close/content/active
  cycles, renderer alignment + active mirror, overlay states
- **Translator**: cache hits, parse retry, count mismatch, cancellation,
  refresh, error paths
- **DeepSeekProvider**: HTTP semantics with stubbed fetch — 401/429 retry/
  timeout/external abort/empty content
