/**
 * Retry — exponential backoff helper for flaky operations.
 *
 * What it does: retries an async operation a bounded number of times with an
 * exponential delay between attempts, with an optional predicate to decide
 * which errors are worth retrying.
 *
 * How it works: `retryWithBackoff` loops up to `attempts` times. On success it
 * returns immediately. On failure it consults `shouldRetry(error)`; if the
 * error is not retryable (or attempts are exhausted) it re-throws the original
 * error unchanged, so callers never lose the real failure reason. The delay
 * grows as `baseDelayMs * factor^(attempt-1)`, capped at `maxDelayMs`.
 *
 * Why it exists: the extension performs two kinds of retryable work —
 * DeepSeek HTTP calls (rate limits, transient network errors) and the tolerant
 * JSON parse of an AI response (spec: one single retry). Centralizing the
 * timing policy keeps `Translator` and `JsonParser` free of backoff math.
 *
 * How to modify:
 * - Change the retry policy per caller by passing different `RetryOptions`.
 * - The default `shouldRetry` retries everything; pass a predicate to restrict
 *   retries to specific error kinds (see `DeepSeekProvider`'s error classes).
 */
export interface RetryOptions {
  /** Total number of attempts, including the first one (must be >= 1). */
  attempts: number;
  /** Delay before the first retry, in milliseconds. Default: 1000. */
  baseDelayMs?: number;
  /** Upper bound for the backoff delay, in milliseconds. Default: 10000. */
  maxDelayMs?: number;
  /** Exponential growth factor. Default: 2. */
  factor?: number;
  /** Returns false to stop retrying for a given error. Default: retry all. */
  shouldRetry?: (error: unknown) => boolean;
  /** Invoked right before each retry with the attempt number (1-based) and error. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Resolves after `ms` milliseconds. Shared so other modules can await without duplicating timers. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const {
    attempts,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    factor = 2,
  } = options;
  const shouldRetry = options.shouldRetry ?? ((): boolean => true);

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }

      options.onRetry?.(attempt, error);

      const backoffMs = Math.min(
        baseDelayMs * Math.pow(factor, attempt - 1),
        maxDelayMs,
      );
      await delay(backoffMs);
    }
  }

  // Unreachable: the loop above always returns or throws.
  throw lastError;
}
