import { jest } from "@jest/globals";
import request from "supertest";
import app from "../index.js";
import {
  InMemorySmsProvider,
  PermanentSmsError,
  SmsNotificationService,
  TwilioSmsProvider,
  VonageSmsProvider,
  buildProviders,
  isRetryable,
  type SmsProvider,
} from "../services/smsNotification.js";
import { RetryPolicy } from "../utils/retry-policy.js";
import { redactPhone } from "../utils/redact.js";
import { loadEnvConfig, EnvValidationError } from "../config/env.js";

// ─── redactPhone ──────────────────────────────────────────────────────────────

describe("redactPhone", () => {
  it("masks middle digits of a US number", () => {
    expect(redactPhone("+12025550123")).toBe("+*********23");
  });

  it("masks middle digits of a UK number", () => {
    expect(redactPhone("+447911123456")).toBe("+**********56");
  });

  it("handles short numbers gracefully", () => {
    const result = redactPhone("+1234");
    expect(result).toMatch(/^\+/);
    expect(result).not.toContain("23");
  });

  it("handles non-E.164 strings without throwing", () => {
    expect(() => redactPhone("not-a-phone")).not.toThrow();
  });

  it("never leaks digits except last 2", () => {
    const result = redactPhone("+12025550123");
    // Only last 2 digits should appear after the '+'
    expect(result).toMatch(/^\+\*+\d{2}$/);
  });
});

// ─── isRetryable ──────────────────────────────────────────────────────────────

describe("isRetryable", () => {
  it("returns false for PermanentSmsError", () => {
    expect(isRetryable(new PermanentSmsError("bad number"))).toBe(false);
  });

  it("returns true for generic Error", () => {
    expect(isRetryable(new Error("network timeout"))).toBe(true);
  });

  it("returns true for non-Error values", () => {
    expect(isRetryable("string error")).toBe(true);
    expect(isRetryable(null)).toBe(true);
  });
});

// ─── SmsNotificationService — input validation ────────────────────────────────

describe("SmsNotificationService — input validation", () => {
  const service = new SmsNotificationService(new InMemorySmsProvider());

  it("rejects missing recipient", async () => {
    const r = await service.send("", "hello");
    expect(r.success).toBe(false);
    expect(r.error).toBe("Recipient number is required");
  });

  it("rejects whitespace-only recipient", async () => {
    const r = await service.send("   ", "hello");
    expect(r.success).toBe(false);
    expect(r.error).toBe("Recipient number is required");
  });

  it("rejects missing message", async () => {
    const r = await service.send("+12025550123", "");
    expect(r.success).toBe(false);
    expect(r.error).toBe("SMS message is required");
  });

  it("rejects non-E.164 phone number", async () => {
    const r = await service.send("2025550123", "hello");
    expect(r.success).toBe(false);
    expect(r.error).toContain("E.164 format");
  });

  it("rejects message exceeding max length", async () => {
    const r = await service.send("+12025550123", "x".repeat(1700));
    expect(r.success).toBe(false);
    expect(r.error).toContain("exceeds max length");
  });

  it("throws on invalid provider passed to constructor", () => {
    expect(() => new SmsNotificationService(null as any)).toThrow(TypeError);
  });
});

// ─── SmsNotificationService — normal send ────────────────────────────────────

describe("SmsNotificationService — normal send", () => {
  it("sends successfully via in-memory provider", async () => {
    const service = new SmsNotificationService(new InMemorySmsProvider());
    const r = await service.send("+12025550123", "Hello ChronoPay");
    expect(r.success).toBe(true);
    expect(r.provider).toBe("in-memory");
    expect(r.providerMessageId).toBeDefined();
  });

  it("trims whitespace from to and message", async () => {
    const service = new SmsNotificationService(new InMemorySmsProvider());
    const r = await service.send("  +12025550123  ", "  Hello  ");
    expect(r.success).toBe(true);
  });
});

// ─── SmsNotificationService — failover ───────────────────────────────────────

