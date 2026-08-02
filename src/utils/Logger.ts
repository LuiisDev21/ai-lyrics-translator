/**
 * Logger — namespaced, level-filtered console logging.
 *
 * What it does: provides a single logging entry point for the whole extension
 * with severity levels (debug/info/warn/error) and a `[AI Lyrics Translator]`
 * prefix so every message is identifiable in the Spotify DevTools console.
 *
 * How it works: the `Logger` class holds a minimum level. Every log call goes
 * through `emit`, which drops messages below the threshold and routes the rest
 * to the matching `console` method. A shared instance (`logger`) is exported
 * so modules don't each create their own.
 *
 * Why it exists: logging policy (prefix, level, destination) lives in exactly
 * one place. When debugging a report, we can raise the level once instead of
 * hunting scattered `console.log` calls.
 *
 * How to modify:
 * - To silence debug noise in production builds, set the shared instance to
 *   `LogLevel.Info` (already the default) — or to `Debug` while debugging.
 * - To add a destination (e.g. a ring buffer for the settings panel), extend
 *   `emit`.
 */
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

const PREFIX = "[AI Lyrics Translator]";

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.Info) {
    this.level = level;
  }

  /** Raises or lowers the minimum level. `Debug` enables everything. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    this.emit(LogLevel.Debug, "DEBUG", args);
  }

  info(...args: unknown[]): void {
    this.emit(LogLevel.Info, "INFO", args);
  }

  warn(...args: unknown[]): void {
    this.emit(LogLevel.Warn, "WARN", args);
  }

  error(...args: unknown[]): void {
    this.emit(LogLevel.Error, "ERROR", args);
  }

  private emit(level: LogLevel, label: string, args: unknown[]): void {
    if (level < this.level) {
      return;
    }

    const sink =
      level >= LogLevel.Error
        ? console.error
        : level >= LogLevel.Warn
          ? console.warn
          : level >= LogLevel.Info
            ? console.info
            : console.debug;

    sink(PREFIX, `[${label}]`, ...args);
  }
}

/** Shared logger instance used across the extension. */
export const logger = new Logger();
