import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import fs from "fs";
import { randomUUID } from "crypto";
import { CONFIG } from "./config.js";
import { initDatabase } from "./db.js";
import { initRedis } from "./redis.js";
import { glossariesRoutes } from "./routes/glossaries.js";
import { termbasesRoutes } from "./routes/termbases.js";
import { tmLibraryRoutes } from "./routes/tm-library.js";
import { projectRoutes } from "./routes/projects.js";
import { segmentRoutes, setBroadcaster } from "./routes/segments.js";
import { libraryRoutes } from "./routes/library.js";
import { adminRoutes } from "./routes/admin.js";
import { parsingTemplatesRoutes } from "./routes/parsing-templates.js";
import { filesRoutes } from "./routes/files.js";
import { resourcesRoutes } from "./routes/resources.js";
import { llmResourcesRoutes } from "./routes/llm-resources.js";
import { departmentsRoutes } from "./routes/departments.js";
import { chatRoutes } from "./routes/chat.js";
import { appAgentRoutes } from "./routes/app-agent.js";
import { startPretranslateWorker } from "./lib/pretranslate-worker.js";
import { startProvisionWorker } from "./lib/provision-worker.js";
import { AgentService } from "./lib/agent-service.js";
import { ChatStreamManager } from "./lib/chat-stream-manager.js";

const app = Fastify({
  // Some resource ids (e.g. encoded term ids) exceed find-my-way's default param length (100).
  // Keep the route matcher permissive enough for existing API ids.
  routerOptions: {
    maxParamLength: 512
  },
  logger: {
    level: process.env.LOG_LEVEL || "info"
  },
  genReqId(req) {
    const incoming = req.headers["x-request-id"];
    if (typeof incoming === "string" && incoming.length > 0) return incoming;
    return randomUUID();
  }
});

const chatStreamManager = new ChatStreamManager();
const agentService = new AgentService({
  log: app.log,
  systemPrompt: CONFIG.CHAT_AGENT_SYSTEM_PROMPT
});

// 1. Plugins
await app.register(cors, { origin: true });
await app.register(jwt, { secret: CONFIG.JWT_SECRET });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
await app.register(websocket);

app.addHook("onRequest", (req, reply, done) => {
  reply.header("x-request-id", req.id);
  (req as any).traceId = req.id;
  req.log = req.log.child({ requestId: req.id });
  done();
});

// 2. Directories
if (!fs.existsSync(CONFIG.UPLOAD_DIR)) fs.mkdirSync(CONFIG.UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(CONFIG.TM_SAMPLE_DIR)) fs.mkdirSync(CONFIG.TM_SAMPLE_DIR, { recursive: true });
if (!fs.existsSync(CONFIG.GLOSSARY_DIR)) fs.mkdirSync(CONFIG.GLOSSARY_DIR, { recursive: true });

// 3. Websocket Setup
const sockets = new Set<any>();
app.get("/api/cat/ws", { websocket: true }, (connection) => {
  sockets.add(connection);
  connection.socket.on("close", () => sockets.delete(connection));
});

// Connect broadcaster to segments module
setBroadcaster((event: string, payload: any) => {
  for (const conn of sockets) {
    try { conn.socket.send(JSON.stringify({ event, payload })); } catch (e) {}
  }
});

// 4. Register Routes
app.get("/api/cat/health", async () => ({ ok: true }));
app.register(glossariesRoutes, { prefix: "/api/cat" });
app.register(termbasesRoutes, { prefix: "/api/cat" });
app.register(projectRoutes, { prefix: "/api/cat" });
app.register(segmentRoutes, { prefix: "/api/cat" });
app.register(filesRoutes, { prefix: "/api/cat" });
app.register(libraryRoutes, { prefix: "/api/cat" });
app.register(adminRoutes, { prefix: "/api/cat" });
app.register(departmentsRoutes, { prefix: "/api/cat" });
app.register(tmLibraryRoutes, { prefix: "/api/cat" });
app.register(parsingTemplatesRoutes, { prefix: "/api/cat" });
app.register(resourcesRoutes, { prefix: "/api/cat" });
app.register(llmResourcesRoutes);
app.register(chatRoutes, { prefix: "/api", agentService, streamManager: chatStreamManager });
app.register(appAgentRoutes, { prefix: "/api", agentService });

// 5. Startup
const start = async () => {
  try {
    await initDatabase();
    await agentService.init();
    await initRedis(app.log);
    if (process.env.PRETRANSLATE_WORKER_ENABLED !== "false") {
      startPretranslateWorker(app.log);
    }
    if (process.env.PROVISION_WORKER_ENABLED !== "false") {
      startProvisionWorker(app.log);
    }
    await app.listen({ host: "0.0.0.0", port: CONFIG.PORT });
    app.log.info(`CAT API running on port ${CONFIG.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
