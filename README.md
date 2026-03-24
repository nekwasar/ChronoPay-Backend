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

# Configure environment variables
cp .env.example .env
# Edit .env and set JWT_SECRET to a strong random value

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

### Public routes

| Method | Path      | Description                                              |
|--------|-----------|----------------------------------------------------------|
| GET    | `/health` | Health check; returns `{ status: "ok", service: "chronopay-backend" }` |

### Protected routes

These routes require a valid JWT Bearer token in the `Authorization` header.

| Method | Path             | Description                       |
|--------|------------------|-----------------------------------|
| GET    | `/api/v1/slots`  | List time slots (returns `[]`)    |
| POST   | `/api/v1/slots`  | Create a time slot                |

## Authentication

Protected routes validate a JWT Bearer token on every request.

### Request header

```
Authorization: Bearer <your-jwt-token>
```

### Environment variables

| Variable     | Required | Description                                               |
|--------------|----------|-----------------------------------------------------------|
| `JWT_SECRET` | Yes      | Secret key for signing and verifying JWT tokens (HS256).  |
| `PORT`       | No       | HTTP port (default: `3001`).                              |

Copy `.env.example` to `.env` and set `JWT_SECRET` to a cryptographically random value before running the server locally:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Error responses

All authentication failures return `401 Unauthorized` with the shape `{ success: false, error: string }`:

| Condition                              | `error` value                                   |
|----------------------------------------|-------------------------------------------------|
| Missing `Authorization` header         | `"Authorization header is required"`            |
| Header does not use `Bearer` scheme    | `"Authorization header must use Bearer scheme"` |
| Token is invalid or signature mismatch | `"Invalid or expired token"`                    |
| Token has expired                      | `"Invalid or expired token"`                    |

### Generating a token (development)

```js
import { SignJWT } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET);
const token = await new SignJWT({ sub: "user-id" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("24h")
  .sign(secret);

console.log(token);
```

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
