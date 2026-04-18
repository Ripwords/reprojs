# Garage S3 Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local-disk attachment storage with a Garage S3-compatible service shipped in docker-compose, so users don't manage their own S3.

**Architecture:** Add `garage` + one-shot `garage-init` services to docker-compose. Init sidecar bootstraps the single-node cluster, creates a bucket, mints an S3 access key, and writes creds to a gitignored bind-mounted directory (`apps/dashboard/.garage-creds/`). Rewrite the existing `S3Adapter` stub using `@aws-sdk/client-s3` with `forcePathStyle: true`. Flip `STORAGE_DRIVER` default from `local` to `s3`; local-disk remains available as an opt-in escape hatch. Ship a parallel `docker-compose.prod.yml` for production.

**Tech Stack:** Docker Compose v2, Garage v1.0.1 (`dxflrs/garage`), `@aws-sdk/client-s3` v3, Nuxt 4 + Nitro (host runtime), Bun test for integration.

**Spec:** [docs/superpowers/specs/2026-04-18-garage-s3-storage-design.md](../specs/2026-04-18-garage-s3-storage-design.md)

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `apps/dashboard/docker/docker-compose.dev.yml` | MODIFY | Add `garage` + `garage-init` services + volumes |
| `apps/dashboard/docker/docker-compose.prod.yml` | CREATE | Prod variant (persistent volumes, pinned tags, admin port unpublished) |
| `apps/dashboard/docker/garage.toml` | CREATE | Committed dev-only Garage config (known dev secrets + warning) |
| `apps/dashboard/docker/garage.prod.toml.example` | CREATE | Prod config template with `<SET_ME>` placeholders + rotation guidance |
| `apps/dashboard/docker/garage-init.sh` | CREATE | Idempotent bootstrap script (cluster layout, bucket create, key mint, creds write) |
| `.gitignore` | MODIFY | Ignore `apps/dashboard/.garage-creds/` + `docker/garage.prod.toml` |
| `apps/dashboard/server/lib/storage/s3.ts` | MODIFY | Replace throw-stub with real `@aws-sdk/client-s3` implementation |
| `apps/dashboard/server/lib/storage/index.ts` | MODIFY | Default `STORAGE_DRIVER` from `"local"` → `"s3"` |
| `apps/dashboard/server/lib/storage/s3.test.ts` | CREATE | Integration test against live local Garage (put/get/delete roundtrip) |
| `apps/dashboard/package.json` | MODIFY | Add `@aws-sdk/client-s3@^3.700.0` to dependencies |
| `package.json` (root) | MODIFY | Add `dev:docker:prod`, `dev:docker:logs`, `dev:docker:reset` scripts |
| `.env.example` | MODIFY | Document `STORAGE_DRIVER`, `S3_ENDPOINT`, etc. |

No changes to: intake handlers, attachment serve route, signed-attachment-url, reports schema.

---

## Task 1: Docker dev infrastructure (compose + garage config + init script)

**Files:**
- Modify: `apps/dashboard/docker/docker-compose.dev.yml`
- Create: `apps/dashboard/docker/garage.toml`
- Create: `apps/dashboard/docker/garage-init.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Write `garage.toml` (dev-only committed config)**

Create `apps/dashboard/docker/garage.toml`:

```toml
# DEV-ONLY CONFIG. DO NOT REUSE SECRETS IN PRODUCTION.
# For prod, copy garage.prod.toml.example → garage.prod.toml, fill in
# real rpc_secret + admin_token, and mount via docker-compose.prod.yml.

metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
replication_mode = "none"

rpc_secret = "a7c9e3f1b2d4e6a8c0e2f4a6b8d0e2f4a6c8e0b2d4f6a8c0e2f4b6d8a0c2e4f6"
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "feedback-tool-dev-admin-token"
metrics_token = "feedback-tool-dev-metrics-token"
```

- [ ] **Step 2: Write `garage-init.sh` (idempotent bootstrap)**

Create `apps/dashboard/docker/garage-init.sh`:

```sh
#!/bin/sh
set -e

