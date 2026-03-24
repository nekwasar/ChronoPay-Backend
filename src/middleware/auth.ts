import { Request, Response, NextFunction } from "express";
import { jwtVerify, errors as joseErrors } from "jose";

/**
 * Returns the JWT_SECRET environment variable encoded as a Uint8Array
 * suitable for use with jose's symmetric HMAC algorithms (HS256).
 *
 * @throws {Error} if JWT_SECRET is not set — callers catch this as a 500.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Express middleware that authenticates requests via a JWT Bearer token.
 *
 * Reads the `Authorization: Bearer <token>` header, verifies the token
 * signature and expiry using the HS256 algorithm and the JWT_SECRET env var,
 * then attaches the decoded payload to `req.user` before calling `next()`.
 *
 * Responds with 401 on any authentication failure (missing header, wrong
 * scheme, empty token, invalid signature, expired token) and 500 on
 * unexpected internal errors (e.g. missing JWT_SECRET).
 *
 * All error responses follow the project-wide shape: `{ success: false, error: string }`.
 *
 * Security notes:
 * - Algorithm is restricted to HS256 to prevent algorithm-confusion attacks
 *   (including the "alg: none" bypass).
 * - The full try/catch is required because Express 4 does not automatically
 *   handle rejected async middleware promises.
 *
 * @example
 *   // Apply to a single route
 *   app.get("/api/v1/slots", authenticateToken, handler);
 *
 *   // Apply to a route with additional middleware (auth must come first)
 *   app.post("/api/v1/slots", authenticateToken, validateRequiredFields([...]), handler);
 *
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    // Reject requests with no Authorization header at all
    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: "Authorization header is required",
      });
      return;
    }

    // Reject non-Bearer authorization schemes (e.g. Basic, Token, Digest)
    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        error: "Authorization header must use Bearer scheme",
      });
      return;
    }

    // Strip the "Bearer " prefix (7 characters) to obtain the raw token
    const token = authHeader.slice(7);

    // Reject an Authorization header that is exactly "Bearer " with no token
    if (!token) {
      res.status(401).json({
        success: false,
        error: "Bearer token is missing",
      });
      return;
    }

    // Verify the token: signature, expiry, and algorithm
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"], // restrict to HS256 — prevents algorithm-confusion attacks
    });

    // Attach the decoded payload to the request for downstream handlers
    req.user = payload as Request["user"];
    next();
  } catch (err) {
    // Handle known jose token errors — expose as 401 to avoid leaking internals
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWTInvalid ||
      err instanceof joseErrors.JWSInvalid ||
      err instanceof joseErrors.JWSSignatureVerificationFailed
    ) {
      res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
      return;
    }

    // Unexpected error (most likely JWT_SECRET not set in environment)
    res.status(500).json({
      success: false,
      error: "Authentication middleware error",
    });
  }
}
