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

## Feature Flags

ChronoPay backend uses environment-driven feature flags for safe rollout and rapid disable.

### Configuration

- Flag env format: `FF_<FLAG_NAME>`
- Initial flags:
	- `FF_CREATE_SLOT` controls `POST /api/v1/slots`

Supported values (case-insensitive):

- Enabled: `true`, `1`, `on`, `yes`
- Disabled: `false`, `0`, `off`, `no`

If a flag env variable is missing, the service uses the registered default value.

### Runtime behavior

- `POST /api/v1/slots` when `FF_CREATE_SLOT=true`: route behaves normally.
- `POST /api/v1/slots` when `FF_CREATE_SLOT=false`: returns `503` and:

```json
{
	"success": false,
	"code": "FEATURE_DISABLED",
	"error": "Feature CREATE_SLOT is currently disabled"
}
```

- `GET /health` and `GET /api/v1/slots` are unaffected by this flag.

### Failure-mode handling

- Missing flag env var: falls back to default.
- Malformed flag value: service fails at startup with explicit configuration error.
- Unknown flag lookup in code path: treated as server misconfiguration and rejected.

### Quick local examples

```bash
# Enable slot creation
FF_CREATE_SLOT=true npm run dev

# Disable slot creation (POST returns 503)
FF_CREATE_SLOT=false npm run dev
```

### Acceptance criteria

- Feature flags are validated at startup with strict allowed values.
- Guarded endpoint responds with deterministic `503` payload when disabled.
- Unguarded endpoints keep current behavior.
- Automated tests cover enabled, disabled, and malformed-config paths.

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