# Idempotency guard — if creds file already exists, the cluster is provisioned.
if [ -f /creds/s3-access-key-id ] && [ -f /creds/s3-secret-access-key ]; then
  echo "[garage-init] credentials already exist at /creds — skipping bootstrap"
  exit 0
fi

GARAGE="garage -c /etc/garage.toml"

echo "[garage-init] waiting for garage to respond..."
until $GARAGE status >/dev/null 2>&1; do
  sleep 1
done

echo "[garage-init] assigning single-node layout..."
NODE_ID=$($GARAGE status | awk 'NR==3 {print $1}')
$GARAGE layout assign "$NODE_ID" -z dc1 -c 1G -t node1 || true
$GARAGE layout apply --version 1 || true

echo "[garage-init] creating bucket..."
$GARAGE bucket create feedback-tool-attachments 2>&1 | grep -v "already exists" || true

echo "[garage-init] minting S3 access key..."
KEY_JSON=$($GARAGE key create feedback-tool-dev --output-json 2>/dev/null || echo "")
if [ -z "$KEY_JSON" ]; then
  echo "[garage-init] key create returned empty — the key may already exist."
  echo "[garage-init] if you need fresh credentials, wipe volumes and .garage-creds/ and retry."
  exit 1
fi

# Parse with busybox sed (no jq in alpine garage image).
# Verify against `garage key create --output-json` output format of the pinned
# image. If the field names differ, adjust the regex.
echo "$KEY_JSON" | sed -n 's/.*"keyId":"\([^"]*\)".*/\1/p' > /creds/s3-access-key-id
echo "$KEY_JSON" | sed -n 's/.*"secretAccessKey":"\([^"]*\)".*/\1/p' > /creds/s3-secret-access-key

if [ ! -s /creds/s3-access-key-id ] || [ ! -s /creds/s3-secret-access-key ]; then
  echo "[garage-init] ERROR: failed to extract credentials. Raw output:"
  echo "$KEY_JSON"
  rm -f /creds/s3-access-key-id /creds/s3-secret-access-key
  exit 1
fi

echo "[garage-init] granting bucket access..."
$GARAGE bucket allow feedback-tool-attachments \
  --key feedback-tool-dev --read --write

echo "[garage-init] done. creds written to /creds/"
```

Then make it executable:

```bash
chmod +x apps/dashboard/docker/garage-init.sh
```

- [ ] **Step 3: Replace `apps/dashboard/docker/docker-compose.dev.yml`**

Overwrite the file with:

```yaml
name: feedback_tool
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: feedback_tool
    ports:
      - "5436:5432"
    volumes:
      - feedback_tool_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  garage:
    image: dxflrs/garage:v1.0.1
    ports:
      - "3900:3900"
      - "3903:3903"
    volumes:
      - garage_meta:/var/lib/garage/meta
      - garage_data:/var/lib/garage/data
      - ./garage.toml:/etc/garage.toml:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3903/health"]
      interval: 5s
      timeout: 3s
      retries: 10

  garage-init:
    image: dxflrs/garage:v1.0.1
    depends_on:
      garage:
        condition: service_healthy
    volumes:
      - ../.garage-creds:/creds
      - ./garage.toml:/etc/garage.toml:ro
      - ./garage-init.sh:/init.sh:ro
    entrypoint: ["/bin/sh", "/init.sh"]
    restart: "no"

volumes:
  feedback_tool_data:
  garage_meta:
  garage_data:
```

- [ ] **Step 4: Update `.gitignore`**

Append to `.gitignore`:

```
apps/dashboard/.garage-creds/
apps/dashboard/docker/garage.prod.toml
```

- [ ] **Step 5: Smoke-test the bootstrap**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
# Nuke any prior state
docker compose -f apps/dashboard/docker/docker-compose.dev.yml down -v 2>/dev/null
rm -rf apps/dashboard/.garage-creds
# Bring up
bun run dev:docker
# Wait for init to finish, then check
sleep 15
docker compose -f apps/dashboard/docker/docker-compose.dev.yml logs garage-init | tail -20
```

