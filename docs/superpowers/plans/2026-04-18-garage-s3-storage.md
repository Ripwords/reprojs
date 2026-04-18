# Storage Adapter Finalization Implementation Plan

> **For agentic workers:** Small scope. Inline execution is appropriate; no need for subagent-per-task ceremony. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finalize the storage-adapter layer with two first-class options (local-disk default, S3-compatible via env) and document both. No bundled S3 service.

**Architecture:** Replace the `S3Adapter` throw-stub with a real `@aws-sdk/client-s3` implementation that works against any S3-compatible endpoint. Keep `local-disk` as the default. Wire env vars + ship deployment docs.

**Tech Stack:** `@aws-sdk/client-s3` v3, Nuxt 4 + Nitro (host runtime).

**Spec:** [docs/superpowers/specs/2026-04-18-garage-s3-storage-design.md](../specs/2026-04-18-garage-s3-storage-design.md)

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `apps/dashboard/package.json` | MODIFY | Add `@aws-sdk/client-s3@^3.700.0` |
| `apps/dashboard/server/lib/storage/s3.ts` | MODIFY | Replace throw-stub with real implementation |
| `.env.example` | MODIFY | Document `STORAGE_DRIVER` + all `S3_*` env vars with per-provider recipes |
| `docs/deployment.md` | CREATE | Deployment guide: local vs S3 decision, setup for each major provider |

Four files. No compose changes, no new services, no new scripts.

---

## Task 1: Add `@aws-sdk/client-s3` dependency

- [ ] **Step 1: Install**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bun add @aws-sdk/client-s3@^3.700.0
```

- [ ] **Step 2: Verify**

```bash
grep "@aws-sdk/client-s3" apps/dashboard/package.json
```

Expected: one line under `"dependencies"`.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/package.json bun.lock
git commit -m "chore(deps): add @aws-sdk/client-s3 for S3 storage adapter"
```

---

## Task 2: Implement S3Adapter

**Files:**
- Modify: `apps/dashboard/server/lib/storage/s3.ts`

- [ ] **Step 1: Replace the file**

Overwrite `apps/dashboard/server/lib/storage/s3.ts` with:

```ts
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

- [ ] **Step 2: Typecheck**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/apps/dashboard
bunx --bun vue-tsc --noEmit --project .nuxt/tsconfig.server.json 2>&1 | grep "storage/s3"
```

Expected: no output (no errors).

- [ ] **Step 3: Lint + format**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run fmt
bunx oxlint apps/dashboard/server/lib/storage/s3.ts
```

0 errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/lib/storage/s3.ts
git commit -m "$(cat <<'EOF'
feat(storage): real S3Adapter using @aws-sdk/client-s3

Replaces the throw-stub with a working adapter that targets any
S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner,
or self-run MinIO / Garage / SeaweedFS). Configured entirely via env:
S3_ENDPOINT (optional for AWS), S3_REGION, S3_BUCKET,
S3_VIRTUAL_HOSTED, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.

Path-style addressing by default (works for non-AWS providers);
operators on AWS can opt into virtual-hosted via S3_VIRTUAL_HOSTED=true.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `.env.example` additions

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the storage block**

Append to `.env.example` (keep existing content intact):

```
# ─────────────────────────────────────────────────────────────────
# Storage — attachments (screenshots, logs)
# ─────────────────────────────────────────────────────────────────
# `local` writes to STORAGE_LOCAL_ROOT (Docker volume or mounted dir).
# `s3` writes to any S3-compatible endpoint (see recipes below).
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./.data/attachments

# --- When STORAGE_DRIVER=s3 ---
# S3_BUCKET=feedback-tool-attachments
# S3_REGION=us-east-1
# S3_ACCESS_KEY_ID=<required>
# S3_SECRET_ACCESS_KEY=<required>
#
# For AWS S3 (virtual-hosted addressing):
#   S3_VIRTUAL_HOSTED=true
#   # S3_ENDPOINT left empty — defaults to AWS
#
# For Cloudflare R2:
#   S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
#   S3_REGION=auto
#
# For Backblaze B2:
#   S3_ENDPOINT=https://s3.<region>.backblazeb2.com
#   S3_REGION=<region>  # e.g. us-west-002
#
# For Hetzner Object Storage:
#   S3_ENDPOINT=https://<region>.your-objectstorage.com
#   S3_REGION=<region>  # e.g. nbg1
#
# For self-run MinIO / Garage / SeaweedFS:
#   S3_ENDPOINT=http://<host>:<port>
#   S3_REGION=<anything>  # most self-hosted stores ignore this
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add .env.example
git commit -m "docs(env): storage env vars with per-provider S3 recipes"
```

---

## Task 4: Deployment guide

**Files:**
- Create: `docs/deployment.md`

- [ ] **Step 1: Write the doc**

Create `docs/deployment.md`:

```markdown
# Deployment Guide

Feedback Tool is built to self-host. This document covers what operators
need to configure.

## Prerequisites

- Docker + docker-compose (for Postgres; the dashboard itself runs on the
  host or in your own container)
- Bun 1.3+ for running the dashboard
- Postgres 17 (provided by `docker-compose.dev.yml`)

## Env vars

See `.env.example` for the full list. Required:

- `BETTER_AUTH_SECRET` — generate with `openssl rand -hex 32`
- `BETTER_AUTH_URL` — base URL of the dashboard (e.g. `https://feedback.example.com`)
- `DATABASE_URL` — standard Postgres URL
- `GITHUB_APP_*` — required only if GitHub integration is used (see
  `docs/superpowers/specs/2026-04-18-github-sync-design.md`)
