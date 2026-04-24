import { EnvValidationError, loadEnvConfig } from "../config/env.js";

const ACTIVE_KEY = Buffer.alloc(32, 1).toString("base64");
const PREVIOUS_KEY = Buffer.alloc(32, 2).toString("base64");

describe("environment config validation", () => {
  it("applies secure defaults for omitted optional variables", () => {
    expect(loadEnvConfig({})).toEqual({
      nodeEnv: "development",
      port: 3001,
      idempotencyRedisEncryption: {
        enabled: false,
        algorithm: "aes-256-gcm",
        activeKey: null,
        decryptionKeys: [],
      },
    });
  });

  it("parses a fully valid configuration", () => {
    expect(
      loadEnvConfig({
        NODE_ENV: "production",
        PORT: "8080",
      }),
    ).toEqual({
      nodeEnv: "production",
      port: 8080,
      idempotencyRedisEncryption: {
        enabled: false,
        algorithm: "aes-256-gcm",
        activeKey: null,
        decryptionKeys: [],
      },
    });
  });

  it("parses idempotency Redis encryption settings when enabled", () => {
    const config = loadEnvConfig({
      NODE_ENV: "production",
      PORT: "8080",
      IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
      IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID: "primary-2026-04",
      IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: ACTIVE_KEY,
      IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS: `previous-2026-03:${PREVIOUS_KEY}`,
    });

    expect(config.idempotencyRedisEncryption.enabled).toBe(true);
    expect(config.idempotencyRedisEncryption.activeKey?.id).toBe("primary-2026-04");
    expect(config.idempotencyRedisEncryption.decryptionKeys.map((key) => key.id)).toEqual([
      "primary-2026-04",
      "previous-2026-03",
    ]);
  });

  it("accepts an explicit false flag for idempotency Redis encryption", () => {
    expect(
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "false",
      }).idempotencyRedisEncryption,
    ).toEqual({
      enabled: false,
      algorithm: "aes-256-gcm",
      activeKey: null,
      decryptionKeys: [],
    });
  });

  it("rejects unsupported NODE_ENV values", () => {
    expect(() =>
      loadEnvConfig({
        NODE_ENV: "prod",
      }),
    ).toThrow(
      new EnvValidationError(["NODE_ENV must be one of: development, test, production."]),
    );
  });

  it("rejects invalid port values and aggregates multiple failures", () => {
    expect(() =>
      loadEnvConfig({
        NODE_ENV: "invalid",
        PORT: "70000",
      }),
    ).toThrow(
      new EnvValidationError([
        "NODE_ENV must be one of: development, test, production.",
        "PORT must be a whole number between 1 and 65535.",
      ]),
    );
  });

  it("rejects whitespace-only values", () => {
    expect(() =>
      loadEnvConfig({
        NODE_ENV: "   ",
        PORT: "   ",
      }),
    ).toThrow(
      new EnvValidationError([
        "NODE_ENV must be a non-empty value when provided.",
        "PORT must be a non-empty integer when provided.",
      ]),
    );
  });

  it("does not leak raw values in validation errors", () => {
    const badSecretLikeValue = "very-sensitive-looking-value";

    try {
      loadEnvConfig({
        NODE_ENV: badSecretLikeValue,
        PORT: "abc",
      });
      throw new Error("expected config validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).toContain("NODE_ENV");
      expect((error as Error).message).toContain("PORT");
      expect((error as Error).message).not.toContain(badSecretLikeValue);
    }
  });

  it("rejects incomplete idempotency encryption config when enabled", () => {
    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID is required when IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED=true.",
        "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY is required when IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED=true.",
      ]),
    );
  });

  it("rejects invalid encryption flags and malformed keys", () => {
    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "maybe",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: "not-base64",
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED must be either 'true' or 'false' when provided.",
      ]),
    );
  });

  it("rejects invalid key ids, malformed previous key entries, and duplicate ids", () => {
    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID: "bad key id",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: ACTIVE_KEY,
        IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS: [
          `current:${PREVIOUS_KEY}`,
          `current:${PREVIOUS_KEY}`,
          "malformed-entry",
        ].join(","),
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID must contain only letters, numbers, dots, underscores, or hyphens.",
        "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS must not contain duplicate key ids.",
        "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS entries must use the format key-id:base64-key.",
      ]),
    );
  });

  it("rejects empty and wrong-length encryption keys", () => {
    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID: "current",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: "   ",
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY must be a non-empty base64 string when provided.",
      ]),
    );

    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID: "current",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: Buffer.alloc(16, 1).toString("base64"),
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY must decode to exactly 32 bytes of base64 data.",
      ]),
    );
  });

  it("rejects previous keys that repeat the active key id", () => {
    expect(() =>
      loadEnvConfig({
        IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED: "true",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID: "current",
        IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY: ACTIVE_KEY,
        IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS: `current:${PREVIOUS_KEY}`,
      }),
    ).toThrow(
      new EnvValidationError([
        "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS must not repeat IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID.",
      ]),
    );
  });
});
