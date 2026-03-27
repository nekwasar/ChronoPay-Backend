import type { FeatureFlagAccessor } from "../flags/index.js";

declare global {
  namespace Express {
    interface Request {
      flags: FeatureFlagAccessor;
    }
  }
}

export {};
