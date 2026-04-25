import "express";
import type { FeatureFlagAccessor } from "../flags/types.js";

declare module "express-serve-static-core" {
  interface Request {
    /**
     * Decoded JWT payload attached by the authenticateToken middleware.
     * Present only on routes protected by authenticateToken.
     */
    user?: {
      sub?: string;
      email?: string;
      iat?: number;
      exp?: number;
      [key: string]: unknown;
    };
    /** Feature flag accessor attached by featureFlagContextMiddleware. */
    flags: FeatureFlagAccessor;
  }
}
