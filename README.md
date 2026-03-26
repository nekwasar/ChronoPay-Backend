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

## Database

A production-grade PostgreSQL connection pool has been integrated using the `pg` library.

### Environment Variable

Add the following to your `.env` (see `.example.env`):

```
POSTGRESQL_URL=postgres://user:password@localhost:5432/chronopay
```

### Pool Configuration

The pool is configured in `src/db/pool.ts`:

- `max: 20` — maximum concurrent clients
- `idleTimeoutMillis: 30000` — idle client timeout
- `connectionTimeoutMillis: 5000` — connection attempt timeout

### Behaviour

- **Fail fast**: the server exits on startup if `POSTGRESQL_URL` is missing or the database is unreachable.
- **Error handling**: idle client errors are logged via `pool.on("error")` without crashing the process.
- **Graceful shutdown**: the pool is closed cleanly on `SIGINT`/`SIGTERM`.
- **Query wrapper**: use the exported `query(text, params)` helper from `src/db/pool.ts` to run parameterised queries.
- **Tests**: all database logic is unit-tested with a fully mocked `pg` driver — no live database required.

## License

MIT
