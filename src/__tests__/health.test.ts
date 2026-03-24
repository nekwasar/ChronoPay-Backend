import request from "supertest";
import app from "../index.js";
import { SignJWT } from "jose";

const TEST_SECRET = "test-secret-for-health-tests";

async function makeToken(): Promise<string> {
  return new SignJWT({ sub: "test-user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe("ChronoPay API", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  it("GET /health returns 200 and status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("chronopay-backend");
  });

  it("GET /api/v1/slots returns slots array when authenticated", async () => {
    const token = await makeToken();
    const res = await request(app)
      .get("/api/v1/slots")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.slots)).toBe(true);
  });
});
