import request from "supertest";
import express from "express";
import { idempotencyMiddleware } from "../middleware/idempotency.js";

const app = express();
app.use(express.json());

// Mock validation middleware that just checks for required fields
const mockValidation = (req: any, res: any, next: any) => {
  const { professional, startTime, endTime } = req.body;
  if (!professional || !startTime || !endTime) {
    return res.status(400).json({ success: false });
  }
  next();
};

app.post("/api/v1/slots", mockValidation, idempotencyMiddleware, (req, res) => {
  res.status(201).json({
    success: true,
    slot: req.body,
  });
});

app.post("/api/v1/other", mockValidation, idempotencyMiddleware, (req, res) => {
  res.status(201).json({
    success: true,
    other: true,
  });
});

import { setRedisClient } from "../cache/redisClient.js";

/**
 * Integration tests for the Idempotency Middleware.
 *
 * Architecture context:
 *   POST /api/v1/slots applies two middleware in order:
 *     1. validateRequiredFields(["professional", "startTime", "endTime"])
 *     2. idempotencyMiddleware
 *   Then the route handler responds with 201.
 *
 * An in-memory Redis test double is injected via `setRedisClient`.
 *
 * Key behaviours under test:
 *   1. Opt-in: No Idempotency-Key → request proceeds normally every time.
 *   2. Cache miss (first request): Lock acquired → 201 returned.
 *   3. Exact duplicate: Returns the same cached response (status + body).
 *   4. Payload mismatch: Same key, different body → 422.
 *   5. In-flight / race condition: Key is "processing" → 409.
 *   6. Different keys are independent: No cross-contamination.
 *   7. Cross-endpoint mismatch: Same key, different route → 409.
 *   8. Deterministic hashing: Object with keys in different order still matches.
 */

const VALID_SLOT = {
  professional: "dr-alice",
  startTime: "2025-01-01T09:00:00Z",
  endTime: "2025-01-01T10:00:00Z",
};

