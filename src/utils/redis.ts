/**
 * Redis client used by the idempotency middleware and other request-path code.
 *
 * Lifecycle
 * ─────────
 * - connect / ready / error / close / end events are logged via the structured
 *   logger with the URL sanitized (credentials stripped).
 * - Exponential backoff reconnect capped at 3 s; gives up after 10 attempts.
 * - `closeRedisClient()` is idempotent and safe to call from signal handlers.
 *
 * Test isolation
 * ──────────────
 * When NODE_ENV=test an in-memory double is returned so tests never need a
 * real Redis server.
 */

import { logInfo, logError, logWarn } from "./logger.js";

const MAX_RETRY_ATTEMPTS = 10;
const MAX_RETRY_DELAY_MS = 3000;

/**
 * Strip credentials from a Redis URL so it is safe to log.
 * redis://:secret@host:6379 → redis://host:6379
 */
export function sanitizeRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.password = "";
    parsed.username = "";
    return parsed.toString();
  } catch {
    return "[invalid-redis-url]";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let redisClient: any = null;
let _ready = false;

/** Returns true once the client has emitted the "ready" event. */
export function isRedisReady(): boolean {
  return _ready;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const getRedisClient = (): any => {
  if (!redisClient) {
    if (process.env.NODE_ENV === "test") {
      const memoryStore = new Map<string, { value: string; expiresAt: number }>();

      redisClient = {
        ping: async () => "PONG",
        on: () => {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: async (key: string): Promise<string | null> => {
          const entry = memoryStore.get(key);
          if (!entry) return null;
          if (Date.now() > entry.expiresAt) {
            memoryStore.delete(key);
            return null;
          }
          return entry.value;
        },
        set: async (
          key: string,
          val: string,
          _ex: string,
          ttlSeconds: number,
          nx?: string,
        ): Promise<string | null> => {
          if (nx === "NX" && memoryStore.has(key)) return null;
          memoryStore.set(key, {
            value: val,
            expiresAt: Date.now() + ttlSeconds * 1000,
          });
          return "OK";
        },
        quit: async () => {
          memoryStore.clear();
          return "OK";
        },
      };
      _ready = true;
      return redisClient;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require("ioredis");
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const safeUrl = sanitizeRedisUrl(redisUrl);

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        if (times > MAX_RETRY_ATTEMPTS) {
          logError("[redis] Max reconnect attempts reached — giving up", {
            attempts: times,
            url: safeUrl,
          });
          return null;
        }
        const delay = Math.min(times * 100, MAX_RETRY_DELAY_MS);
        logWarn("[redis] Reconnecting", { attempt: times, delayMs: delay, url: safeUrl });
        return delay;
      },
    });

    redisClient.on("connect", () => {
      logInfo("[redis] TCP connection established", { url: safeUrl });
    });

    redisClient.on("ready", () => {
      _ready = true;
      logInfo("[redis] Ready — accepting commands", { url: safeUrl });
    });

    redisClient.on("error", (err: Error) => {
      logError("[redis] Connection error", { message: err.message, url: safeUrl });
    });

    redisClient.on("close", () => {
      _ready = false;
      logWarn("[redis] Connection closed", { url: safeUrl });
    });

    redisClient.on("end", () => {
      _ready = false;
      logWarn("[redis] Connection ended — no further reconnects", { url: safeUrl });
    });
  }

  return redisClient;
};

/**
 * Gracefully close the connection.  Idempotent — safe to call multiple times.
 * Call this from SIGTERM/SIGINT handlers before process.exit().
 */
export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    const closing = redisClient;
    redisClient = null;
    _ready = false;
    await closing.quit();
    logInfo("[redis] Connection closed gracefully");
  }
}
