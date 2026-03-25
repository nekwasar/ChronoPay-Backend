# chronopay-backend

API backend for **ChronoPay** — time tokenization and scheduling marketplace on Stellar.

## What's in this repo

- **Express** API with TypeScript
- Health and stub API routes (e.g. `/api/v1/slots`)
- Ready for Stellar Horizon integration, token service, and scheduling logic

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
# Clone the repo (or use your fork)
git clone <repo-url>
cd chronopay-backend

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start dev server (with hot reload)
npm run dev

# Start production server
npm run start
```

## Scripts

| Script   | Description                    |
|----------|--------------------------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run production server         |
| `npm run dev`   | Run dev server with tsx watch  |
| `npm test`      | Run Jest tests                 |

## API (stub)

- `GET /health` — Health check; returns `{ status: "ok", service: "chronopay-backend" }`
- `GET /api/v1/slots` — List time slots (currently returns empty array)
- `POST /api/v1/notifications/sms` — Send an SMS using abstraction (required body fields: `to`, `message`)

## SMS Notification Abstraction (BE-031)

This repo now has a production-style SMS abstraction under `src/services/smsNotification.ts`:

- `SmsProvider`: provider interface (method `sendSms(to, message)`)
- `SmsNotificationService`: validation, rate-limit-safe message length, E.164 checks, provider error translation
- `InMemorySmsProvider`: test stub and local fallback implementation with deterministic failure support

Failure modes handled:

- missing/invalid payload (400 via validation middleware)
- malformed phone (400 via service validation)
- message too long (400 via service validation)
- provider rejection (502 with error message)
- provider exceptions (502 with exception detail)

## Contributing

1. Fork the repo and create a branch from `main`.
2. Install deps and run tests: `npm install && npm test`.
3. Make changes; keep the build passing: `npm run build`.
4. Open a pull request. CI must pass (install, build, test).

## CI/CD

On every push and pull request to `main`, GitHub Actions runs:

- **Install**: `npm ci`
- **Build**: `npm run build`
- **Tests**: `npm test`

## License

MIT
