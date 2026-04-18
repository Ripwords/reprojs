# Garage S3-Compatible Storage — Design

## Goal

Replace local-disk attachment storage with a Garage-based S3-compatible object store, shipped as part of `docker-compose` so users don't have to provision external S3 accounts. Usable for both local dev and production.

## Non-Goals / Deferred (future sub-projects)

- Dashboard containerization (separate Dockerfile effort)
- Multi-node Garage cluster / replication
- Native S3 presigned URLs (keep dashboard-proxied HMAC URLs)
- Object lifecycle / retention / TTL policies
- Migration from existing `./.data/attachments` (clean slate — no migration)
- Backup/restore runbooks
- STS / scoped per-project credentials
- Metrics / observability wiring

## Deployment Assumption

The dashboard runs on the HOST (via `bun run dev` locally, or whatever prod runtime the operator chooses — systemd, PM2, a separate Docker image). It connects to Garage at `http://localhost:3900` via the bind-mounted S3 endpoint port. Dashboard-in-compose is out of scope (separate sub-project).

## Architecture Summary

- Two new services in docker-compose: `garage` and `garage-init` (one-shot sidecar)
- `garage` mounts a committed dev-only config file (`garage.toml`) with well-known admin/rpc secrets. Prod operators use a gitignored override (`garage.prod.toml`)
- `garage-init` runs on first boot, bootstraps the single-node cluster, creates the bucket, mints a long-lived S3 access key, writes credentials to a bind-mounted directory `apps/dashboard/.garage-creds/` (gitignored, host-visible)
- Dashboard's existing `StorageAdapter` interface stays — `S3Adapter` is reimplemented to use `@aws-sdk/client-s3` against Garage
- `getStorage()` default changes from `local` to `s3`; local-disk stays as an opt-in escape hatch
- Credential resolution order: env vars → `.garage-creds/` files → clear error
- Prod compose file (`docker-compose.prod.yml`) mirrors dev with persistent volumes, pinned tags, `restart: unless-stopped`, admin port not exposed

## Components

### Compose topology (`apps/dashboard/docker/docker-compose.dev.yml`)

```yaml
name: feedback_tool
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: feedback_tool
    ports: ["5436:5432"]
    volumes: [feedback_tool_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  garage:
    image: dxflrs/garage:v1.0.1
    ports:
      - "3900:3900"  # S3 API
      - "3903:3903"  # admin (dev only — NOT exposed in prod compose)
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
      - ../.garage-creds:/creds        # bind-mount → host apps/dashboard/.garage-creds/
      - ./garage.toml:/etc/garage.toml:ro
      - ./garage-init.sh:/init.sh:ro
    entrypoint: ["/bin/sh", "/init.sh"]
    restart: "no"

volumes:
  feedback_tool_data:
  garage_meta:
  garage_data:
```

### Prod compose (`apps/dashboard/docker/docker-compose.prod.yml`)

Same service shape as dev, with these differences:

- Image tags explicitly pinned (no `latest`)
- `restart: unless-stopped` on `garage` and `postgres`
- Port 3903 (admin) NOT published (only inside the compose network)
- Port 3900 bound to `127.0.0.1:3900` only (not 0.0.0.0) — operator fronts with a reverse proxy if exposing
- Mounts `./garage.prod.toml` (gitignored) instead of the committed dev file
- Named volumes explicitly configured for production persistence

Dashboard service is NOT included — operator runs it how they prefer.

### Garage config file (`apps/dashboard/docker/garage.toml`)

Committed with dev-only values and a warning banner. Single-node, no replication:

```toml
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

A parallel `garage.prod.toml.example` ships with the same shape and `<SET_ME>` placeholders plus rotation guidance. Operator copies to `garage.prod.toml` (gitignored), substitutes real secrets.

### Bootstrap script (`apps/dashboard/docker/garage-init.sh`)

Idempotent one-shot. Exits 0 whether it did work or not:

```sh
#!/bin/sh
set -e

# Idempotency guard: if credentials file already exists, assume everything
# else is already provisioned and exit cleanly.
if [ -f /creds/s3-access-key-id ] && [ -f /creds/s3-secret-access-key ]; then
  echo "[init] credentials exist at /creds — skipping bootstrap"
  exit 0
