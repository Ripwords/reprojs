# Self-hosting

Repro ships as a Docker image on GitHub Container Registry plus a single `compose.yaml`. The happy path is two files + one command.

## Quick start

```bash
# 1. Download the two files from the repo
curl -fsSL https://raw.githubusercontent.com/Ripwords/reprokit/main/compose.yaml -o compose.yaml
curl -fsSL https://raw.githubusercontent.com/Ripwords/reprokit/main/.env.example -o .env

# 2. Fill in the four REQUIRED secrets in .env
#    Generate each with: openssl rand -hex 32
#    - POSTGRES_PASSWORD
#    - BETTER_AUTH_SECRET
#    - ATTACHMENT_URL_SECRET
#    - BETTER_AUTH_URL  (http://localhost:3000 locally, your https URL in prod)

# 3. Go
docker compose up -d
```

Open `http://localhost:3000`. The first user to sign up becomes the workspace admin.

That's the whole flow. Everything below is "what just happened" and "how do I do X".

## What's running

| Service     | Image                                        | Purpose                                                  |
| ----------- | -------------------------------------------- | -------------------------------------------------------- |
| `postgres`  | `postgres:17`                                | Database                                                 |
| `migrator`  | `ghcr.io/ripwords/reprokit-dashboard:<ver>`  | `drizzle-kit migrate`, exits 0, blocks dashboard start   |
| `dashboard` | `ghcr.io/ripwords/reprokit-dashboard:<ver>`  | Nuxt server on `:3000` — intake API + admin UI           |

Persistent state lives in two named Docker volumes: `postgres_data` (the DB) and `attachments_data` (local-disk screenshots / logs / replays, only used when `STORAGE_DRIVER=local`). Both survive `docker compose down`; only `docker compose down -v` drops them.

## Next steps

- [**Configuration**](./configuration) — every environment variable, grouped by feature.
- [**Reverse proxy**](./reverse-proxy) — put Caddy / Nginx / Traefik in front for TLS and a public hostname.
- [**Storage**](./storage) — switch from local disk to S3 when you outgrow one host.
- [**Integrations**](./integrations) — GitHub Issues sync, OAuth sign-in, SMTP email.
- [**Operations**](./operations) — backups, upgrades, logs, healthchecks.

## Minimum spec

- Docker 24+ with Compose v2
- 1 vCPU, 1 GB RAM is enough for small teams
- 5 GB disk baseline (grows with attachments)

## Upgrades

```bash
docker compose pull
docker compose up -d
```

The migrator re-runs automatically before the dashboard restarts. Pin `REPRO_VERSION` in your `.env` (e.g. `REPRO_VERSION=0.1.0`) if you want reproducible deploys — otherwise you're always on `latest`.