describe("Idempotency Middleware (integration)", () => {
  const memoryStore = new Map<string, string>();

  beforeAll(() => {
    setRedisClient({
      get: async (key: string) => memoryStore.get(key) || null,
      set: async (key: string, val: string, ex: string, time: number, nx?: string) => {
        if (nx === "NX" && memoryStore.has(key)) return null;
        memoryStore.set(key, val);
        return "OK";
      },
      del: async (key: string) => { memoryStore.delete(key); return 1; },
      quit: async () => "OK",
    });
  });

  afterEach(() => {
    memoryStore.clear();
  });
  // -------------------------------------------------------------------
  // 1. Opt-in: header absent → middleware is bypassed entirely
  // -------------------------------------------------------------------
  describe("when no Idempotency-Key header is supplied", () => {
    it("should process each request independently and always return 201", async () => {
      const first = await request(app)
        .post("/api/v1/slots")
        .send(VALID_SLOT);

      expect(first.status).toBe(201);
      expect(first.body.success).toBe(true);

      // A second identical request with no key must also succeed (no 409/422)
      const second = await request(app)
        .post("/api/v1/slots")
        .send(VALID_SLOT);

      expect(second.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------
  // 2. Cache miss (first request with a fresh key)
  // -------------------------------------------------------------------
  describe("when a fresh Idempotency-Key is provided (cache miss)", () => {
    it("should acquire the lock and return 201 with the slot data", async () => {
      const res = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", "idem-fresh-001")
        .send(VALID_SLOT);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.slot).toMatchObject({
        professional: VALID_SLOT.professional,
        startTime: VALID_SLOT.startTime,
        endTime: VALID_SLOT.endTime,
      });
    });
  });

  // -------------------------------------------------------------------
  // 3. Exact duplicate (happy path replay)
  // -------------------------------------------------------------------
  describe("when the same Idempotency-Key and payload are sent twice", () => {
    it("should replay the exact cached response on the second request", async () => {
      const key = "idem-duplicate-001";

      const first = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      // Status and body must be identical to the first response
      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
    });
  });

  // -------------------------------------------------------------------
  // 4. Payload mismatch → 422
  // -------------------------------------------------------------------
  describe("when the same Idempotency-Key is reused with a different payload", () => {
    it("should return 422 Unprocessable Entity", async () => {
      const key = "idem-mismatch-001";

      // Establish the key with original payload
      const first = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(first.status).toBe(201);

      // Attempt to reuse the same key with a different payload
      const second = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send({
          ...VALID_SLOT,
          professional: "dr-bob", // Different field value!
        });

      expect(second.status).toBe(422);
      expect(second.body.success).toBe(false);
      expect(second.body.error).toMatch(/different payload/i);
    });

    it("should return 422 even if only the body structure changes", async () => {
      const key = "idem-mismatch-002";

      await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      const second = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send({
          ...VALID_SLOT,
          startTime: "2025-06-01T09:00:00Z", // Different time
        });

      expect(second.status).toBe(422);
    });
  });

  // -------------------------------------------------------------------
  // 5. Race condition / in-flight request → 409
  //    We simulate this by:
  //    a) Sending the first request and intentionally NOT completing it
  //       (the in-memory store test double will store status "processing"
  //        if we call set with NX before the route handler calls res.json)
  //    b) The test double's NX semantics: once the "processing" entry is
  //       written, a second concurrent SET NX returns null → 409.
  //
  //    To probe this deterministically without true concurrency we
  //    directly invoke the middleware against a mock res that never
  //    calls json, then fire the real HTTP request.
  // -------------------------------------------------------------------
  describe("when a concurrent in-flight request is detected", () => {
    it("should return 409 Conflict when the key is already locked as 'processing'", async () => {
      const key = "idem-race-001";

      // Inject 'processing' state manually
      memoryStore.set(`idempotency:req:${key}`, JSON.stringify({
        status: "processing",
        requestMethod: "POST",
        requestPath: "/api/v1/slots",
        requestHash: "dummy",
      }));

      const res = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/actively running/i);
    });

    it("should return 409 Conflict when atomic lock fails during Cache Miss", async () => {
      const key = "idem-race-002";
      
      // We trick the mock by putting the key in memoryStore right before `set` is called,
      // but after `get` is called. We can achieve this by overriding the `get` method
      // to populate the store.
      const originalGet = memoryStore.get.bind(memoryStore);
      let getCalled = false;
      
      // Temporary test double injection to intercept
      setRedisClient({
        get: async (k: string) => {
          getCalled = true;
          return null; // Return null so it acts like a Cache Miss
        },
        set: async (k: string, val: string, ex: string, time: number, nx?: string) => {
          if (getCalled) {
            // Simulate that another request snagged the lock!
            return null;
          }
          return "OK";
        },
        del: async (k: string) => 1,
        quit: async () => "OK",
      });

      const res = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/actively running/i);
      
      // Restore the standard test mock
      setRedisClient({
        get: async (k: string) => memoryStore.get(k) || null,
        set: async (k: string, val: string, ex: string, time: number, nx?: string) => {
          if (nx === "NX" && memoryStore.has(k)) return null;
          memoryStore.set(k, val);
          return "OK";
        },
        del: async (k: string) => { memoryStore.delete(k); return 1; },
        quit: async () => "OK",
      });
    });
  });

  // -------------------------------------------------------------------
  // 6. Key isolation: different keys are fully independent
  // -------------------------------------------------------------------
  describe("key isolation", () => {
    it("should treat different Idempotency-Keys as completely independent requests", async () => {
      const payloadA = { ...VALID_SLOT, professional: "dr-alice" };
      const payloadB = { ...VALID_SLOT, professional: "dr-bob" };

      const resA = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", "idem-iso-A")
        .send(payloadA);

      const resB = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", "idem-iso-B")
        .send(payloadB);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      // Bodies are distinct: each key cached its own response
      expect(resA.body.slot.professional).toBe("dr-alice");
      expect(resB.body.slot.professional).toBe("dr-bob");
    });
  });

  // -------------------------------------------------------------------
  // 7. Edge case: validation runs BEFORE idempotency
  //    An invalid body should never consume an idempotency slot.
  // -------------------------------------------------------------------
  describe("interaction with validation middleware", () => {
    it("should return 400 (not store anything in Redis) if required fields are missing", async () => {
      const key = "idem-validation-001";

      // Send invalid payload
      const bad = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send({ professional: "dr-alice" }); // missing startTime + endTime

      expect(bad.status).toBe(400);
      expect(bad.body.success).toBe(false);

      // Now send a valid request with the SAME key.
      // If validation truly short-circuits before idempotency, the key
      // should be unclaimed and the valid request should succeed.
      const good = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(good.status).toBe(201);
      expect(good.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // 8. Cross-endpoint mismatch (Strong Binding)
  // -------------------------------------------------------------------
  describe("when the same Idempotency-Key is used on a different endpoint", () => {
    it("should return 409 Conflict deterministically", async () => {
      const key = "idem-endpoint-mismatch-001";

      const first = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/other")
        .set("Idempotency-Key", key)
        .send(VALID_SLOT);

      expect(second.status).toBe(409);
      expect(second.body.error).toMatch(/different endpoint/i);
    });
  });

  // -------------------------------------------------------------------
  // 9. Stable hashing mechanism
  // -------------------------------------------------------------------
  describe("when the payload keys are reordered (Stable Hash)", () => {
    it("should still recognize it as an exact duplicate even with arrays and nested objects", async () => {
      const key = "idem-stable-hash-001";

      const first = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send({
          professional: "dr-alice",
          tags: ["urgent", "new"],
          nested: { b: 2, a: 1 },
          startTime: "2025-01-01T09:00:00Z",
          endTime: "2025-01-01T10:00:00Z"
        });

      expect(first.status).toBe(201);

      const second = await request(app)
        .post("/api/v1/slots")
        .set("Idempotency-Key", key)
        .send({
          endTime: "2025-01-01T10:00:00Z", // Reordered
          nested: { a: 1, b: 2 }, // Reordered inner keys
          professional: "dr-alice",
          startTime: "2025-01-01T09:00:00Z",
          tags: ["urgent", "new"]
        });

      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
    });
  });
});
