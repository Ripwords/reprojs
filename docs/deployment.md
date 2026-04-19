# Deployment Guide

Repro is built to self-host. This document covers what operators need to configure.

## Prerequisites

- Docker + docker-compose (for Postgres; the dashboard itself runs on the host or in your own container)
- Bun 1.3+ for running the dashboard
- Postgres 17 (provided by `docker-compose.dev.yml`)

## Env vars

See `.env.example` for the full list. Required at minimum:

- `DATABASE_URL` — standard Postgres URL
- `BETTER_AUTH_SECRET` — generate with `openssl rand -hex 32`
- `BETTER_AUTH_URL` — base URL of the dashboard (e.g. `https://feedback.example.com`)
- `ATTACHMENT_URL_SECRET` — generate with `openssl rand -hex 32`

Optional based on features used:

- `GITHUB_APP_*` — GitHub integration (see `docs/superpowers/specs/2026-04-18-github-sync-design.md`)
- `SMTP_*` — email notifications / invites
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth sign-in

## Storage — two paths

Attachments (screenshots, logs) are stored via the `StorageAdapter` interface. **Pick ONE at deploy time**; don't switch after writes have landed — there is no migration tooling between the two backends.

### Path A: local filesystem (simple, single-host)

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=/data/attachments
```

Mount `/data/attachments` as a Docker volume or bind-mount. Back up with file-level tooling (rsync, snapshots, etc.). Appropriate for:

- Single VM / single-host deployments
- Homelabs, small teams
- Expected data size below a few GB

Restore = copy the files back to the mount, restart the dashboard.

### Path B: S3-compatible (cloud, multi-host, managed durability)

```env
STORAGE_DRIVER=s3
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# plus S3_ENDPOINT / S3_REGION / S3_VIRTUAL_HOSTED per provider — see below
```

Any S3 API works. Common choices:

| Provider | Strength | Config |
|---|---|---|
| **Cloudflare R2** | $0 egress, free tier | `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_REGION=auto` |
| **Backblaze B2** | Cheap storage | `S3_ENDPOINT=https://s3.<region>.backblazeb2.com`, `S3_REGION=<region>` |
| **Hetzner Object Storage** | EU pricing, regional | `S3_ENDPOINT=https://<region>.your-objectstorage.com`, `S3_REGION=<region>` |
| **AWS S3** | Most mature, paid egress | `S3_VIRTUAL_HOSTED=true`, leave `S3_ENDPOINT` empty |
| **Self-run MinIO / Garage / SeaweedFS** | Full control, free | `S3_ENDPOINT=http://<host>:<port>`, any region string |

Create the bucket, mint an access key with `read/write` scoped to that bucket, paste into `.env`. No CORS rules needed — the dashboard is the only client that reads/writes.

### Not supported in v1

- Automatic failover between local and S3
- Mixed writes (some attachments local, some S3)
- Migration tooling

If you need to migrate, back up old attachments, switch `STORAGE_DRIVER`, and re-upload historical attachments manually (or write a one-off copy script — the `StorageAdapter` interface is three methods: `put`, `get`, `delete`).

## Database

```bash
bun run dev:docker   # starts Postgres
bun run db:migrate   # applies committed migrations
```

For production, substitute your own Postgres (RDS / DigitalOcean / Supabase / etc.) and set `DATABASE_URL` accordingly.

## Running the dashboard

```bash
bun install
bun run build
# bun run preview      — or use your own process manager
```

The dashboard is a Nuxt 4 app — it builds to a Node.js server under `.output/`. Deploy with any Node-compatible runtime (PM2, systemd, Docker image of your choosing, etc.).

## First-deploy smoke test

- [ ] Sign in (admin account — first sign-up becomes admin)
- [ ] Create a project
- [ ] Install the SDK on a test page; file a report
- [ ] Confirm the report lands in the inbox with the screenshot rendered
- [ ] Open the screenshot in the drawer — confirms storage is wired correctly
- [ ] (If using GitHub integration) install the App, file another report, verify issue creates

## Troubleshooting

**"S3 credentials missing" on first intake** — `STORAGE_DRIVER=s3` is set but the access key / secret env vars are empty. Double-check `.env`.

**Attachments upload but fail to display in GitHub issue bodies** — the dashboard generates signed URLs that GitHub's renderer fetches. For local dev behind `localhost`, GitHub can't reach the URL. Use a tunnel (cloudflared, ngrok) and set `BETTER_AUTH_URL` to the tunnel URL.

**`db:migrate` fails with "relation already exists"** — the local DB has migrations applied via `db:push` but the journal is out of sync. See `docs/superpowers/specs/` notes on journal reconciliation, or start with a fresh DB (`docker compose down -v && bun run dev:docker && bun run db:migrate`).
