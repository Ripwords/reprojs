# Storage Adapter Finalization — Design

> **Revision note (2026-04-18):** Originally scoped as "Garage in docker-compose."
> Pivoted after hitting operational complexity (scratch image tooling gaps, cluster
> bootstrap ceremony, credential auto-provisioning). Current scope is simpler:
> finalize the storage-adapter layer with two first-class options — local-disk
> (default) and any S3-compatible endpoint — and stop trying to bundle an S3
> service into docker-compose.

## Goal

Make the storage layer production-ready with two primary options chosen by env:

- `STORAGE_DRIVER=local` — filesystem storage at `STORAGE_LOCAL_ROOT`. Suitable for single-VM self-hosts, homelabs, small teams. Durability handled by volume mount + file-level backups.
- `STORAGE_DRIVER=s3` — any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner Object Storage, self-run MinIO / Garage / SeaweedFS, etc.). Operator brings their own bucket + credentials.

No automatic fallback between the two. Explicit choice at deploy time.

## Non-Goals

- Shipping a bundled S3 service in docker-compose (operators BYO-S3 for prod, same as Gitea, Mattermost, Plausible)
- Automatic failover / dual-write / migration between backends
- Garage-specific tooling, RPC bootstrap, cluster layout orchestration
- Native S3 presigned URLs — keep the existing dashboard-HMAC signed URLs

## Architecture Summary

Three components, no new services:

1. **`S3Adapter` implementation** — replaces the current throw-stub. Uses `@aws-sdk/client-s3` with `forcePathStyle: true` so it works against AWS S3 (virtual-hosted is also supported via `forcePathStyle: false` when `S3_VIRTUAL_HOSTED=true`). Env-var configured: endpoint, region, bucket, access key, secret key.
2. **Storage factory** (`getStorage()`) — keeps `local` as default. Driver selection via `STORAGE_DRIVER`.
3. **Deployment documentation** — `.env.example` covers both paths; a short `docs/deployment.md` spells out the decision (local vs S3) + setup for each.

Dashboard code outside `server/lib/storage/` is unchanged.

## Components

### S3Adapter (`apps/dashboard/server/lib/storage/s3.ts`)

Replaces the throw-stub. Full implementation:

```ts
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
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
  throw new Error(
    "S3 credentials missing. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.",
  )
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "feedback-tool-attachments"
    const endpoint = process.env.S3_ENDPOINT
    this.client = new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_VIRTUAL_HOSTED !== "true",
      credentials: resolveCredentials(),
    })
  }

  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ key: string }> {
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
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    )
    if (!res.Body) throw new Error(`S3 get: empty body for ${key}`)
    const bytes = new Uint8Array(await res.Body.transformToByteArray())
    const contentType = res.ContentType ?? "application/octet-stream"
    return { bytes, contentType }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    )
  }
}
```

Key design choices:

1. **`forcePathStyle: true` by default** — works for AWS S3, R2, B2, MinIO, Garage, SeaweedFS. AWS S3 also accepts virtual-hosted via `S3_VIRTUAL_HOSTED=true` for operators who prefer it.
2. **`endpoint` is optional** — omitted for AWS S3, set to a custom URL for alternatives.
3. **Region defaults to `us-east-1`** — meaningful for AWS (default), ignored by most S3-compatibles.
4. **Credentials strictly from env** — no file-based fallback, no auto-provisioning. Operator's responsibility.
5. **Native Content-Type via S3 object metadata** — no sidecar files.
6. **Content-Type read-back is advisory** — the attachment serve endpoint already allowlists by `kind` (from v0.6.1 security hardening), so a mismatched Content-Type from S3 doesn't reach the browser.

### Storage factory — no change

`getStorage()` keeps `STORAGE_DRIVER` defaulting to `local`. No change to the switch logic.

## Configuration

### Env vars

| Name | Default | Purpose |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_LOCAL_ROOT` | `./.data/attachments` | Path when driver=local |
| `S3_ENDPOINT` | *(empty = AWS S3)* | Set for R2 / B2 / etc. |
| `S3_REGION` | `us-east-1` | Meaningful for AWS; sentinel otherwise |
| `S3_BUCKET` | `feedback-tool-attachments` | Bucket name |
| `S3_VIRTUAL_HOSTED` | `false` (→ path-style) | Set `true` for AWS virtual-hosted |
| `S3_ACCESS_KEY_ID` | required when driver=s3 | — |
| `S3_SECRET_ACCESS_KEY` | required when driver=s3 | — |

### .env.example additions

Document both paths side-by-side with brief guidance on when each applies.

### Package.json

- Add `@aws-sdk/client-s3@^3.700.0` to `apps/dashboard/package.json` dependencies.
- No script changes.

## Data Flow

Unchanged from today — intake writes via `storage.put`, attachment serve reads via `storage.get`. Whether that's a filesystem write or an S3 PUT is transparent to callers.

## Testing

- **Unit tests**: none for S3Adapter in this iteration. The adapter is a thin wrapper around well-tested `@aws-sdk/client-s3`; mocking it via `aws-sdk-client-mock` adds a dep for marginal value.
- **Integration coverage**: the existing dashboard test suite runs with `STORAGE_DRIVER=local` (the default). That exercises the `StorageAdapter` contract end-to-end. Operators flipping to `s3` validate via their own deployment smoke test (documented).
- Future iteration: if we add a test-only compose profile with LocalStack or MinIO, we can add S3 adapter integration tests — out of scope here.

## Deployment Guide

New file `docs/deployment.md` covers:

1. **Prereqs**: Docker, Bun, Postgres 17.
2. **Env vars**: link to `.env.example`; explain required/optional.
3. **Storage choice — decision tree**:
   - Single host, ≤ a few GB attachments? → `STORAGE_DRIVER=local` + volume-mount.
   - Multi-host, cloud deploy, or need managed durability? → `STORAGE_DRIVER=s3`.
4. **Setup for local-disk**: create dir, chmod, volume-mount in your orchestrator.
5. **Setup for each major S3 provider**: quick env var recipes for AWS S3, Cloudflare R2, Backblaze B2, Hetzner Object Storage, self-run MinIO/Garage/SeaweedFS. CORS + bucket policy notes where relevant (none needed — the dashboard is the only client).
6. **Backup guidance**: rsync/snapshot for local; the provider's backup story for S3.

## Failure Modes

| Scenario | Behavior |
|---|---|
| `STORAGE_DRIVER=s3` but no creds | S3Adapter constructor throws with clear error at first intake |
| `STORAGE_DRIVER=s3` but S3 unreachable at runtime | Intake returns 500; attachment GET returns 500. No silent fallback. |
| `STORAGE_DRIVER=local` + disk full | Standard `ENOSPC` error propagates up |
| Operator misspells `STORAGE_DRIVER` | Falls through to `local` (safe default) |

## Out of Scope

- Bundled S3 service in docker-compose
- Garage, MinIO, or RustFS integration
- Automatic backend failover
- Migration tooling between `local` and `s3`
- S3 lifecycle / retention policies
- Dashboard containerization
- CI S3 integration tests

All of these can be added later as separate sub-projects once the core storage story is documented and stable.
