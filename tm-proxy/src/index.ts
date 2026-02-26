import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import { randomUUID } from "crypto";

import { initStore } from "./t5memory.js";
import { registerSetupAuthUserRoutes } from "./routes/setup-auth-users.js";
import { registerTmRoutes } from "./routes/tm-routes.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info"
  },
  genReqId(req) {
    const incoming = req.headers["x-request-id"];
    if (typeof incoming === "string" && incoming.length > 0) return incoming;
    return randomUUID();
  }
});

await app.register(cors, { origin: true });
await app.register(jwt, {
  secret: process.env.JWT_SECRET || "please-change-me-32bytes-long-secret"
});
await app.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.addHook("onRequest", (req, reply, done) => {
  reply.header("x-request-id", req.id);
  req.log = req.log.child({ requestId: req.id });
  done();
});

await initStoreWithRetry();
registerSetupAuthUserRoutes(app);
registerTmRoutes(app);

const port = Number(process.env.PORT || 3001);
app
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    app.log.info(`tm-proxy listening on ${port}`);
  })
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });

async function initStoreWithRetry() {
  const maxAttempts = Number(process.env.TM_DB_INIT_MAX_ATTEMPTS || 25);
  const baseDelay = Number(process.env.TM_DB_INIT_RETRY_DELAY_MS || 1000);
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await initStore();
      app.log.info(`[startup] Connected to TM database on attempt ${attempt}`);
      return;
    } catch (err) {
      if (attempt >= maxAttempts) {
        app.log.error(
          { err },
          `[startup] Failed to initialize TM store after ${attempt} attempts`
        );
        throw err;
      }
      const delay = Math.min(baseDelay * attempt, 10_000);
      app.log.warn(
        { err },
        `[startup] initStore attempt ${attempt} failed; retrying in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
