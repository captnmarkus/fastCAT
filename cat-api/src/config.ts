import path from "path";

export const CONFIG = {
  PORT: Number(process.env.CAT_PORT || 4000),
  DB_URL:
    process.env.CAT_DB_URL ||
    process.env.TM_DB_URL ||
    process.env.DATABASE_URL ||
    "postgresql://tmlite:tmlitepass@localhost:5432/tmlite",
  JWT_SECRET: process.env.JWT_SECRET || "please-change-me-32bytes-long-secret-for-cat-api",
  SECRETS_KEY:
    process.env.CAT_SECRETS_KEY ||
    process.env.CAT_SECRET_KEY ||
    process.env.SECRETS_KEY ||
    process.env.JWT_SECRET ||
    "fastcat-dev-secrets-key",
  S3_BUCKET: process.env.S3_BUCKET || "fastcat-files",
  S3_REGION: process.env.S3_REGION || "us-east-1",
  S3_ENDPOINT_URL: process.env.S3_ENDPOINT_URL || "",
  S3_PUBLIC_ENDPOINT_URL: process.env.S3_PUBLIC_ENDPOINT_URL || "",
  S3_FORCE_PATH_STYLE: String(process.env.S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || "",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || "",
  UPLOAD_DIR: process.env.CAT_UPLOAD_DIR || "./uploads",
  CONVERSION_TIMEOUT_MS: Number(process.env.CAT_CONVERSION_TIMEOUT_MS || 60000),
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
  // Matches docker-compose volume mapping:
  TM_SAMPLE_DIR: process.env.TM_SAMPLE_DIR || path.resolve("/app/samples"),
  GLOSSARY_DIR: process.env.GLOSSARY_DIR || path.resolve("/app/samples/glossary"),
  LLM_GATEWAY_URL: process.env.LLM_GATEWAY_URL || "http://llm-gateway:5005",
  TM_PROXY_URL: process.env.TM_PROXY_URL || "http://tm-proxy:3001",
  CHAT_AGENT_SYSTEM_PROMPT:
    process.env.CHAT_AGENT_SYSTEM_PROMPT ||
    process.env.APP_AGENT_SYSTEM_PROMPT ||
    "",
  CHAT_RATE_LIMIT_PER_MINUTE: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE || 30),
  CHAT_MAX_HISTORY_MESSAGES: Number(process.env.CHAT_MAX_HISTORY_MESSAGES || 30),
  CHAT_TRANSLATE_MAX_CHARS: Number(process.env.CHAT_TRANSLATE_MAX_CHARS || 1500),
  CHAT_LLM_PROVIDER_ID:
    process.env.CHAT_LLM_PROVIDER_ID && Number.isFinite(Number(process.env.CHAT_LLM_PROVIDER_ID))
      ? Number(process.env.CHAT_LLM_PROVIDER_ID)
      : null,
  APP_AGENT_INTERNAL_SECRET:
    process.env.APP_AGENT_INTERNAL_SECRET ||
    process.env.CHAT_AGENT_INTERNAL_SECRET ||
    process.env.JWT_SECRET ||
    "fastcat-app-agent-internal",
  APP_AGENT_GATEWAY_TIMEOUT_MS: Number(process.env.APP_AGENT_GATEWAY_TIMEOUT_MS || 120000)
};
