import type { FeatureFlagDefinition, FeatureFlagName } from "./types.js";

export const FEATURE_FLAGS: Record<FeatureFlagName, FeatureFlagDefinition> = {
  CREATE_SLOT: {
    envVar: "FF_CREATE_SLOT",
    description: "Enable slot creation via POST /api/v1/slots",
    // Default true preserves current API behavior unless explicitly disabled.
    defaultEnabled: true,
  },
  CHECKOUT: {
    envVar: "FF_CHECKOUT",
    description: "Enable checkout endpoints (POST/GET /api/v1/checkout/sessions). Set to false to kill-switch during incidents.",
    // Default true: checkout is enabled unless explicitly disabled.
    defaultEnabled: true,
  },
};
