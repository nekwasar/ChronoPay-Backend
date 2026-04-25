import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";

export type ChronoPayRole = "customer" | "admin" | "professional";

export interface AuthContext {
  userId: string;
  role: ChronoPayRole;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

/**
 * Require a trusted upstream identity header for protected routes.
 * ChronoPay currently assumes authentication is terminated upstream and the
 * backend receives the authenticated principal through request headers.
 */
export function requireAuthenticatedActor(
  allowedRoles: ChronoPayRole[] = ["customer", "admin"],
) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const rawUserId = req.header("x-chronopay-user-id");
    const rawRole = req.header("x-chronopay-role");

    if (!rawUserId || rawUserId.trim().length === 0) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      });
    }

    const role = parseRole(rawRole);
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        error: "Role is not authorized for this action.",
      });
    }

    req.auth = {
      userId: rawUserId.trim(),
      role,
    };

    next();
  };
}

function parseRole(rawRole: string | undefined): ChronoPayRole {
  if (!rawRole || rawRole.trim().length === 0) {
    return "customer";
  }

  const normalized = rawRole.trim().toLowerCase();
  if (normalized === "customer" || normalized === "admin" || normalized === "professional") {
    return normalized;
  }

  return "professional";
}

/**
 * JWT-based authentication middleware
 * Verifies Bearer tokens using jose library
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        success: false,
        error: "Authorization header is required",
      });
      return;
    }

    if (!authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        success: false,
        error: "Authorization must use Bearer scheme",
      });
      return;
    }

    const token = authHeader.substring(7).trim();

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Bearer token is missing",
      });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({
        success: false,
        error: "Authentication middleware error",
      });
      return;
    }

    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));

    // Attach user info to request
    (req as any).user = payload;

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      error: "Invalid or expired token",
    });
  }
}