fi

GARAGE="garage -c /etc/garage.toml"
echo "[init] waiting for garage..."
# healthcheck already ensures readiness, but sanity-wait briefly
until $GARAGE status >/dev/null 2>&1; do sleep 1; done

# Single-node layout
NODE_ID=$($GARAGE status | awk 'NR==3 {print $1}')
$GARAGE layout assign "$NODE_ID" -z dc1 -c 1G -t node1 || true
$GARAGE layout apply --version 1 || true

# Bucket — tolerate "already exists"
$GARAGE bucket create feedback-tool-attachments 2>&1 | grep -v "already exists" || true

# Key — mint and capture
KEY_JSON=$($GARAGE key create feedback-tool-dev --output-json 2>/dev/null || echo "")
if [ -z "$KEY_JSON" ]; then
  # Key already existed — re-issue a new secret
  KEY_JSON=$($GARAGE key import --name feedback-tool-dev --output-json 2>/dev/null || \
             $GARAGE key info feedback-tool-dev --output-json)
fi

# Parse (busybox sed — handles compact or pretty JSON without needing jq).
# The exact field names may differ slightly across Garage versions; implementer
# must verify output format of `garage key create --output-json` against the
# pinned image (dxflrs/garage:v1.0.1) and adjust the regex if needed.
echo "$KEY_JSON" | sed -n 's/.*"keyId":"\([^"]*\)".*/\1/p' > /creds/s3-access-key-id
echo "$KEY_JSON" | sed -n 's/.*"secretAccessKey":"\([^"]*\)".*/\1/p' > /creds/s3-secret-access-key

# Sanity-check both files are non-empty; fail loudly if parsing broke
if [ ! -s /creds/s3-access-key-id ] || [ ! -s /creds/s3-secret-access-key ]; then
  echo "[init] ERROR: failed to extract credentials from garage key output:"
  echo "$KEY_JSON"
  exit 1
fi

# Allow the key to read+write the bucket
$GARAGE bucket allow feedback-tool-attachments \
  --key feedback-tool-dev --read --write

