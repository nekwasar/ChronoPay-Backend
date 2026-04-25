# Idempotency

ChronoPay uses opt-in idempotency keys on mutating endpoints to make client
retries safe. Sending the same `Idempotency-Key` header with the same request
payload always returns the original response without re-executing the
operation.

## Header contract

| Header | Required | Format | Example |
|---|---|---|---|
| `Idempotency-Key` | Optional | Any non-empty string (UUID recommended) | `550e8400-e29b-41d4-a716-446655440000` |

Omitting the header disables idempotency for that request — each call is
treated independently.

## Protected endpoints

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/checkout/sessions` | Creates a checkout session |
| `POST` | `/api/v1/slots` | Creates a time slot |

## Behaviour

### Cache miss (first request)

The key is new. The middleware:

1. Atomically acquires a Redis lock (`SET NX`) with a 24-hour TTL.
2. Passes the request to the route handler.
3. Intercepts `res.json()` to persist `{ status, requestHash, statusCode, responseBody }` in Redis before the response is sent.

### Exact duplicate (replay)

The key exists and the request hash matches. The middleware returns the stored
`statusCode` and `responseBody` immediately — the route handler is never
called. No side effects are repeated.

### Payload mismatch

The key exists but the request hash differs. Returns **422 Unprocessable
Entity**:

```json
{
  "success": false,
  "error": "Unprocessable Entity: Idempotency-Key used with different payload."
}
```

### Concurrent / in-flight

The key exists with `status: "processing"` (another request is still running,
or the lock was never released due to a crash). Returns **409 Conflict**:

```json
{
  "success": false,
  "error": "Conflict: This transaction is actively running."
}
```

## Redis storage

```
Key:   idempotency:req:<Idempotency-Key>
TTL:   86400 seconds (24 hours)
Value: {
  "status":       "processing" | "completed",
  "requestHash":  "<sha256 of method+url+body>",
  "statusCode":   201,
  "responseBody": { ... }
}
```

## Request hashing

The hash is `SHA-256(method + originalUrl + JSON.stringify(body))`. It is
stored in Redis alongside the response and never logged. Sensitive fields
(card numbers, tokens) are not extracted or echoed — only the opaque hash is
persisted.

## Validation ordering

Validation middleware runs **before** idempotency middleware. A request that
fails validation (400) never acquires an idempotency slot, so the same key can
be retried with a corrected payload.

```
Request → validateInput → idempotencyMiddleware → routeHandler
              ↓ 400                ↓ 409/422/replay
           (key not consumed)   (key consumed)
```

## TTL and expiry

Keys expire after 24 hours. After expiry the key is treated as fresh — a new
request with the same key creates a new resource. Clients should use a new key
for each logical operation and only reuse a key when retrying the exact same
request.

## Security notes

- **No sensitive data in Redis**: only the SHA-256 hash of the request body is
  stored, not the body itself. Card numbers, tokens, and PII are never written
  to the idempotency store.
- **Key scoping**: keys are not scoped to a user or session by the middleware.
  Callers should include a user-specific prefix (e.g. `userId:uuid`) to prevent
  cross-user key collisions.
- **NX atomicity**: the Redis `SET NX` command ensures only one concurrent
  request can acquire the lock, preventing duplicate side effects under race
  conditions.

## Example

```bash
# First request — creates the session
curl -X POST https://api.chronopay.io/api/v1/checkout/sessions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"payment":{"amount":10000,"currency":"USD","paymentMethod":"credit_card"},"customer":{"customerId":"cust_123","email":"user@example.com"}}'

# Retry (network timeout) — returns the original 201 response, no new session
curl -X POST https://api.chronopay.io/api/v1/checkout/sessions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"payment":{"amount":10000,"currency":"USD","paymentMethod":"credit_card"},"customer":{"customerId":"cust_123","email":"user@example.com"}}'
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

The server starts without Redis, but idempotency-protected endpoints will fail
at runtime if Redis is unavailable.
