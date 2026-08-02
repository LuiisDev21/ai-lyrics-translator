/**
 * SongListener — current-track detection through the public Player API.
 *
 * What it does: wraps the `songchange` event of `Spicetify.Player` (public,
 * documented API — verified in the official `spicetifyWrapper.js`) and emits a
 * normalized `CurrentTrack` object to subscribed listeners. It also emits the
 * current track once on `start()`, covering the case where the extension is
 * enabled while a song is already playing.
 *
 * How it works: on `start()` the listener registers a `songchange` handler and
 * immediately reads the current state via `Spicetify.Player.data`. Each
 * emission is a fresh `CurrentTrack` with a bare track id (`spotify:track:<id>`
 * → `<id>`), which is exactly the cache key material used by the cache layer.
 * Non-track playback (ads, podcasts, local files) yields `null`, since there is
 * nothing to translate. `stop()` unregisters the handler, and `onChange()`
 * returns an unsubscribe function for leak-free teardown.
 *
 * Why it exists: song changes drive the whole pipeline (cancel in-flight
 * translation, check cache, re-translate). Exposing a single typed event
 * source keeps `Translator` and the composition root decoupled from the
 * Spicetify event API — if Spicetify ever changes the event name, only this
 * module changes.
 *
 * How to modify:
 * - To react to other player events (pause/resume, progress), add more
 *   handlers here and extend the emitted payload — keep the public surface of
 *   this module stable for consumers.
 * - The id extraction regex is deliberately strict (`[A-Za-z0-9]+`): Spotify
 *   track ids are base62. If that ever changes, fix `TRACK_URI_PATTERN` here.
 */
export interface CurrentTrack {
  /** Full Spotify URI, e.g. "spotify:track:4uLU6hMCjMI75M1A2tKUQC". */
  uri: string;
  /** Bare track id (base62), the cache key material. */
  id: string;
  /** Track name. */
  name: string;
  /** Artist names joined with ", ", for prompt context. */
  artist: string;
}

export type TrackListener = (track: CurrentTrack | null) => void;

const TRACK_URI_PATTERN = /^spotify:track:([A-Za-z0-9]+)$/;

/** Extracts the bare track id from a Spotify track URI, or null if not a track. */
export function extractTrackId(uri: string): string | null {
  const match = TRACK_URI_PATTERN.exec(uri);
  return match ? match[1] : null;
}

/** Reads the currently playing track from the public Player state. */
export function readCurrentTrack(): CurrentTrack | null {
  const item = Spicetify.Player.data?.item;
  if (!item) {
    return null;
  }

  const id = extractTrackId(item.uri);
  if (id === null) {
    // Ads, podcasts, local files, etc. — nothing to translate.
    return null;
  }

  const artist = (item.artists ?? [])
    .map((entry) => entry.name)
    .filter((name) => name.length > 0)
    .join(", ");

  return {
    uri: item.uri,
    id,
    name: item.name,
    artist,
  };
}

export class SongListener {
  private readonly listeners = new Set<TrackListener>();
  private current: CurrentTrack | null = null;
  private started = false;

  private readonly onSongChange = (): void => {
    this.emit(readCurrentTrack());
  };

  /** Registers the player listener and emits the current track immediately. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    Spicetify.Player.addEventListener("songchange", this.onSongChange);
    this.emit(readCurrentTrack());
  }

  /** Unregisters the player listener and drops all subscribers. */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    Spicetify.Player.removeEventListener("songchange", this.onSongChange);
    this.listeners.clear();
  }

  /** The most recently emitted track (or null). */
  getCurrent(): CurrentTrack | null {
    return this.current;
  }

  /**
   * Subscribes to track changes. Returns an unsubscribe function; call it on
   * teardown to avoid leaks.
   */
  onChange(listener: TrackListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(track: CurrentTrack | null): void {
    this.current = track;
    for (const listener of this.listeners) {
      try {
        listener(track);
      } catch (error) {
        // A failing subscriber must never break the event loop for others.
        console.error("[AI Lyrics Translator] Track listener threw.", error);
      }
    }
  }
}
