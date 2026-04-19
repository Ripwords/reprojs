# Operations

## Healthcheck

The dashboard exposes `GET /api/health`, returning `{ "status": "ok" }` on a successful DB ping and `503` otherwise with an error reason. Compose watches it every 15 seconds; an external uptime monitor (BetterStack, Uptime Kuma, PagerDuty) can poll it too.

```bash
curl https://feedback.example.com/api/health
# → {"status":"ok"}
```

## Logs

```bash
docker compose logs -f dashboard       # tail dashboard
docker compose logs -f                 # everything
docker compose logs migrator           # last migration run (one-shot)
```

Common log signals:

- `[seed-settings] app_settings singleton ensured` — dashboard booted successfully
- `link:` — magic-link URL when `MAIL_PROVIDER=console`
- `[github] enqueueSync failed on intake` — GitHub sync errored; doesn't block the report, but investigate
- `Daily report cap reached` — a project hit `daily_report_cap`; bump on the project's settings page

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The migrator re-runs automatically before the dashboard restarts. A failing migration aborts the upgrade — the dashboard stays on the old image until you fix the issue.

**Reproducible deploys.** Pin `REPRO_VERSION=0.1.0` (or whichever tag) in `.env` instead of `latest`. Upgrades become a single-line change you can commit.

**Rolling back.** If a release breaks something, downgrade `REPRO_VERSION` in `.env` and `docker compose up -d`. The migrator won't un-run forward migrations, so this only works for non-schema-breaking releases. For schema-breaking releases, restore from a pre-upgrade Postgres dump.

## Backup

### Postgres

```bash
docker compose exec -T postgres pg_dump -U repro repro | gzip > repro-$(date +%F).sql.gz
```

Schedule via cron on the host. Keep 7–30 daily dumps offsite (S3 Glacier, Backblaze, off-host disk).

### Attachments

When `STORAGE_DRIVER=local`, the attachments live in the `repro_attachments_data` named volume:

```bash
docker run --rm -v repro_attachments_data:/data -v "$PWD:/out" alpine \
  tar czf /out/attachments-$(date +%F).tar.gz -C /data .
```

When `STORAGE_DRIVER=s3`, the bucket itself is your backup surface. Enable bucket versioning or object lock on the provider side.

### Config

The compose file + `.env` + (if using GitHub App) your `github-app.pem`. That's everything needed to reproduce the stack. Commit compose + a redacted `.env` to a private repo; keep `.pem` + real `.env` in your secrets store of choice.

## Restore

```bash
# Bring up just Postgres
docker compose up -d postgres

# Restore the dump
gunzip -c repro-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U repro repro

# Restore attachments volume (if local)
docker run --rm -v repro_attachments_data:/data -v "$PWD:/in" alpine \
  sh -c "cd /data && tar xzf /in/attachments-YYYY-MM-DD.tar.gz"

# Bring up the rest
docker compose up -d
```

The migrator re-applies automatically; if you're restoring on the same version, it's a no-op.

## Scaling

A single-container Repro comfortably handles small / medium teams — thousands of reports, tens of simultaneous admin users. Beyond that:

1. **Shared rate limits** — set `RATE_LIMIT_STORE=postgres` so rate limiters shard across dashboard replicas (defaults to per-worker memory). Requires the `rate_limit_buckets` table, which the migrator already creates.
2. **Multiple dashboard replicas** — behind the reverse proxy. Compose scaling:
   ```bash
   docker compose up -d --scale dashboard=3
   ```
   The migrator still runs once; replicas share it.
3. **Managed Postgres** — move off the Docker Postgres to RDS / Supabase / Neon / CrunchyData. Set `DATABASE_URL` yourself, drop the `postgres` service.
4. **S3 storage** — for multi-replica, you have to be on S3. Local disk is a single-host design.

## Host OS tuning

Not usually needed for small deployments, but worth a note:

- **Docker memory limit** — 512 MB is enough for the dashboard; 1 GB comfortable. Set via `deploy.resources.limits.memory`.
- **Postgres config** — the image defaults are fine up to ~10k reports. For millions of rows, tune `shared_buffers`, `work_mem`, `effective_cache_size` via a `postgresql.conf` bind-mount.
- **Log rotation** — `json-file` driver (Docker default) grows unbounded. Configure `log-opts` in `/etc/docker/daemon.json` with `max-size` + `max-file`.

## Troubleshooting

**`POSTGRES_PASSWORD is required`** — compose refuses to start. Set it in `.env`, `docker compose up -d`.

**Magic-link email never arrives in console mode** — working as intended. `docker compose logs dashboard | grep link:` gives you the URL to paste.

**`S3 credentials missing` on first intake** — `STORAGE_DRIVER=s3` is set but the access-key vars are blank. Re-check `.env`, `docker compose up -d`.

**`drizzle-kit migrate` fails with "relation already exists"** — the database has an older schema applied via `db:push` rather than through migrations. Either start fresh (`docker compose down -v && docker compose up -d`) or reconcile `__drizzle_migrations` by hand.

**Dashboard never reaches healthy state** — `docker compose logs dashboard` usually surfaces a missing env var or DB connection issue. Healthchecks give up after 5 retries × 15s = ~75s.

**Attachments upload but fail to display in GitHub issues** — the dashboard generates signed URLs that GitHub's image renderer fetches. For `http://localhost:*`, GitHub can't reach you. Use a real hostname + proxy.

**Port 3000 in use** — set `PORT=3001` in `.env`, `docker compose up -d`. The container still listens on 3000 internally; only the host mapping changes.
