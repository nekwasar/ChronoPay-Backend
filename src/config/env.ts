export type NodeEnv = "development" | "test" | "production";

export interface EncryptionKey {
  id: string;
  value: Buffer;
}

export type IdempotencyRedisEncryptionConfig =
  | {
      enabled: false;
      algorithm: "aes-256-gcm";
      activeKey: null;
      decryptionKeys: readonly EncryptionKey[];
    }
  | {
      enabled: true;
      algorithm: "aes-256-gcm";
      activeKey: EncryptionKey;
      decryptionKeys: readonly EncryptionKey[];
    };

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  idempotencyRedisEncryption: IdempotencyRedisEncryptionConfig;
}

/**
 * Error raised when process environment variables fail validation.
 * The message is safe to surface during startup because it only contains
 * variable names and validation reasons, never raw values.
 */
export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Parse and validate environment variables once at startup.
 *
 * @param env Raw environment map, usually process.env.
 * @returns Typed validated configuration for the application runtime.
 * @throws EnvValidationError When one or more variables are missing or invalid.
 */
export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const issues: string[] = [];
  const nodeEnv = parseNodeEnv(env.NODE_ENV, issues);
  const port = parsePort(env.PORT, issues);
  const idempotencyRedisEncryption = parseIdempotencyRedisEncryptionConfig(env, issues);

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return {
    nodeEnv,
    port,
    idempotencyRedisEncryption,
  };
}

function parseIdempotencyRedisEncryptionConfig(
  env: NodeJS.ProcessEnv,
  issues: string[],
): IdempotencyRedisEncryptionConfig {
  const enabled = parseBooleanFlag(
    env.IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED,
    "IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED",
    false,
    issues,
  );

  if (!enabled) {
    return {
      enabled: false,
      algorithm: "aes-256-gcm",
      activeKey: null,
      decryptionKeys: [],
    };
  }

  const activeKeyId = parseKeyId(
    env.IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID,
    "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID",
    issues,
  );
  const activeKeyValue = parseEncryptionKey(
    env.IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY,
    "IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY",
    issues,
  );
  const previousKeys = parsePreviousKeys(
    env.IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS,
    issues,
  );

  if (!activeKeyId || !activeKeyValue) {
    return {
      enabled: false,
      algorithm: "aes-256-gcm",
      activeKey: null,
      decryptionKeys: [],
    };
  }

  if (previousKeys.some((key) => key.id === activeKeyId)) {
    issues.push(
      "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS must not repeat IDEMPOTENCY_REDIS_ENCRYPTION_ACTIVE_KEY_ID.",
    );
  }

  const activeKey: EncryptionKey = {
    id: activeKeyId,
    value: activeKeyValue,
  };

  return {
    enabled: true,
    algorithm: "aes-256-gcm",
    activeKey,
    decryptionKeys: [activeKey, ...previousKeys],
  };
}

function parseNodeEnv(rawValue: string | undefined, issues: string[]): NodeEnv {
  if (rawValue === undefined) {
    return "development";
  }

  const value = rawValue.trim();
  const allowedValues: NodeEnv[] = ["development", "test", "production"];

  if (value.length === 0) {
    issues.push("NODE_ENV must be a non-empty value when provided.");
    return "development";
  }

  if (!allowedValues.includes(value as NodeEnv)) {
    issues.push("NODE_ENV must be one of: development, test, production.");
    return "development";
  }

  return value as NodeEnv;
}

function parsePort(rawValue: string | undefined, issues: string[]): number {
  if (rawValue === undefined) {
    return 3001;
  }

  const value = rawValue.trim();
  if (value.length === 0) {
    issues.push("PORT must be a non-empty integer when provided.");
    return 3001;
  }

  if (!/^\d+$/.test(value)) {
    issues.push("PORT must be a whole number between 1 and 65535.");
    return 3001;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    issues.push("PORT must be a whole number between 1 and 65535.");
    return 3001;
  }

  return parsed;
}

function parseBooleanFlag(
  rawValue: string | undefined,
  variableName: string,
  defaultValue: boolean,
  issues: string[],
): boolean {
  if (rawValue === undefined) {
    return defaultValue;
  }

  const value = rawValue.trim().toLowerCase();
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  issues.push(`${variableName} must be either 'true' or 'false' when provided.`);
  return defaultValue;
}

function parseKeyId(
  rawValue: string | undefined,
  variableName: string,
  issues: string[],
): string | null {
  if (rawValue === undefined) {
    issues.push(`${variableName} is required when IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED=true.`);
    return null;
  }

  const value = rawValue.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    issues.push(
      `${variableName} must contain only letters, numbers, dots, underscores, or hyphens.`,
    );
    return null;
  }

  return value;
}

function parseEncryptionKey(
  rawValue: string | undefined,
  variableName: string,
  issues: string[],
): Buffer | null {
  if (rawValue === undefined) {
    issues.push(`${variableName} is required when IDEMPOTENCY_REDIS_ENCRYPTION_ENABLED=true.`);
    return null;
  }

  const value = rawValue.trim();
  if (value.length === 0) {
    issues.push(`${variableName} must be a non-empty base64 string when provided.`);
    return null;
  }

  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length !== 32 || decoded.toString("base64") !== value) {
      issues.push(`${variableName} must decode to exactly 32 bytes of base64 data.`);
      return null;
    }

    return decoded;
  } catch {
    issues.push(`${variableName} must be valid base64 data.`);
    return null;
  }
}

function parsePreviousKeys(
  rawValue: string | undefined,
  issues: string[],
): EncryptionKey[] {
  if (rawValue === undefined || rawValue.trim().length === 0) {
    return [];
  }

  const keys: EncryptionKey[] = [];
  const seenIds = new Set<string>();

  for (const entry of rawValue.split(",")) {
    const trimmedEntry = entry.trim();
    if (trimmedEntry.length === 0) {
      continue;
    }

    const separatorIndex = trimmedEntry.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === trimmedEntry.length - 1) {
      issues.push(
        "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS entries must use the format key-id:base64-key.",
      );
      continue;
    }

    const keyId = parseKeyId(
      trimmedEntry.slice(0, separatorIndex),
      "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS",
      issues,
    );
    const keyValue = parseEncryptionKey(
      trimmedEntry.slice(separatorIndex + 1),
      "IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS",
      issues,
    );

    if (!keyId || !keyValue) {
      continue;
    }

    if (seenIds.has(keyId)) {
      issues.push("IDEMPOTENCY_REDIS_ENCRYPTION_PREVIOUS_KEYS must not contain duplicate key ids.");
      continue;
    }

    seenIds.add(keyId);
    keys.push({ id: keyId, value: keyValue });
  }

  return keys;
}
