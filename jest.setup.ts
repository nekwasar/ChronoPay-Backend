// Provide safe dummy env vars for all test suites so that
// env.ts does not throw at module-load time in environments where
// a real .env file is not present (e.g. CI).
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = "redis://localhost:6379";
}
if (!process.env.POSTGRESQL_URL) {
  process.env.POSTGRESQL_URL = "postgres://test:test@localhost:5432/testdb";
}
