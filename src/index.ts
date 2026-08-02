/**
 * AI Lyrics Translator — composition root (entry point of the extension).
 *
 * What it does: instantiates every module, wires them together and drives the
 * application lifecycle. This is the ONLY file allowed to compose modules;
 * no module imports another module's instance.
 *
 * How it works (event flow):
 *
 *   songchange (SongListener)
 *     → cancel in-flight translation (Translator.cancel)
 *     → clear rendered translations (Renderer.clear)
 *     → if the lyrics panel is open and auto-translate is on:
 *         Translator.translate(track, container)  (cache-first)
 *
 *   lyrics panel opened (LyricsObserver.onOpen)
 *     → mount overlay (Overlay.mount)
 *     → translate current track if auto-translate is on
 *
 *   lyrics panel closed (LyricsObserver.onClose)
 *     → unmount overlay, clear renderer
 *
 *   lyric content changed (LyricsObserver.onContentChanged)
 *     → re-translate (cache-first; a different line count invalidates the
 *       cached entry, triggering a real re-request)
 *
 *   karaoke active line changed (LyricsObserver.onActiveLineChanged)
 *     → mirror highlight (Renderer.setActiveLine)
 *
 *   settings changed (ConfigStore.onChange)
 *     → restyle rendered translations live (Renderer.applySettings)
 *
 *   status/result (Translator.onStatus / onTranslated)
 *     → overlay indicator / Renderer.render
 *
 * Why it exists: a single entry point keeps the dependency graph acyclic and
 * makes startup order explicit. The extension gates on the public Spicetify
 * APIs it needs (Player, Platform, Topbar, PopupModal, showNotification).
 *
 * How to modify: add new modules here in dependency order. The
 * `bootstrap()` function is the wiring point; keep it free of logic.
 */
import { SongListener, type CurrentTrack } from "./player/SongListener";
import { LyricsObserver } from "./lyrics/LyricsObserver";
import { Translator, type TranslationStatus } from "./translation/Translator";
import { Renderer } from "./ui/Renderer";
import { Overlay } from "./ui/Overlay";
import { openSettingsPanel } from "./ui/SettingsPanel";
import { configStore } from "./settings/ConfigStore";
import { MemoryCache } from "./cache/MemoryCache";
import { PersistentCache } from "./cache/PersistentCache";
import { logger } from "./utils/Logger";

export default async function main(): Promise<void> {
  // Official readiness pattern: retry until the required APIs exist.
  while (
    !Spicetify?.Player ||
    !Spicetify?.Platform ||
    !Spicetify?.showNotification
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    bootstrap();
    logger.info("Extension loaded.");
  } catch (error) {
    logger.error("Failed to bootstrap.", error);
    Spicetify.showNotification("AI Lyrics Translator failed to start.", true);
  }
}

function bootstrap(): void {
  // --- Infrastructure ------------------------------------------------------
  const memoryCache = new MemoryCache();
  const persistentCache = new PersistentCache();
  const getSettings = (): ReturnType<typeof configStore.get> => configStore.get();

  // --- State shared by the observers ----------------------------------------
  // The lyrics container currently open (null when the panel is closed).
  let openContainer: Element | null = null;
  // The track currently playing (null for ads/podcasts).
  let currentTrack: CurrentTrack | null = null;

  // --- UI -------------------------------------------------------------------
  const renderer = new Renderer(getSettings);
  const overlay = new Overlay();

  // --- Translator ------------------------------------------------------------
  const translator = new Translator({
    memoryCache,
    persistentCache,
    getSettings,
    onStatus: (status: TranslationStatus, message?: string) => {
      overlay.setStatus(status, message);
    },
    onTranslated: (track, lines, translations) => {
      // Content-based tracking: store the map, then attach to the current DOM.
      renderer.setContent(lines, translations);
      if (openContainer) {
        const attached = renderer.resync(openContainer);
        logger.info(
          `Renderer attached ${attached}/${translations.length} translations.`,
        );
        if (attached === 0 && translations.length > 0) {
          // The translation completed but nothing rendered: the display mode
          // ("Mostrar") hides them. Tell the user instead of failing silently.
          overlay.setStatus(
            "error",
            "Traducción lista pero oculta: revisa «Mostrar» en los ajustes.",
          );
        }
      }
    },
  });

  // --- Lyrics panel observer ---------------------------------------------------
  const lyricsObserver = new LyricsObserver({
    onOpen: (container) => {
      openContainer = container;
      overlay.mount(container);
      if (currentTrack && getSettings().autoTranslate) {
        void translator.translate(currentTrack, container);
      }
    },
    onClose: () => {
      openContainer = null;
      overlay.unmount();
      renderer.clear();
    },
    onContentChanged: (container) => {
      if (currentTrack && getSettings().autoTranslate) {
        void translator.translate(currentTrack, container);
      }
    },
    // React re-renders and row virtualization recreate the line elements; the
    // Renderer re-attaches its translations to the new elements immediately.
    onDomMutated: (container) => {
      renderer.resync(container);
    },
    onActiveLineChanged: (activeLine) => {
      renderer.setActiveLine(activeLine);
    },
  });

  // --- Song listener -----------------------------------------------------------
  const songListener = new SongListener();
  songListener.onChange((track) => {
    currentTrack = track;
    translator.cancel();
    renderer.clear();
    overlay.setStatus("idle");

    if (track === null) {
      return;
    }
    if (openContainer && getSettings().autoTranslate) {
      void translator.translate(track, openContainer);
    }
  });

  // --- Settings change → live restyle --------------------------------------------
  configStore.onChange((settings) => {
    renderer.applySettings(settings);
  });

  // --- Settings entry point (profile menu — official Spicetify.Menu API) ---------
  // Registered once; `Spicetify.Menu.Item` prepends it to the profile
  // dropdown (the menu opened from the avatar). Icon "lyrics" is a built-in
  // Spotify icon id, which the wrapper resolves natively.
  new Spicetify.Menu.Item(
    "AI Lyrics Translator",
    true,
    () => openSettingsPanel({ store: configStore, memoryCache, persistentCache }),
    "lyrics",
  ).register();

  // --- Start ----------------------------------------------------------------------
  lyricsObserver.start();
  songListener.start();
}
