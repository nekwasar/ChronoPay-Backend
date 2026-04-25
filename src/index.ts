import "dotenv/config";
import { loadEnvConfig, type EnvConfig } from "./config/env.js";
export { createApp } from "./app.js";
import { createApp } from "./app.js";

interface AppListener {
  listen(port: number, callback?: () => void): unknown;
}

export function startServer(app: AppListener, config: EnvConfig): void {
  app.listen(config.port, () => {
    console.log(`ChronoPay API listening on http://localhost:${config.port}`);
  });
}

// No-op: in-memory slot state lives in app.ts; exposed for test compatibility.
export function __resetSlotsForTests(): void {}

const config = loadEnvConfig();
const app = createApp();

if (config.nodeEnv !== "test") {
  startServer(app, config);
}

export default app;
