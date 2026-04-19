# Self-hosting Repro

Repro ships as a Docker image and a docker-compose file. For most deployments the happy path is:

```bash
# 1. Download the two files
curl -fsSL https://raw.githubusercontent.com/Ripwords/reprokit/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/Ripwords/reprokit/main/.env.example -o .env

# 2. Generate the three required secrets + set BETTER_AUTH_URL
#    (edit .env in your editor of choice)
#    - POSTGRES_PASSWORD        openssl rand -hex 32
#    - BETTER_AUTH_SECRET       openssl rand -hex 32
#    - ATTACHMENT_URL_SECRET    openssl rand -hex 32
#    - BETTER_AUTH_URL          http://localhost:3000 (or your https URL)

# 3. Start everything
docker compose up -d
```

The migrator runs `drizzle-kit migrate` automatically before the dashboard starts, so new deploys and upgrades apply schema changes without manual steps.

Open `http://localhost:3000`. The first user to sign up becomes the workspace admin.

---

## What you just started

The bundled `compose.yaml` runs three services:

| Service     | Image                                       | Purpose                                                          |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------- |
| `postgres`  | `postgres:17`                               | Database                                                         |
| `migrator`  | `ghcr.io/ripwords/reprokit-dashboard:<ver>` | Runs migrations, exits 0. Blocks `dashboard` until complete.     |
| `dashboard` | `ghcr.io/ripwords/reprokit-dashboard:<ver>` | The Nuxt server (intake API + admin UI) on `:3000`               |

Persistent data:

- `postgres_data` volume — the database
- `attachments_data` volume — local-disk attachments (only when `STORAGE_DRIVER=local`)

Both survive `docker compose down`; only `docker compose down -v` drops them.

---

## Putting it on the public internet

The dashboard speaks plain HTTP on `:3000`. For anything reachable from outside localhost you want TLS. Terminate it at a reverse proxy; don't try to do TLS inside the container.

### Caddy (recommended — automatic HTTPS via Let's Encrypt)

```caddy
feedback.example.com {
    reverse_proxy localhost:3000
}
```

That's the whole file. Caddy handles cert issuance + renewal.

Set `BETTER_AUTH_URL=https://feedback.example.com` in `.env`, restart the stack (`docker compose up -d`), and you're done.

Also flip `TRUST_XFF=true` in `.env` so per-IP rate limits key off the real client IP (Caddy forwards it in `X-Forwarded-For`).

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name feedback.example.com;

    ssl_certificate     /etc/letsencrypt/live/feedback.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/feedback.example.com/privkey.pem;

    client_max_body_size 10M;  # intake payloads can get chunky with session replay

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}
```

Same `BETTER_AUTH_URL` + `TRUST_XFF=true` rule as Caddy.

---

## Configuration

See `.env.example` for every variable. The short version:

- **Required** (4 vars): `POSTGRES_PASSWORD`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ATTACHMENT_URL_SECRET`.
- **Storage**: local disk (default, zero-config) or any S3-compatible endpoint.
- **Email**: `console` by default (prints magic-link URLs to container logs — fine for single-admin self-hosts). Switch to `smtp` for real delivery; Gmail, SES, Postmark, Resend, anything works.
- **OAuth sign-in**: optional GitHub + Google — leave blank to hide the buttons.
- **GitHub Issues sync**: optional GitHub App — see below for setup.

Verify the current config at any time:

```bash
docker compose config
```

---

## Optional integrations

### Storage on S3 (Cloudflare R2, Backblaze B2, Hetzner, AWS S3, self-hosted MinIO…)

Set in `.env`:

```env
STORAGE_DRIVER=s3
S3_BUCKET=repro-attachments
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
# then the endpoint/region per provider — see comments in .env.example
```

Create the bucket, mint a scoped read/write access key, paste the creds, `docker compose up -d`. No CORS rules needed — the dashboard is the only client that reads or writes the bucket.

### GitHub Issues sync (GitHub App)

Create a GitHub App (either on your personal account or an org):

1. https://github.com/settings/apps → **New GitHub App**
2. Homepage URL: your `BETTER_AUTH_URL`
3. Callback URL: `<BETTER_AUTH_URL>/api/integrations/github/callback`
4. Webhook URL: `<BETTER_AUTH_URL>/api/integrations/github/webhook`
5. Webhook secret: run `openssl rand -hex 32` and paste it
6. Permissions (Repository):
   - **Issues**: Read + write
   - **Metadata**: Read-only (required)
   - **Contents**: Read-only (for repo listing)
7. Subscribe to events: `Issues`, `Installation`
8. After creation, generate a **Private key** (`.pem` file download)

Fill in `.env`:

```env
GITHUB_APP_ID=12345
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_WEBHOOK_SECRET=<same secret you used in step 5>
GITHUB_APP_SLUG=<your-app-slug-from-the-url>
```

