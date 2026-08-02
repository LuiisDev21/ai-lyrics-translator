# AI Lyrics Translator

Spicetify extension that translates the lyrics shown by Spotify **in place** —
each translated line is rendered underneath its original, following the
karaoke dance. **Bring your own API key** (BYOK): the key never leaves your
machine and is sent only to the provider you choose.

Built with TypeScript + [Spicetify Creator](https://spicetify.app/docs/development/spicetify-creator/).

## Screenshots

![AI Lyrics Translator - Lirycs translated inside Spotify](screenshot.png)

## Features

- **Multi-provider**: DeepSeek (default), OpenRouter, Google Gemini, Groq and
  any custom OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp…).
  All providers verified to work from the Spotify origin (CORS).
- **Discreet UI**: a small "Translating…" label while working; nothing stays
  on screen once done. Settings live in the **profile menu** (avatar →
  *AI Lyrics Translator*).
- **Content-based tracking**: translations stay glued to their lines even as
  Spotify's React re-renders and virtualizes the lyrics rows.
- **One request per song** (JSON mode), **two-level cache** (memory +
  localStorage) — a song is translated once, ever.
- **Typed errors** in Spanish with friendly messages (invalid key, rate
  limit, timeout, network…).
- **25 target languages** via a dropdown (no manual ISO codes).

## Installation

### Via Spicetify Marketplace (recommended)

1. Install [Spicetify](https://spicetify.app/docs/getting-started/) and
   [Marketplace](https://github.com/spicetify/marketplace).
2. In Marketplace → Extensions → search **AI Lyrics Translator** → Install.
3. `spicetify apply` (or restart Spotify).

### Manual

```bash
spicetify config extensions ai-lyrics-translator.js
spicetify apply
```

## Configuration

1. Click your **profile picture** → **AI Lyrics Translator**.
2. Choose a provider (DeepSeek, OpenRouter, Gemini, Groq or custom endpoint).
3. Paste that provider's API key (each provider keeps its own).
4. Pick the target language and display mode, then **Guardar**.
5. Open the lyrics of any song — translations render under each line.

Free options: Gemini (Google free tier), Groq (free tier), OpenRouter
(free models), DeepSeek. The API key is stored only in your
`localStorage` and sent only to the selected provider.

## Development

```bash
npm install
npm test          # 183 assertions, node + jsdom
npm run build-local   # builds ./dist/ai-lyrics-translator.js
```

Manual install of a local build:

```bash
spicetify config extensions ai-lyrics-translator.js
spicetify apply
```

## Architecture

See the module headers under `src/`. Key decisions:

- **DOM extraction, not private APIs**: `Spicetify.Player.getLyrics` does not
  exist in the public API; lyrics are read from the rendered panel via
  selectors centralized in `src/lyrics/LyricsSelectors.ts`.
- **Direct fetch to each provider** (CORS verified for all of them): no
  proxy, the key never passes through a third party.
- **Provider registry** (`src/providers/`): one generic OpenAI-compatible
  engine parameterized by base URL + model list covers DeepSeek/OpenRouter/
  Gemini/Groq/custom; adding a provider = one config object.
- **Renderer v6**: translations are inserted INTO Spotify's lyrics flow,
  matched by content, re-attached on every DOM mutation — no fixed overlay
  layer, no correction loops.