Expected: logs show `[garage-init] done. creds written to /creds/`.

```bash
ls -la apps/dashboard/.garage-creds/
```

Expected: two files, `s3-access-key-id` and `s3-secret-access-key`, each one line, non-empty.

```bash
cat apps/dashboard/.garage-creds/s3-access-key-id | head -c 8
```

Expected: starts with `GK` (Garage S3 key prefix).

If any check fails, debug by inspecting `docker compose logs garage garage-init` and iterating on `garage-init.sh`.

- [ ] **Step 6: Restart Postgres after Garage bring-up (drizzle journal already applied)**

`bun run dev:docker` already ran `postgres` — nothing else needed, but verify it's still healthy:

```bash
docker compose -f apps/dashboard/docker/docker-compose.dev.yml ps
```

Expected: `postgres` and `garage` both healthy; `garage-init` `Exited (0)`.

- [ ] **Step 7: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/docker/docker-compose.dev.yml apps/dashboard/docker/garage.toml apps/dashboard/docker/garage-init.sh .gitignore
git commit -m "$(cat <<'EOF'
feat(docker): Garage S3 service + init sidecar in dev compose

Adds garage (dxflrs/garage:v1.0.1, single-node no-replication) and a
garage-init one-shot that bootstraps the cluster layout, creates the
feedback-tool-attachments bucket, mints an S3 key, and writes creds to
the host at apps/dashboard/.garage-creds/ (gitignored, bind-mounted
via ../.garage-creds:/creds).

The init script is idempotent — skips if creds file exists. Dev-only
secrets in garage.toml (rpc_secret, admin_token) are committed with a
warning banner. Prod uses a separate gitignored config.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Docker prod compose + config template

**Files:**
- Create: `apps/dashboard/docker/docker-compose.prod.yml`
- Create: `apps/dashboard/docker/garage.prod.toml.example`

- [ ] **Step 1: Write `garage.prod.toml.example`**

Create `apps/dashboard/docker/garage.prod.toml.example`:

```toml
# Production Garage config template.
#
# Usage:
#   1. Copy to `garage.prod.toml` (gitignored).
#   2. Generate strong secrets:
#      openssl rand -hex 32                # for rpc_secret
#      openssl rand -base64 32             # for admin_token + metrics_token
#   3. Mount via docker-compose.prod.yml.
#
# Rotation: changing rpc_secret requires restarting all Garage nodes in
# lockstep. admin_token can be rotated independently — update this file
# and restart just the garage service.

metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
replication_mode = "none"

rpc_secret = "<SET_ME_openssl_rand_hex_32>"
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
admin_token = "<SET_ME_openssl_rand_base64_32>"
metrics_token = "<SET_ME_openssl_rand_base64_32>"
```

- [ ] **Step 2: Write `docker-compose.prod.yml`**

Create `apps/dashboard/docker/docker-compose.prod.yml`:

```yaml
name: feedback_tool_prod
services:
  postgres:
    image: postgres:17.2
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}
      POSTGRES_DB: ${POSTGRES_DB:-feedback_tool}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - feedback_tool_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"]
      interval: 10s
      timeout: 5s
      retries: 10

  garage:
    image: dxflrs/garage:v1.0.1
    restart: unless-stopped
    ports:
      - "127.0.0.1:3900:3900"   # S3 API — bind localhost only; front with reverse proxy
    volumes:
      - garage_meta:/var/lib/garage/meta
      - garage_data:/var/lib/garage/data
      - ./garage.prod.toml:/etc/garage.toml:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3903/health"]
      interval: 10s
      timeout: 5s
      retries: 10

  garage-init:
    image: dxflrs/garage:v1.0.1
    depends_on:
      garage:
        condition: service_healthy
    volumes:
      - ../.garage-creds:/creds
      - ./garage.prod.toml:/etc/garage.toml:ro
      - ./garage-init.sh:/init.sh:ro
    entrypoint: ["/bin/sh", "/init.sh"]
    restart: "no"

volumes:
  feedback_tool_data:
    driver: local
  garage_meta:
    driver: local
  garage_data:
    driver: local
```

