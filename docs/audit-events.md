# Audit Events — Auth & Authorization Failures

ChronoPay emits structured audit log entries whenever authentication or
authorization fails. Events are written to `logs/audit.log` in JSONL format
via `AuditLogger` and never block the request path.

## Event schema

```jsonc
{
  "timestamp": "2026-04-25T03:00:00.000Z", // ISO-8601, UTC
  "action":    "AUTH_MISSING",              // stable code (see table below)
  "actorIp":   "203.0.113.42",             // client IP from req.ip
  "resource":  "/api/v1/slots",            // req.originalUrl
  "status":    401,                        // HTTP status code
  "metadata": {
    "method":  "GET"                       // HTTP method
    // role is included only when a valid enum value is available (see table)
  }
}
```

## Stable action codes

| Code | HTTP | Middleware | Trigger |
|---|---|---|---|
| `AUTH_MISSING` | 401 | `requireAuthenticatedActor` | `x-chronopay-user-id` header absent or blank |
| `AUTH_FORBIDDEN` | 403 | `requireAuthenticatedActor` | Resolved role not in `allowedRoles` |
| `RBAC_MISSING` | 401 | `requireRole` | `x-user-role` header absent or blank |
| `RBAC_INVALID_ROLE` | 400 | `requireRole` | Header value is not a known role enum |
| `RBAC_FORBIDDEN` | 403 | `requireRole` | Role is valid but not in `allowedRoles` |

## Redaction rules

The following are **never** written to the audit log:

- Raw header values (e.g. the literal string sent in `x-chronopay-user-id`)
- Bearer tokens or API keys
- `userId` on 401 paths (the actor is unauthenticated — no identity to log)

The `role` field in `metadata` is only present when it is a controlled enum
value (`customer`, `admin`, `professional`) resolved by the middleware — never
the raw header string.

## No-double-logging guarantee

Each middleware emits at most one audit event per request. Success paths emit
no events. The `auditMiddleware(action)` wrapper (used on route handlers) is
separate and does not overlap with these failure-path events.

## Example entries

**Missing identity header (401):**
```json
{"timestamp":"2026-04-25T03:00:00.000Z","action":"AUTH_MISSING","actorIp":"203.0.113.42","resource":"/api/v1/slots","status":401,"metadata":{"method":"GET"}}
```

**Insufficient role (403):**
```json
{"timestamp":"2026-04-25T03:00:00.000Z","action":"AUTH_FORBIDDEN","actorIp":"203.0.113.42","resource":"/api/v1/admin","status":403,"metadata":{"method":"POST","role":"customer"}}
```

**Invalid role value (400):**
```json
{"timestamp":"2026-04-25T03:00:00.000Z","action":"RBAC_INVALID_ROLE","actorIp":"203.0.113.42","resource":"/api/v1/slots","status":400,"metadata":{"method":"DELETE","role":"superuser"}}
```

## Security notes

- Events are fire-and-forget (`log()` never throws). A write failure is logged
  to `console.error` and does not affect the HTTP response.
- Log files should be treated as sensitive and access-controlled at the OS
  level. Rotate and ship to a SIEM rather than retaining indefinitely on disk.
- `actorIp` reflects `req.ip`. Set `TRUST_PROXY=true` only when running behind
  a trusted reverse proxy to avoid IP spoofing via `X-Forwarded-For`.
