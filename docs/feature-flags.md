# Feature Flags

Environment-driven feature flags for safe rollout and rapid disable of ChronoPay features.

## Configuration

- Flag env format: `FF_<FLAG_NAME>`
- Flags are validated at startup; malformed values cause a fast-fail before serving requests.

### Supported values (case-insensitive)

| Enabled | Disabled |
|---|---|
| `true`, `1`, `on`, `yes` | `false`, `0`, `off`, `no` |

If a flag env variable is missing, the service uses the registered default value.

## Registered flags

| Flag | Env var | Default | Description |
|---|---|---|---|
| `CREATE_SLOT` | `FF_CREATE_SLOT` | `true` | Enable slot creation via `POST /api/v1/slots` |
| `CHECKOUT` | `FF_CHECKOUT` | `true` | Enable checkout endpoints. Set to `false` to kill-switch during incidents. |

## FF_CHECKOUT kill switch

`FF_CHECKOUT` guards all checkout routes (`POST /api/v1/checkout/sessions`, `GET /api/v1/checkout/sessions/:id`, and all session state transitions).

### Enabled (default)

All checkout routes behave normally.

### Disabled (`FF_CHECKOUT=false`)

All checkout routes immediately return `503` with a deterministic payload:

```json
{
  "success": false,
  "code": "FEATURE_DISABLED",
  "error": "Feature CHECKOUT is currently disabled"
}
```

No session is created, read, or modified. The response is returned before any business logic runs.

### Quick disable during an incident

```bash
# Disable checkout immediately (restart required to pick up env change)
FF_CHECKOUT=false npm run start

# Re-enable
FF_CHECKOUT=true npm run start
```

## Failure-mode handling

| Scenario | Behaviour |
|---|---|
| Missing env var | Falls back to registered default |
| Malformed value (e.g. `enabled`) | Service fails at startup with explicit error |
| Unknown flag lookup in code | Treated as server misconfiguration; throws `Error` |

## Implementation

- Flag registry: `src/flags/registry.ts`
- Flag types: `src/flags/types.ts`
- Flag service (parse, resolve, read): `src/flags/service.ts`
- Middleware: `src/middleware/featureFlags.ts` — `requireFeatureFlag(flag)` and `featureFlagContextMiddleware`

## Test coverage

`src/__tests__/checkout-kill-switch.test.ts` covers enabled/disabled/malformed paths, all truthy/falsy value variants, and the deterministic 503 response shape.

`src/__tests__/feature-flags.service.test.ts` covers the flag service in isolation.
