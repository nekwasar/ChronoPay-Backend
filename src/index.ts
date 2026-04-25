import { loadEnvConfig } from "./config/env.js";
import { createApp } from "./app.js";
import { logInfo } from "./utils/logger.js";

const config = loadEnvConfig();
const app = createApp();

if (config.nodeEnv !== "test") {
  app.listen(config.port, () => {
    logInfo(`ChronoPay API listening on http://localhost:${config.port}`, {
      port: config.port,
      environment: config.nodeEnv,
    });
  });
}

export default app;