- `ATTACHMENT_URL_SECRET` — generate with `openssl rand -hex 32`

## Storage — two paths

Attachments (screenshots, logs) are stored via the `StorageAdapter`
interface. Pick ONE at deploy time; don't switch after writes have landed.

### Path A: local filesystem (simple, single-host)

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/data/attachments
```

Mount `/data/attachments` as a Docker volume or bind-mount. Back up with
file-level tooling (rsync, snapshots, etc.). Fine for:

- Single VM / single-host deployments
- Homelabs, small teams
- Expected data size below a few GB

Restore = copy the files back, restart the dashboard.

### Path B: S3-compatible (cloud, multi-host, managed durability)

```env
STORAGE_DRIVER=s3
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# plus S3_ENDPOINT / S3_REGION / S3_VIRTUAL_HOSTED per provider
```

Any S3 API works. Common choices:

| Provider | Pros | Notes |
|---|---|---|
| **Cloudflare R2** | $0 egress, free tier | Set `S3_REGION=auto` |
| **Backblaze B2** | Cheap storage | Region-specific endpoint URL |
| **Hetzner Object Storage** | EU pricing, regional | Region-specific endpoint URL |
| **AWS S3** | Most compatible, paid egress | Set `S3_VIRTUAL_HOSTED=true` |
| **Self-run MinIO / Garage / SeaweedFS** | Full control | Run separately; we don't bundle |

Create the bucket, create an access key with `read/write` on that bucket,
paste into `.env`. No CORS configuration needed — the dashboard is the
only client that reads/writes.

### Not supported in v1

- Automatic failover between local and S3
- Mixed writes (some attachments local, others S3)
- Migration tooling between the two

If you need to migrate, back up old attachments, switch `STORAGE_DRIVER`,
restart, and re-upload historical attachments manually (or write a
one-off script; the `StorageAdapter` interface is small).

## Database

```bash
bun run dev:docker   # starts Postgres
bun run db:migrate   # applies committed migrations
```

For production, substitute your own Postgres (managed RDS / DigitalOcean /
Supabase / etc.) and set `DATABASE_URL` accordingly.

## Running the dashboard

```bash
bun install
bun run build
bun run preview       # or use your own process manager (PM2, systemd, etc.)
```

The dashboard is a Nuxt 4 app — it builds to a Node.js server under
`.output/`. Deploy with any Node-compatible runtime.

## Smoke test checklist

After first deploy:

- [ ] Sign in (admin account)
- [ ] Create a project
- [ ] Install the SDK on a test page; file a report
- [ ] Confirm the report lands in the inbox with the screenshot
- [ ] Open the screenshot — confirms storage is wired correctly
- [ ] (If using GitHub integration) install the App, verify issue creates
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add docs/deployment.md
git commit -m "docs(deployment): storage + database + runtime guide"
```

---

## Task 5: Full gate + tag v0.6.4-storage

- [ ] **Step 1: Lint**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 2: Full test suite (with STORAGE_DRIVER=local default)**

The dev dashboard should already be running. Restore DB schema first (previous teardown wiped it):

```bash
bun run db:migrate
```

Then:

```bash
PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_sync_jobs, github_integrations, report_events, report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE; UPDATE app_settings SET signup_gated = false, allowed_email_domains = '{}'::text[] WHERE id = 1"
cd apps/dashboard
bun test 2>&1 | tail -5
```

Expected: 120/120 pass (or current baseline) — all tests run with local-disk.

- [ ] **Step 3: Tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git tag -a v0.6.4-storage -m "$(cat <<'EOF'
v0.6.4 — storage adapter finalization

Replaces the S3Adapter throw-stub with a real @aws-sdk/client-s3
implementation that targets any S3-compatible endpoint. Keeps
local-disk as the default for zero-config dev and simple single-host
prod. Deployment guide documents both paths with per-provider recipes.

Sub-project I was originally scoped as "Garage in docker-compose" —
pivoted after hitting operational complexity that didn't serve users.
Self-hosters now BYO-S3 (same model as Gitea, Mattermost, Plausible).

- apps/dashboard/server/lib/storage/s3.ts: real adapter
- .env.example: storage vars documented with R2/B2/Hetzner/AWS recipes
- docs/deployment.md: storage decision tree + smoke checklist
- @aws-sdk/client-s3@^3.700.0: added
EOF
)"
```

---

## Self-review

### Spec coverage

| Spec section | Task(s) |
|---|---|
| §Goal (two paths, no fallback) | Covered by the composition — local stays default, S3 is opt-in |
| §Architecture Summary | Tasks 1, 2 |
| §S3Adapter full implementation | Task 2 |
| §Storage factory — no change | Confirmed; no task needed |
| §Env vars table | Task 3 (.env.example) |
| §Package.json | Task 1 |
| §Deployment Guide | Task 4 |
| §Testing — no unit tests, existing integration suite covers | Task 5 (full-suite gate) |
| §Failure modes | S3Adapter throws on missing creds at construction — Task 2 |
| §Out of scope | Respected |

### Placeholder scan

No TBDs. `<required>` and `<region>` markers in `.env.example` are intentional operator-fill fields (not plan gaps).

### Type consistency

- `StorageAdapter` interface methods (`put`, `get`, `delete`) — S3Adapter implements exactly those signatures. Matches `server/lib/storage/index.ts`.
- Env var names (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_VIRTUAL_HOSTED`) — consistent between Task 2 (code), Task 3 (.env.example), Task 4 (deployment docs).
