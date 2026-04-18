import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import type { StorageAdapter } from "./index"

function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const envId = process.env.S3_ACCESS_KEY_ID
  const envSecret = process.env.S3_SECRET_ACCESS_KEY
  if (envId && envSecret) return { accessKeyId: envId, secretAccessKey: envSecret }
  throw new Error("S3 credentials missing. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.")
}

/**
 * Validates S3_ENDPOINT to prevent SSRF via cloud instance-metadata services.
 * Enforces http/https protocol and blocks known metadata IP/hostnames.
 */
function validateS3Endpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`S3_ENDPOINT is not a valid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`S3_ENDPOINT protocol must be http/https, got ${url.protocol}`)
  }
  // Block AWS / GCP instance metadata services regardless of DNS tricks.
  const host = url.hostname.toLowerCase()
  if (host === "169.254.169.254" || host === "metadata.google.internal" || host === "metadata") {
    throw new Error(`S3_ENDPOINT points at instance metadata (${host}); refusing.`)
  }
  return url.toString().replace(/\/$/, "") // drop trailing slash for consistency
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "feedback-tool-attachments"
    const endpoint = process.env.S3_ENDPOINT
      ? validateS3Endpoint(process.env.S3_ENDPOINT)
      : undefined
    this.client = new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_VIRTUAL_HOSTED !== "true",
      credentials: resolveCredentials(),
    })
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    )
    return { key }
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!res.Body) throw new Error(`S3 get: empty body for ${key}`)
    const bytes = new Uint8Array(await res.Body.transformToByteArray())
    const contentType = res.ContentType ?? "application/octet-stream"
    return { bytes, contentType }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}
