import { getRedisClient } from "../redis.js";

const RATE_LIMIT_PREFIX = "chat:rate";

export async function consumeChatRateLimit(params: {
  scope: string;
  userId: number;
  limit: number;
  windowMs?: number;
}) {
  const windowMs = Number(params.windowMs ?? 60_000);
  const limit = Math.max(1, Math.trunc(Number(params.limit || 1)));
  const bucket = Math.floor(Date.now() / windowMs);
  const key = `${RATE_LIMIT_PREFIX}:${params.scope}:${params.userId}:${bucket}`;

  try {
    const redis = getRedisClient();
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pExpire(key, windowMs + 5_000);
    }
    return count <= limit;
  } catch {
    // fail open when Redis is unavailable to avoid blocking chat entirely
    return true;
  }
}