Notes on prod diffs vs dev (for the implementer):
- Image tags explicitly pinned (postgres:17.2 not 17; garage:v1.0.1 same as dev)
- Ports bound to `127.0.0.1:` — operators front with a reverse proxy if exposing publicly
- Port 3903 (admin) NOT published in prod
- `restart: unless-stopped` on long-running services
- Secrets sourced from env vars with fail-fast defaults (`${POSTGRES_PASSWORD:?...}`)
- `replication_mode = "none"` stays — clustering is a future sub-project

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/docker/docker-compose.prod.yml apps/dashboard/docker/garage.prod.toml.example
git commit -m "$(cat <<'EOF'
feat(docker): prod compose + Garage config template

Ships a production docker-compose that runs Postgres and Garage with
persistent named volumes, pinned image tags, restart policies, and
the admin port unpublished. Dashboard itself is NOT containerized
(operator runs it separately) — that's a future sub-project.

garage.prod.toml.example is a committed template; operators copy to
garage.prod.toml (gitignored), substitute real secrets generated via
openssl, and mount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Install `@aws-sdk/client-s3` dependency

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `bun.lock` (updated automatically)

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bun add @aws-sdk/client-s3@^3.700.0
```

Expected output: installs with some transitive deps.

- [ ] **Step 2: Verify the install**

```bash
grep "@aws-sdk/client-s3" apps/dashboard/package.json
```

Expected: a line like `"@aws-sdk/client-s3": "^3.700.0"` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/package.json bun.lock
git commit -m "$(cat <<'EOF'
chore(deps): add @aws-sdk/client-s3 for Garage adapter

Server-side dependency only; no impact on the SDK bundle (packages/core,
packages/ui are unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Implement `S3Adapter` (replace the throw-stub)

**Files:**
- Modify: `apps/dashboard/server/lib/storage/s3.ts`

- [ ] **Step 1: Write the new `s3.ts`**

Overwrite `apps/dashboard/server/lib/storage/s3.ts`:

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

const CREDS_DIR = resolve(process.cwd(), ".garage-creds")

function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const envId = process.env.S3_ACCESS_KEY_ID
  const envSecret = process.env.S3_SECRET_ACCESS_KEY
  if (envId && envSecret) return { accessKeyId: envId, secretAccessKey: envSecret }
  const idPath = `${CREDS_DIR}/s3-access-key-id`
  const secretPath = `${CREDS_DIR}/s3-secret-access-key`
  if (existsSync(idPath) && existsSync(secretPath)) {
    return {
      accessKeyId: readFileSync(idPath, "utf8").trim(),
      secretAccessKey: readFileSync(secretPath, "utf8").trim(),
    }
  }
  throw new Error(
    "S3 credentials not found. Run `bun run dev:docker` first, or set " +
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY env vars.",
  )
}

export class S3Adapter implements StorageAdapter {
  private readonly client: S3Client
  private readonly bucket: string

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "feedback-tool-attachments"
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? "http://localhost:3900",
      region: process.env.S3_REGION ?? "garage",
      forcePathStyle: true,
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

- [ ] **Step 2: Typecheck**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bunx --bun vue-tsc --noEmit --project .nuxt/tsconfig.server.json 2>&1 | grep "storage/s3"
```

Expected: no output (no errors on this file).

- [ ] **Step 3: Lint + format**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run fmt
bunx oxlint apps/dashboard/server/lib/storage/s3.ts
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/storage/s3.ts
git commit -m "$(cat <<'EOF'
feat(storage): implement S3Adapter against @aws-sdk/client-s3

Replaces the throw-stub with a real S3 adapter configured for Garage
(or any S3-compatible store):

- forcePathStyle: true (required for non-AWS S3 — Garage, MinIO, etc.)
- Credential resolution: env vars first, then ./garage-creds/ files,
  else a clear error pointing the user at bun run dev:docker.