echo "[init] bucket + key provisioned. credentials written to /creds/"
```

Notes on this script:

- Uses `awk` for JSON parsing to avoid adding `jq` (Garage image is Alpine-based, busybox provides awk)
- If key info fetch fails (first-run vs re-run vs partial failure), the outer `if` blocks try to recover gracefully
- The `bucket allow` call is idempotent in Garage — safe on every run (but runs only when we freshly minted a key, since the outer guard skips it on re-run)

### Runtime adapter (`apps/dashboard/server/lib/storage/s3.ts`)

Replaces the current throw-stub. Full implementation shown in design discussion (Section 3). Key properties:

- `@aws-sdk/client-s3` v3 modular client (`S3Client`, `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`)
- `forcePathStyle: true` (required for non-AWS S3)
- `region` is a sentinel string `"garage"` — required by the SDK, ignored by Garage
- Content-Type stored as native S3 object metadata (no sidecar file)
- Credential resolution in constructor: env vars first, then `./garage-creds/*` files, then a clear error

### Storage factory update (`apps/dashboard/server/lib/storage/index.ts`)

One-line change: default `STORAGE_DRIVER` from `"local"` → `"s3"`. Local-disk stays reachable via explicit `STORAGE_DRIVER=local` (no-docker escape hatch).

## Configuration

### Env vars

| Name | Default | Purpose |
|---|---|---|
| `STORAGE_DRIVER` | `s3` (was `local`) | Selects adapter. `s3` or `local` |
| `S3_ENDPOINT` | `http://localhost:3900` | Garage S3 API endpoint |
| `S3_REGION` | `garage` | Sentinel — required by SDK, ignored by Garage |
| `S3_BUCKET` | `feedback-tool-attachments` | Bucket holding all report attachments |
| `S3_ACCESS_KEY_ID` | (from `./garage-creds/`) | Override for prod or custom setups |
| `S3_SECRET_ACCESS_KEY` | (from `./garage-creds/`) | Override for prod or custom setups |

### Filesystem

| Path | Purpose |
|---|---|
| `apps/dashboard/.garage-creds/s3-access-key-id` | Auto-written by garage-init, read by S3Adapter |
| `apps/dashboard/.garage-creds/s3-secret-access-key` | Same |
| `apps/dashboard/docker/garage.toml` | Dev config, committed |
| `apps/dashboard/docker/garage.prod.toml` | Prod config, gitignored |
| `apps/dashboard/docker/garage.prod.toml.example` | Prod template, committed |
| `apps/dashboard/docker/garage-init.sh` | Bootstrap script, committed |

### `.gitignore` additions

```
apps/dashboard/.garage-creds/
apps/dashboard/docker/garage.prod.toml
```

### Package.json changes

- Add `@aws-sdk/client-s3@^3.700.0` to `apps/dashboard/package.json` deps
- Root `package.json` new scripts:
  - `dev:docker:prod` — `docker compose -f apps/dashboard/docker/docker-compose.prod.yml up -d`
  - `dev:docker:logs` — tail `garage` + `garage-init` logs
  - `dev:docker:reset` — `down -v` plus `rm -rf apps/dashboard/.garage-creds` (nuclear reset)

## Data Flow

### Write (intake → S3)

1. Intake handler receives multipart with screenshot/logs
2. Validates, writes `reports` row, then calls `storage.put(key, bytes, contentType)`
3. `storage` is the memoized singleton from `getStorage()`. First call constructs `S3Adapter`
4. `S3Adapter.put` → `PutObjectCommand` → Garage stores object at `feedback-tool-attachments/<reportId>/<kind>.<ext>` with content-type metadata
5. `report_attachments` row inserted with `storage_key = <reportId>/<kind>.<ext>`

### Read (dashboard → signed URL → attachment proxy)

1. Dashboard generates HMAC-signed URL per existing `signed-attachment-url.ts` flow. Unchanged.
2. Client fetches `/api/projects/:id/reports/:reportId/attachment?kind=screenshot&token=...&expires=...`
3. Attachment route validates signature + project membership, looks up `storage_key`, calls `storage.get(key)`
4. `S3Adapter.get` → `GetObjectCommand` → returns bytes + native Content-Type
5. Attachment route applies its kind-allowlisted Content-Type + CSP headers (from v0.6.1 hardening) and returns bytes

### Read (GitHub issue body → embedded image)

Same as above — GitHub's renderer fetches the signed URL, attachment route serves bytes from S3. No Garage-direct-fetch path.

## Testing

- `apps/dashboard/server/lib/storage/s3.test.ts` — new integration test. Requires Garage running (same implicit dependency as Postgres). Tests: put-then-get roundtrip with bytes equality + content-type; delete-then-get rejects.
- All existing intake + attachment integration tests now run with `STORAGE_DRIVER=s3` by default. They exercise the adapter end-to-end. Any S3Adapter regression surfaces in the existing suite.
- No mocking. No CI orchestration in scope (CI is itself out of scope for v1).

## Failure Modes

| Scenario | Behavior |
|---|---|
| Dashboard starts, Garage not running | S3Adapter constructor throws with exact recovery command |
| Dashboard starts, `.garage-creds/` deleted but Garage volumes intact | Constructor throws; operator runs `bun run dev:docker:reset` or re-runs `dev:docker` (which re-provisions) |
| `garage-init` fails mid-run (network flake) | Exit non-zero; `docker-compose up` fails visibly; re-run is safe (idempotency guards) |
| S3 `put` fails (Garage down mid-session) | Error propagates up through the intake handler as 500; the report row was already inserted but the attachment row was not — orphan report. Acceptable for v1; full atomicity needs a separate cleanup job. |
| `get` returns 404 (object deleted out-of-band) | SDK throws `NoSuchKey`; attachment route 404s. Acceptable. |

## Out of Scope

Restated from the design discussion (Section 6):

- Dashboard containerization
- Multi-node Garage
- Native presigned URLs
- Lifecycle / TTL policies
- Data migration from local-disk
- Backup/restore runbooks
- STS / scoped credentials
- Metrics wiring

These become future sub-projects as needed.
