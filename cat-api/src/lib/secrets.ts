import crypto from "crypto";
import { CONFIG } from "../config.js";

const KEY = crypto.createHash("sha256").update(String(CONFIG.SECRETS_KEY || "")).digest();

export function encryptJson(value: any): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(value ?? {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `v1:${packed}`;
}

export function decryptJson(value: string | null | undefined): any {
  const raw = String(value || "");
  if (!raw) return null;
  if (!raw.startsWith("v1:")) return null;
  const b64 = raw.slice(3);
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 12 + 16) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