- Content-Type uses native S3 object metadata (no sidecar file like
  local-disk).
- Endpoint, region, bucket all env-configurable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: S3Adapter integration test

**Files:**
- Create: `apps/dashboard/server/lib/storage/s3.test.ts`

**Pre-req:** Garage must be running (from Task 1 smoke test). Verify with:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3900/
```

Expected: `403` or `400` (Garage responds but needs auth for /). NOT `000` (unreachable).

- [ ] **Step 1: Write `s3.test.ts`**

Create `apps/dashboard/server/lib/storage/s3.test.ts`:

```ts
import { afterAll, describe, expect, test } from "bun:test"
import { S3Adapter } from "./s3"

describe("S3Adapter (against local Garage)", () => {
  const adapter = new S3Adapter()
  const testKey = `test-${crypto.randomUUID()}/sample.bin`
  const bytes = new Uint8Array([0x01, 0x02, 0x03, 0xff])

  afterAll(async () => {
    // Best-effort cleanup
    try {
      await adapter.delete(testKey)
    } catch {
      // ignore — test may have already cleaned up
    }
  })

  test("put → get roundtrip preserves bytes + content type", async () => {
    await adapter.put(testKey, bytes, "application/octet-stream")
    const out = await adapter.get(testKey)
    expect(Array.from(out.bytes)).toEqual([0x01, 0x02, 0x03, 0xff])
    expect(out.contentType).toBe("application/octet-stream")
  })

  test("content-type is preserved across kinds", async () => {
    const k = `test-${crypto.randomUUID()}/screenshot.png`
    await adapter.put(k, bytes, "image/png")
    const out = await adapter.get(k)
    expect(out.contentType).toBe("image/png")
    await adapter.delete(k)
  })

  test("delete removes the object", async () => {
    const k = `test-${crypto.randomUUID()}/tmp.bin`
    await adapter.put(k, bytes, "application/octet-stream")
    await adapter.delete(k)
    await expect(adapter.get(k)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test**

The test needs to run with `cwd=apps/dashboard/` (so `.garage-creds/` resolves correctly). Bun's `setDefaultTimeout` isn't needed — these are quick local calls.

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
SKIP_SERVER_CHECK=1 bun test ./server/lib/storage/s3.test.ts
```

Expected: `3 pass, 0 fail`.

If the test fails with "S3 credentials not found", verify `apps/dashboard/.garage-creds/s3-access-key-id` exists. If it doesn't, re-run Task 1 Step 5.

If the test fails with connection refused on 3900, Garage isn't running — `bun run dev:docker`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/storage/s3.test.ts
git commit -m "$(cat <<'EOF'
test(storage): S3Adapter integration test against local Garage

Three tests: put/get byte roundtrip with content-type preservation,
content-type preservation across different MIME kinds, and delete.
Requires Garage running (same implicit dependency as Postgres for the
existing integration tests). No mocking — real store, real client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Flip default `STORAGE_DRIVER` from `local` → `s3`

**Files:**
- Modify: `apps/dashboard/server/lib/storage/index.ts`

- [ ] **Step 1: Change the default**

In `apps/dashboard/server/lib/storage/index.ts`, find:

```ts
  const driver = process.env.STORAGE_DRIVER ?? "local"
```

Change to:

```ts
  const driver = process.env.STORAGE_DRIVER ?? "s3"
```

The full function block for clarity (replace only the one line):

```ts
export async function getStorage(): Promise<StorageAdapter> {
  if (_adapter) return _adapter
  const driver = process.env.STORAGE_DRIVER ?? "s3"
  if (driver === "s3") {
    const { S3Adapter } = await import("./s3")
    _adapter = new S3Adapter()
    return _adapter
  }
  const { LocalDiskAdapter } = await import("./local-disk")
  const root = process.env.STORAGE_LOCAL_ROOT ?? "./.data/attachments"
  _adapter = new LocalDiskAdapter(root)
  return _adapter
}
```

- [ ] **Step 2: Run existing dashboard intake tests with default driver**

Full suite run with a clean DB:

```bash
PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE; UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1"
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bun test 2>&1 | tail -5
```

Expected: `120 pass, 0 fail` (or whatever the current baseline is). Intake tests that write attachments will now hit Garage. Any S3Adapter bug surfaces here.

If any test fails with "S3 credentials not found" or connection errors, Garage is down or `.garage-creds/` is missing — remediate per Task 1 Step 5.

- [ ] **Step 3: Lint**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run fmt
bunx oxlint apps/dashboard/server/lib/storage/index.ts
```

0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/storage/index.ts
git commit -m "$(cat <<'EOF'
feat(storage): default STORAGE_DRIVER to s3 (was local)

With the Garage service shipped in docker-compose, s3 is now the
first-class path. Local-disk remains reachable via STORAGE_DRIVER=local
for no-docker dev scenarios.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `.env.example` + root package.json scripts

**Files:**
- Modify: `.env.example`
- Modify: `package.json` (root)

- [ ] **Step 1: Append to `.env.example`**

Read the current `.env.example` first, then append:

```
# ─────────────────────────────────────────────────────────────────
# Object storage (S3-compatible).
# Default: s3, pointing at the local Garage container from
# `bun run dev:docker`. Set STORAGE_DRIVER=local to use on-disk
# storage without docker.
# ─────────────────────────────────────────────────────────────────
STORAGE_DRIVER=s3
S3_ENDPOINT=http://localhost:3900
S3_REGION=garage
S3_BUCKET=feedback-tool-attachments
# Credentials are auto-provisioned by the garage-init container and
# written to apps/dashboard/.garage-creds/. Override here only for
# prod or custom setups:
# S3_ACCESS_KEY_ID=<set-me>
# S3_SECRET_ACCESS_KEY=<set-me>
```

- [ ] **Step 2: Add scripts to root `package.json`**

Read the root `package.json`. Find the `"scripts"` block. Add these entries (keep existing scripts intact; add alongside the existing `dev:docker` / `dev:stop`):

```json
    "dev:docker:prod": "docker compose -f apps/dashboard/docker/docker-compose.prod.yml up -d",
    "dev:docker:logs": "docker compose -f apps/dashboard/docker/docker-compose.dev.yml logs -f garage garage-init",
    "dev:docker:reset": "docker compose -f apps/dashboard/docker/docker-compose.dev.yml down -v && rm -rf apps/dashboard/.garage-creds",
```

Place them alphabetically-ish within the scripts block (near the existing `dev:*` entries).

- [ ] **Step 3: Smoke-test the new `reset` script path**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run dev:docker:reset
ls apps/dashboard/.garage-creds 2>&1
```

Expected: `ls: ...: No such file or directory` — confirms the reset wiped the creds directory.

Now bring back up to restore state for later tasks:

```bash
bun run dev:docker
sleep 15
ls apps/dashboard/.garage-creds/
```

Expected: `s3-access-key-id` and `s3-secret-access-key` both present again (re-provisioned from scratch).

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add .env.example package.json
git commit -m "$(cat <<'EOF'
chore(docs): env.example + docker helper scripts

- .env.example documents the four S3_* vars with defaults pointing at
  the local Garage container; credentials-from-file explained.
- New scripts: dev:docker:prod, dev:docker:logs, dev:docker:reset.
  reset is the nuclear option — wipes volumes + .garage-creds/ for a
  clean bootstrap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full gate + tag v0.6.4-garage-storage

**Files:**
- None (verification + tag only)

- [ ] **Step 1: Full lint**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check 2>&1 | tail -3
```

Expected: 0 errors. Warnings are pre-existing.

- [ ] **Step 2: S3Adapter unit test**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
SKIP_SERVER_CHECK=1 bun test ./server/lib/storage/s3.test.ts 2>&1 | tail -5
```

Expected: 3/3 pass.

- [ ] **Step 3: Full dashboard integration suite (with s3 default)**

```bash
PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE; UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1"
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bun test 2>&1 | tail -8
```

Expected: all tests pass (120+ tests). No new failures. Intake + attachment-serve tests now exercise Garage end-to-end.

If any test fails specifically related to storage, debug via:
```bash
docker compose -f apps/dashboard/docker/docker-compose.dev.yml logs garage | tail -40
```

- [ ] **Step 4: Tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.6.4-garage-storage -m "$(cat <<'EOF'
v0.6.4 — Garage S3 storage (sub-project I)

Replaces local-disk attachment storage with a Garage-based S3 store
shipped in docker-compose. Users no longer manage external S3.

- Dev compose adds garage + one-shot garage-init sidecar. Init
  bootstraps the cluster, creates feedback-tool-attachments bucket,
  mints an S3 access key, writes creds to gitignored
  apps/dashboard/.garage-creds/ (bind-mounted).
- Prod compose (docker-compose.prod.yml) mirrors dev with pinned tags,
  persistent volumes, localhost-only port binding, and a gitignored
  garage.prod.toml (template committed).
- S3Adapter reimplemented with @aws-sdk/client-s3 (forcePathStyle,
  region=garage sentinel, native Content-Type metadata — no sidecar).
- Default STORAGE_DRIVER flipped from local to s3. Local-disk remains
  via STORAGE_DRIVER=local for no-docker dev.
- New scripts: dev:docker:prod, dev:docker:logs, dev:docker:reset.

Dashboard is NOT containerized in this iteration — operator runs it
how they like. That Dockerfile is a future sub-project.

Tests: 120 integration + 3 new S3Adapter unit. All green.
EOF
)"
git tag | tail -6
```

Expected: tag list ends with `v0.6.4-garage-storage`.

---

## Self-review

### Spec coverage

| Spec section | Task(s) |
| --- | --- |
| §Goal, §Non-Goals | Plan preamble + Task 8 tag message |
| §Deployment Assumption (dashboard on host) | Implicit throughout; Task 2 prod compose explicitly excludes dashboard |
| §Architecture Summary | Tasks 1–7 |
| §Components — Compose topology (dev) | Task 1 (all) |
| §Components — Prod compose | Task 2 |
| §Components — garage.toml | Task 1 Step 1 |
| §Components — garage.prod.toml.example | Task 2 Step 1 |
| §Components — garage-init.sh with idempotency | Task 1 Step 2 |
| §Components — Runtime adapter (S3Adapter) | Task 4 |
| §Components — Storage factory update | Task 6 |
| §Configuration — env vars | Task 7 Step 1 |
| §Configuration — Filesystem paths | Task 1 Step 4 (.gitignore), Tasks 1/2/4 (files) |
| §Configuration — package.json changes | Tasks 3 + 7 |
| §Data Flow — Write / Read / GitHub | Covered by existing code (intake, attachment-serve, reconcile). No changes required — Task 6 flip makes them use s3 transparently |
| §Testing | Task 5 (new integration test), Tasks 6/8 (full suite regression) |
| §Failure Modes | Covered by Task 1 idempotency script + Task 4 credential resolver error |

All spec items have a mapped task.

### Placeholder scan

No "TBD" / "implement later" / "handle edge cases" — every step has concrete code, concrete commands, or concrete expected output. The `<SET_ME_...>` placeholders in the prod TOML template are INTENTIONAL — they're template placeholders for operator substitution, not plan gaps.

### Type consistency

- `S3Adapter` class signature matches `StorageAdapter` interface (3 methods: put/get/delete). Checked against `apps/dashboard/server/lib/storage/index.ts`.
- Wire key conventions: bucket name `feedback-tool-attachments`, region sentinel `"garage"` — consistent between Task 1 (bucket create), Task 4 (adapter config), Task 5 (tests), Task 7 (env defaults).
- Credential file names `s3-access-key-id` and `s3-secret-access-key` — consistent between Task 1 (write), Task 4 (read), Task 7 (reset path).
- Env var names `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — consistent between Task 4 (adapter), Task 7 (.env.example).
- `STORAGE_DRIVER` default `"s3"` consistent in Task 6 (code) and Task 7 (.env.example).