Private key can be the literal PEM contents (newlines as `\n`) OR a path to a mounted file.

### OAuth sign-in (GitHub / Google)

Create OAuth apps and paste the client id + secret:

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

OAuth callback URLs:

- `<BETTER_AUTH_URL>/api/auth/callback/github`
- `<BETTER_AUTH_URL>/api/auth/callback/google`

### Email

Any SMTP provider:

```env
MAIL_PROVIDER=smtp
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxx
SMTP_FROM="Repro <noreply@example.com>"
```

---

## Upgrades

```bash
# pull the new image, re-run compose; the migrator runs automatically
docker compose pull
docker compose up -d
```

The migrator applies any pending schema changes before the dashboard starts. If a migration fails, the dashboard won't start and logs will surface the error.

For reproducible deploys, pin `REPRO_VERSION` in `.env` (e.g. `REPRO_VERSION=0.1.0`) instead of the default `latest`.

---

## Backup + restore

### Postgres

```bash
# Backup (dump + gzip)
docker compose exec -T postgres pg_dump -U repro repro | gzip > repro-$(date +%F).sql.gz

# Restore (requires the stack running, database present)
gunzip -c repro-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U repro repro
```

Schedule the dump via cron on the host. Keep 7–30 daily dumps offsite.

### Attachments (when `STORAGE_DRIVER=local`)

Back up the `attachments_data` volume:

```bash
# Backup
docker run --rm -v repro_attachments_data:/data -v "$PWD:/out" alpine \
  tar czf /out/attachments-$(date +%F).tar.gz -C /data .

# Restore
docker run --rm -v repro_attachments_data:/data -v "$PWD:/in" alpine \
  sh -c "cd /data && tar xzf /in/attachments-YYYY-MM-DD.tar.gz"
```

If `STORAGE_DRIVER=s3`, the bucket itself is your backup — enable versioning / object lock on the bucket.

### First-deploy smoke test

- [ ] Sign in (first sign-up becomes admin)
- [ ] Create a project
- [ ] Embed the SDK on a test page, file a report
- [ ] Report appears in the inbox with the screenshot rendered
- [ ] Open the screenshot in the drawer — confirms storage is wired correctly
- [ ] (If GitHub integration is enabled) install the App, file another report, verify the issue is created

---

## Operations

**Healthcheck.** The dashboard exposes `GET /api/health` — returns `{ "status": "ok" }` on a successful DB ping, `503` otherwise. Compose watches it automatically. Useful for external load balancers / uptime monitors too.

**Logs.**

```bash
docker compose logs -f dashboard     # dashboard only
docker compose logs -f               # everything
docker compose logs migrator         # last migration run (one-shot)
```

**Scaling.** A single dashboard container is sized for small / medium teams (thousands of reports, tens of concurrent users). For more: set `RATE_LIMIT_STORE=postgres` so the rate limiters shard across workers, put multiple dashboard replicas behind the reverse proxy, keep one migrator. Past that, move Postgres off the Docker host to a managed DB.

**Port conflict (3000 in use).** Change `PORT=3001` (or any free port) in `.env`, `docker compose up -d`.

---

## Troubleshooting

**"POSTGRES_PASSWORD is required"** — compose refuses to start without one. Set it in `.env`, then `docker compose up -d`.

**Magic-link email never arrives in console mode** — that's working as intended: check the dashboard container logs (`docker compose logs dashboard`) for a URL to copy-paste. Switch `MAIL_PROVIDER=smtp` for real email.

**"S3 credentials missing" on first intake** — `STORAGE_DRIVER=s3` is set but the access-key vars are blank. Re-check `.env`, `docker compose up -d`.

**`drizzle-kit migrate` fails with "relation already exists"** — the database has an older schema that was applied via `db:push` rather than through migrations. Either start with a fresh volume (`docker compose down -v && docker compose up -d`) or drop into Postgres and reconcile `__drizzle_migrations` by hand.

**Can't reach the dashboard even though the container is up** — check `docker compose ps` for health: `dashboard (healthy)`. If it's `starting` for more than a minute, `docker compose logs dashboard` — usually a DB connection or env-var issue.

**Attachments upload but fail to render in GitHub issue bodies** — the dashboard generates signed URLs that GitHub's image renderer fetches; GitHub can't reach `http://localhost:3000`. Set `BETTER_AUTH_URL` to a publicly reachable URL (via your reverse proxy) and restart.

---

## Running from source (contributors)

```bash
git clone https://github.com/Ripwords/reprokit.git
cd reprokit
bun install
cp .env.example .env
# then also set DATABASE_URL for the dev Postgres:
# DATABASE_URL=postgres://postgres:postgres@localhost:5436/repro

bun run dev:docker   # starts dev Postgres on :5436
bun run db:push      # sync schema (dev uses push, not migrations)
bun run dev          # dashboard on :3000
```
