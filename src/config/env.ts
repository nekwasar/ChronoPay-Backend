export type NodeEnv = "development" | "test" | "production";

export interface SmsEnvConfig {
  /** Ordered, comma-separated provider names, e.g. "twilio,vonage" or "in-memory" */
  providers: string[];
  twilio?: { accountSid: string; authToken: string; fromNumber: string };
  vonage?: { apiKey: string; apiSecret: string; fromName: string };
}

export interface EnvConfig {
  nodeEnv: NodeEnv;
  port: number;
  sms: SmsEnvConfig;
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
  const sms = parseSmsConfig(env, issues);

  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  return { nodeEnv, port, sms };
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

const KNOWN_PROVIDERS = new Set(["twilio", "vonage", "in-memory"]);

function parseSmsConfig(env: NodeJS.ProcessEnv, issues: string[]): SmsEnvConfig {
  const raw = (env.SMS_PROVIDERS ?? "in-memory").trim();
  if (!raw) {
    issues.push("SMS_PROVIDERS must be a non-empty comma-separated list of provider names.");
    return { providers: ["in-memory"] };
  }

  const providers = raw.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of providers) {
    if (!KNOWN_PROVIDERS.has(p)) {
      issues.push(`SMS_PROVIDERS contains unknown provider "${p}". Allowed: ${[...KNOWN_PROVIDERS].join(", ")}.`);
    }
  }

  const config: SmsEnvConfig = { providers };

  if (providers.includes("twilio")) {
    const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? "";
    const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? "";
    const fromNumber = env.TWILIO_FROM_NUMBER?.trim() ?? "";
    if (!accountSid) issues.push("TWILIO_ACCOUNT_SID is required when 'twilio' is listed in SMS_PROVIDERS.");
    if (!authToken) issues.push("TWILIO_AUTH_TOKEN is required when 'twilio' is listed in SMS_PROVIDERS.");
    if (!fromNumber) issues.push("TWILIO_FROM_NUMBER is required when 'twilio' is listed in SMS_PROVIDERS.");
    if (accountSid && authToken && fromNumber) {
      config.twilio = { accountSid, authToken, fromNumber };
    }
  }

  if (providers.includes("vonage")) {
    const apiKey = env.VONAGE_API_KEY?.trim() ?? "";
    const apiSecret = env.VONAGE_API_SECRET?.trim() ?? "";
    const fromName = env.VONAGE_FROM_NAME?.trim() ?? "";
    if (!apiKey) issues.push("VONAGE_API_KEY is required when 'vonage' is listed in SMS_PROVIDERS.");
    if (!apiSecret) issues.push("VONAGE_API_SECRET is required when 'vonage' is listed in SMS_PROVIDERS.");
    if (!fromName) issues.push("VONAGE_FROM_NAME is required when 'vonage' is listed in SMS_PROVIDERS.");
    if (apiKey && apiSecret && fromName) {
      config.vonage = { apiKey, apiSecret, fromName };
    }
  }

  return config;
}
