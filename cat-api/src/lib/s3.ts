import { CONFIG } from "../config.js";
import crypto from "crypto";
import { Readable } from "stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type S3Mode = "internal" | "public";

type S3Location = {
  bucket: string;
  key: string;
};

let internalClient: S3Client | null = null;
let publicClient: S3Client | null = null;

function resolveEndpointUrl(mode: S3Mode): string | undefined {
  const candidate =
    mode === "public"
      ? CONFIG.S3_PUBLIC_ENDPOINT_URL || CONFIG.S3_ENDPOINT_URL
      : CONFIG.S3_ENDPOINT_URL;
  const trimmed = String(candidate || "").trim();
  return trimmed ? trimmed : undefined;
}

function resolveCredentials() {
  const accessKeyId = String(CONFIG.S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(CONFIG.S3_SECRET_ACCESS_KEY || "").trim();
  if (!accessKeyId || !secretAccessKey) return undefined;
  return { accessKeyId, secretAccessKey };
}

function createClient(mode: S3Mode) {
  const endpoint = resolveEndpointUrl(mode);
  const hasCustomEndpoint = Boolean(endpoint);
  const region = String(CONFIG.S3_REGION || "us-east-1");
  const credentials = resolveCredentials();

  return new S3Client({
    region,
    endpoint: endpoint,
    forcePathStyle: CONFIG.S3_FORCE_PATH_STYLE || hasCustomEndpoint,
    ...(credentials ? { credentials } : {})
  });
}

export function getS3Client(mode: S3Mode = "internal") {
  if (mode === "public") {
    if (!publicClient) publicClient = createClient("public");
    return publicClient;
  }
  if (!internalClient) internalClient = createClient("internal");
  return internalClient;
}

export function getS3Bucket(): string {
  return String(CONFIG.S3_BUCKET || "").trim() || "fastcat-files";
}

export function s3Location(key: string): S3Location {
  return { bucket: getS3Bucket(), key };
}

function safeDispositionFilename(filename: string) {
  return String(filename || "file")
    .replace(/[/\\\r\n"]/g, "_")
    .slice(0, 180);
}

export async function presignPutObject(params: {
  key: string;
  contentType?: string | null;
  expiresInSeconds?: number;
}): Promise<{ url: string; headers: Record<string, string> }> {
  const bucket = getS3Bucket();
  const expiresIn = Math.max(60, Math.min(Number(params.expiresInSeconds ?? 900), 7 * 24 * 3600));
  const contentType = params.contentType ? String(params.contentType) : undefined;

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ...(contentType ? { ContentType: contentType } : {})
  });

  const url = await getSignedUrl(getS3Client("public"), cmd, { expiresIn });
  const headers: Record<string, string> = {};
  if (contentType) headers["content-type"] = contentType;
  return { url, headers };
}

export async function presignGetObject(params: {
  key: string;
  downloadFilename?: string | null;
  contentType?: string | null;
  expiresInSeconds?: number;
}): Promise<{ url: string }> {
  const bucket = getS3Bucket();
  const expiresIn = Math.max(60, Math.min(Number(params.expiresInSeconds ?? 900), 7 * 24 * 3600));
  const filename = params.downloadFilename ? safeDispositionFilename(params.downloadFilename) : null;
  const contentType = params.contentType ? String(params.contentType) : undefined;

  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: params.key,
    ...(filename ? { ResponseContentDisposition: `attachment; filename="${filename}"` } : {}),
    ...(contentType ? { ResponseContentType: contentType } : {})
  });

  const url = await getSignedUrl(getS3Client("public"), cmd, { expiresIn });
  return { url };
}

export async function headObject(params: { key: string }) {
  const bucket = getS3Bucket();
  const res = await getS3Client("internal").send(new HeadObjectCommand({ Bucket: bucket, Key: params.key }));
  const size = res.ContentLength != null ? Number(res.ContentLength) : null;
  const etag = res.ETag ? String(res.ETag) : null;
  const contentType = res.ContentType ? String(res.ContentType) : null;
  return { size, etag, contentType };
}

export async function getObjectBuffer(params: { key: string }): Promise<{ buf: Buffer; etag: string | null; contentType: string | null }> {
  const bucket = getS3Bucket();
  const res = await getS3Client("internal").send(new GetObjectCommand({ Bucket: bucket, Key: params.key }));
  const body = res.Body as any;
  if (!body) throw new Error("S3 object body missing");
  const buf = await streamToBuffer(body);
  return {
    buf,
    etag: res.ETag ? String(res.ETag) : null,
    contentType: res.ContentType ? String(res.ContentType) : null
  };
}

export async function putObjectBuffer(params: {
  key: string;
  buf: Buffer;
  contentType?: string | null;
}): Promise<{ etag: string | null }> {
  const bucket = getS3Bucket();
  const contentType = params.contentType ? String(params.contentType) : undefined;
  const res = await getS3Client("internal").send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.buf,
      ...(contentType ? { ContentType: contentType } : {})
    })
  );
  return { etag: res.ETag ? String(res.ETag) : null };
}

export async function copyObject(params: { sourceKey: string; destinationKey: string }): Promise<{ etag: string | null }> {
  const bucket = getS3Bucket();
  const res = await getS3Client("internal").send(
    new CopyObjectCommand({
      Bucket: bucket,
      Key: params.destinationKey,
      CopySource: `${bucket}/${params.sourceKey}`
    })
  );
  return { etag: res.CopyObjectResult?.ETag ? String(res.CopyObjectResult.ETag) : null };
}

export async function deleteObject(params: { key: string }) {
  const bucket = getS3Bucket();
  await getS3Client("internal").send(new DeleteObjectCommand({ Bucket: bucket, Key: params.key }));
}

export async function sha256Hex(buf: Buffer): Promise<string> {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;

  if (body && typeof (body as any).transformToByteArray === "function") {
    const arr = await (body as any).transformToByteArray();
    return Buffer.from(arr);
  }

  if (body && typeof (body as any).arrayBuffer === "function") {
    const arr = await (body as any).arrayBuffer();
    return Buffer.from(arr);
  }

  const readable = toNodeReadable(body);
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as any).pipe === "function") return body as any;
  throw new Error("Unsupported S3 body type");
}
