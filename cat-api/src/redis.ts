import { createClient } from "redis";
import { CONFIG } from "./config.js";

type RedisClient = ReturnType<typeof createClient>;

let redisClient: RedisClient | null = null;

export async function initRedis(log?: {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}) {
  if (redisClient) return redisClient;
  const client = createClient({ url: CONFIG.REDIS_URL });
  client.on("error", (err) => {
    log?.warn?.({ err }, "Redis client error");
  });
  await client.connect();
  redisClient = client;
  log?.info?.(`Redis connected (${CONFIG.REDIS_URL})`);
  return client;
}

export function getRedisClient() {
  if (!redisClient) {
    throw new Error("Redis not initialized");
  }
  return redisClient;
}
