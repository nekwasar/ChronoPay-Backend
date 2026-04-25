# Reminder Delivery

## Overview

ChronoPay schedules slot reminders and delivers them via a polling worker. Deduplication prevents duplicate deliveries when workers retry or run concurrently.

## Architecture

```
reminderScheduler  (setInterval every 5 s)
  └── processReminders()
        ├── ReminderStore.getDueReminders()
        ├── claimDelivery(id, triggerAt)   ← Redis SET NX EX
        │     true  → deliver, mark sent
        │     false → skip (already claimed)
        └── reminderMetrics.increment(delivered | skipped | failed)
```

## Deduplication

### Key format

```
reminder:dedup:<reminderId>:<triggerAt>
```

- Contains no PII — only opaque numeric identifiers
- TTL: 25 hours (covers any realistic retry window)

### Claim protocol

`claimDelivery(reminderId, triggerAt)` issues a Redis `SET key "1" EX 90000 NX`:

- Returns `true` → this worker owns the delivery; proceed
- Returns `false` → another worker already claimed it; skip

The `NX` flag makes the claim atomic — no race condition between concurrent workers.

### Worker crash / retry safety

If a worker crashes after claiming but before marking the reminder `sent`, the Redis key persists and blocks re-delivery for the TTL window. The reminder remains `pending` in the store and will be retried on the next poll cycle — but `claimDelivery` will return `false`, so it is skipped until the TTL expires.

For production use, consider a two-phase approach: claim → deliver → release-or-extend, with a shorter TTL and explicit release on failure.

## Metrics

`reminderMetrics` (in-memory, per-process) exposes:

| Counter | Meaning |
|---|---|
| `delivered` | Reminder sent successfully |
| `skipped` | Duplicate — another worker already claimed |
| `failed` | Delivery failed after `MAX_RETRIES` attempts |

```ts
import { reminderMetrics } from "./scheduler/reminderMetrics.js";

const { delivered, skipped, failed } = reminderMetrics.snapshot();
```

## Configuration

| Constant | Value | Description |
|---|---|---|
| `MAX_RETRIES` | 3 | Max delivery attempts before marking failed |
| `DEDUP_TTL_SECONDS` | 90000 (25 h) | Redis key TTL |
| Scheduler interval | 5000 ms | How often the worker polls |

## Security

- Dedup keys contain only `reminderId` (integer) and `triggerAt` (Unix ms timestamp) — no user IDs, phone numbers, or other PII
- Redis keys expire automatically; no manual cleanup required
- The in-memory test double (`NODE_ENV=test`) mirrors the NX semantics exactly, so tests are deterministic without a real Redis instance

## Testing

```bash
npm test -- --testPathPattern="reminder.test"
```

Covered scenarios:

- `dedupKey` format and uniqueness
- `claimDelivery` atomic claim / duplicate block
- Normal delivery (status → sent, metric incremented)
- Duplicate skip (pre-claimed key)
- Concurrent workers (Promise.all) — exactly one delivery
- Worker crash / sequential retry
- Retry storm (N=5 concurrent workers → 1 delivered, N-1 skipped)
- Metrics: increment, snapshot immutability, reset
