import { loadEnvConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { logInfo } from "./utils/logger.js";

const config = loadEnvConfig();
const app = createApp();

export function startServer(appInstance: any = app, configOverride: any = config) {
  const finalConfig = configOverride || config;
  const finalApp = appInstance || app;
  
  return finalApp.listen(finalConfig.port, () => {
    console.log(`ChronoPay API listening on http://localhost:${finalConfig.port}`);
    logInfo(`ChronoPay API listening on http://localhost:${finalConfig.port}`, {
      port: finalConfig.port,
      environment: finalConfig.nodeEnv,
    });
  });
}

if (config.nodeEnv !== "test") {
  startServer();
}

export function __resetSlotsForTests() {
  // Reset function for tests - implementation depends on your slot storage
  // This is a placeholder that tests can use
}

export default app;
export { createApp };