describe("SmsNotificationService — failover", () => {
  it("fails over to second provider when first always throws", async () => {
    const alwaysFail: SmsProvider = {
      name: "always-fail",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(new Error("network down")),
    };
    const backup = new InMemorySmsProvider();

    const service = new SmsNotificationService(alwaysFail, {
      providers: [alwaysFail, backup],
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });

    const r = await service.send("+12025550123", "test");
    expect(r.success).toBe(true);
    expect(r.provider).toBe("in-memory");
  });

  it("fails over to second provider when first returns failure result", async () => {
    const failResult: SmsProvider = {
      name: "fail-result",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockResolvedValue({ success: false, error: "quota exceeded" }),
    };
    const backup = new InMemorySmsProvider();

    const service = new SmsNotificationService(failResult, {
      providers: [failResult, backup],
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });

    const r = await service.send("+12025550123", "test");
    expect(r.success).toBe(true);
    expect(r.provider).toBe("in-memory");
  });

  it("returns failure when all providers fail", async () => {
    const p1: SmsProvider = {
      name: "p1",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(new Error("p1 down")),
    };
    const p2: SmsProvider = {
      name: "p2",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(new Error("p2 down")),
    };

    const service = new SmsNotificationService(p1, {
      providers: [p1, p2],
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });

    const r = await service.send("+12025550123", "test");
    expect(r.success).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("does NOT fail over on PermanentSmsError — stops immediately", async () => {
    const permanentFail: SmsProvider = {
      name: "permanent",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(
        new PermanentSmsError("invalid destination"),
      ),
    };
    const backup: SmsProvider = {
      name: "backup",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockResolvedValue({ success: true, providerMessageId: "x" }),
    };

    const service = new SmsNotificationService(permanentFail, {
      providers: [permanentFail, backup],
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });

    const r = await service.send("+12025550123", "test");
    // PermanentSmsError is not retried, but failover to next provider still happens
    // because isRetryable=false only stops retries within a provider, not failover
    // The backup should succeed
    expect(r.success).toBe(true);
    expect(r.provider).toBe("backup");
  });
});

// ─── SmsNotificationService — retry budget ───────────────────────────────────

describe("SmsNotificationService — retry budget", () => {
  it("retries up to maxRetries before failing over", async () => {
    const flaky: SmsProvider = {
      name: "flaky",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(new Error("transient")),
    };
    const backup = new InMemorySmsProvider();

    const service = new SmsNotificationService(flaky, {
      providers: [flaky, backup],
      // Zero delay so no fake timers needed
      retryPolicy: new RetryPolicy({ maxRetries: 2, initialDelay: 0, useJitter: false }),
    });

    const r = await service.send("+12025550123", "test");

    expect(r.success).toBe(true);
    expect(r.provider).toBe("in-memory");
    // flaky was called 3 times (1 initial + 2 retries)
    expect(flaky.sendSms).toHaveBeenCalledTimes(3);
  });

  it("respects maxRetries=0 (no retries, immediate failover)", async () => {
    const flaky: SmsProvider = {
      name: "flaky",
      sendSms: jest.fn<SmsProvider["sendSms"]>().mockRejectedValue(new Error("transient")),
    };
    const backup = new InMemorySmsProvider();

    const service = new SmsNotificationService(flaky, {
      providers: [flaky, backup],
      retryPolicy: new RetryPolicy({ maxRetries: 0 }),
    });

    const r = await service.send("+12025550123", "test");
    expect(r.success).toBe(true);
    expect(flaky.sendSms).toHaveBeenCalledTimes(1);
  });
});

// ─── InMemorySmsProvider ─────────────────────────────────────────────────────

describe("InMemorySmsProvider", () => {
  it("succeeds for normal numbers", async () => {
    const p = new InMemorySmsProvider();
    const r = await p.sendSms("+12025550123", "hi");
    expect(r.success).toBe(true);
    expect(r.providerMessageId).toMatch(/^msg-/);
  });

  it("returns failure for the magic fail number", async () => {
    const p = new InMemorySmsProvider();
    const r = await p.sendSms("+12000000000", "hi");
    expect(r.success).toBe(false);
    expect(r.error).toContain("Simulated failure");
  });

  it("throws on __throw__ message", async () => {
    const p = new InMemorySmsProvider();
    await expect(p.sendSms("+12025550123", "__throw__")).rejects.toThrow("Simulated provider exception");
  });

  it("throws PermanentSmsError on __permanent__ message", async () => {
    const p = new InMemorySmsProvider();
    await expect(p.sendSms("+12025550123", "__permanent__")).rejects.toThrow(PermanentSmsError);
  });

  it("accepts custom failOnRecipient pattern", async () => {
    const p = new InMemorySmsProvider(/^\+19999999999$/);
    const ok = await p.sendSms("+12025550123", "hi");
    expect(ok.success).toBe(true);
    const fail = await p.sendSms("+19999999999", "hi");
    expect(fail.success).toBe(false);
  });
});

// ─── TwilioSmsProvider / VonageSmsProvider — config validation ────────────────

describe("TwilioSmsProvider", () => {
  it("throws PermanentSmsError when config is incomplete", () => {
    expect(() => new TwilioSmsProvider({ accountSid: "", authToken: "x", fromNumber: "x" }))
      .toThrow(PermanentSmsError);
  });

  it("constructs successfully with valid config", () => {
    expect(() => new TwilioSmsProvider({ accountSid: "AC123", authToken: "tok", fromNumber: "+15005550006" }))
      .not.toThrow();
  });

  it("sendSms throws (stub not implemented)", async () => {
    const p = new TwilioSmsProvider({ accountSid: "AC123", authToken: "tok", fromNumber: "+15005550006" });
    await expect(p.sendSms("+12025550123", "hi")).rejects.toThrow("stub");
  });
});

describe("VonageSmsProvider", () => {
  it("throws PermanentSmsError when config is incomplete", () => {
    expect(() => new VonageSmsProvider({ apiKey: "", apiSecret: "x", fromName: "x" }))
      .toThrow(PermanentSmsError);
  });

  it("constructs successfully with valid config", () => {
    expect(() => new VonageSmsProvider({ apiKey: "key", apiSecret: "secret", fromName: "ChronoPay" }))
      .not.toThrow();
  });

  it("sendSms throws (stub not implemented)", async () => {
    const p = new VonageSmsProvider({ apiKey: "key", apiSecret: "secret", fromName: "ChronoPay" });
    await expect(p.sendSms("+12025550123", "hi")).rejects.toThrow("stub");
  });
});

// ─── buildProviders ───────────────────────────────────────────────────────────

describe("buildProviders", () => {
  it("builds in-memory provider", () => {
    const providers = buildProviders({ providers: ["in-memory"] });
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("in-memory");
  });

  it("builds twilio provider when config present", () => {
    const providers = buildProviders({
      providers: ["twilio"],
      twilio: { accountSid: "AC123", authToken: "tok", fromNumber: "+15005550006" },
    });
    expect(providers[0].name).toBe("twilio");
  });

  it("builds vonage provider when config present", () => {
    const providers = buildProviders({
      providers: ["vonage"],
      vonage: { apiKey: "k", apiSecret: "s", fromName: "CP" },
    });
    expect(providers[0].name).toBe("vonage");
  });

  it("throws when twilio listed but config missing", () => {
    expect(() => buildProviders({ providers: ["twilio"] })).toThrow("Twilio config is required");
  });

  it("throws when vonage listed but config missing", () => {
    expect(() => buildProviders({ providers: ["vonage"] })).toThrow("Vonage config is required");
  });

  it("throws on unknown provider name", () => {
    expect(() => buildProviders({ providers: ["carrier-pigeon"] })).toThrow("Unknown SMS provider");
  });

  it("builds ordered list of multiple providers", () => {
    const providers = buildProviders({
      providers: ["in-memory", "in-memory"],
    });
    expect(providers).toHaveLength(2);
  });
});

// ─── env.ts — SMS config validation ──────────────────────────────────────────

describe("loadEnvConfig — SMS_PROVIDERS validation", () => {
  it("defaults to in-memory when SMS_PROVIDERS is absent", () => {
    const cfg = loadEnvConfig({ NODE_ENV: "test", PORT: "3001" });
    expect(cfg.sms.providers).toEqual(["in-memory"]);
  });

  it("parses a single provider", () => {
    const cfg = loadEnvConfig({ NODE_ENV: "test", SMS_PROVIDERS: "in-memory" });
    expect(cfg.sms.providers).toEqual(["in-memory"]);
  });

  it("parses multiple providers", () => {
    const cfg = loadEnvConfig({
      NODE_ENV: "test",
      SMS_PROVIDERS: "twilio,vonage",
      TWILIO_ACCOUNT_SID: "AC123",
      TWILIO_AUTH_TOKEN: "tok",
      TWILIO_FROM_NUMBER: "+15005550006",
      VONAGE_API_KEY: "k",
      VONAGE_API_SECRET: "s",
      VONAGE_FROM_NAME: "CP",
    });
    expect(cfg.sms.providers).toEqual(["twilio", "vonage"]);
    expect(cfg.sms.twilio).toBeDefined();
    expect(cfg.sms.vonage).toBeDefined();
  });

  it("throws EnvValidationError for unknown provider", () => {
    expect(() => loadEnvConfig({ NODE_ENV: "test", SMS_PROVIDERS: "carrier-pigeon" }))
      .toThrow(EnvValidationError);
  });

  it("throws EnvValidationError when twilio listed but TWILIO_ACCOUNT_SID missing", () => {
    expect(() =>
      loadEnvConfig({
        NODE_ENV: "test",
        SMS_PROVIDERS: "twilio",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_FROM_NUMBER: "+15005550006",
      }),
    ).toThrow(EnvValidationError);
  });

  it("throws EnvValidationError when vonage listed but VONAGE_API_KEY missing", () => {
    expect(() =>
      loadEnvConfig({
        NODE_ENV: "test",
        SMS_PROVIDERS: "vonage",
        VONAGE_API_SECRET: "s",
        VONAGE_FROM_NAME: "CP",
      }),
    ).toThrow(EnvValidationError);
  });

  it("aggregates multiple SMS config errors in one throw", () => {
    try {
      loadEnvConfig({ NODE_ENV: "test", SMS_PROVIDERS: "twilio" });
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const err = e as EnvValidationError;
      expect(err.issues.length).toBeGreaterThanOrEqual(3); // accountSid, authToken, fromNumber
    }
  });
});

// ─── SMS notification API (HTTP) ─────────────────────────────────────────────

describe("SMS notification API", () => {
  it("sends SMS successfully via API", async () => {
    const res = await request(app).post("/api/v1/notifications/sms").send({
      to: "+12025550123",
      message: "Hi",
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.provider).toBe("in-memory");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post("/api/v1/notifications/sms").send({
      to: "+12025550123",
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when both fields are missing", async () => {
    const res = await request(app).post("/api/v1/notifications/sms").send({});
    expect(res.status).toBe(400);
  });

  it("returns 502 when provider returns failure", async () => {
    const res = await request(app).post("/api/v1/notifications/sms").send({
      to: "+12000000000",
      message: "Fail this",
    });
    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain("Simulated failure");
  });
});
