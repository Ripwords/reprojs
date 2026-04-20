# SDK ↔ dashboard compatibility

The SDK (`@reprojs/core`, published to npm) and the dashboard (`ripwords/reprojs-dashboard`, published to Docker Hub) release on **independent cadences**. Both sides share the report schema in `@reprojs/shared`, so not every SDK version works with every dashboard version.

Pick an SDK version in the supported range for the dashboard tag you deploy.

## Matrix

| Dashboard (`ripwords/reprojs-dashboard`) | Supported SDK (`@reprojs/core`) | Notes |
| --- | --- | --- |
| `0.1.x` | `>= 0.1.0`, `< 0.2.0` | Initial wire contract. No breaking changes yet. |

A dashboard release only drops out of a column when the intake contract changes — i.e. `@reprojs/shared` gains a required field, renames a property, or tightens validation. Until that happens, the range stays open within the current major.minor.

## How versioning works

- Dashboard releases → git tag `v<X.Y.Z>` → `publish-docker.yml` → Docker Hub tag `<X.Y.Z>` + `<X.Y>` + `<X>` + `latest`.
- SDK releases → git tag `sdk-v<X.Y.Z>` → `publish-npm.yml` → `@reprojs/core@<X.Y.Z>` on npm (with OIDC provenance attestation).

The two tag prefixes are intentionally disjoint — bumping one never churn-republishes the other.

## Pinning in your host app

```bash
# Pin the SDK in your host-app's package.json:
npm i @reprojs/core@~0.1.0    # tilde: accept 0.1.x patches, refuse 0.2.x
```

```bash
# Pin the dashboard in your .env:
REPRO_VERSION=0.1.5             # exact — most predictable
REPRO_VERSION=0.1                # major.minor — accept patches on pull
```

If you deploy a new dashboard tag and update the SDK in lockstep, you don't need to read this page. You only need it when the two fall out of sync — for example, you updated the dashboard but haven't released a new build of your host app yet.

## Upgrade etiquette

- **Dashboard-only upgrade inside the supported SDK range** → safe. `docker compose pull && up -d`.
- **SDK-only upgrade inside the supported dashboard range** → safe. Ship a new build of your host app.
- **Either side crossing a row** → check the relevant release notes. Usually the dashboard is backward-compatible with older SDK versions within a major; the SDK side is the one that gains new optional fields.

If you hit a mismatch in production, the dashboard will accept the report and log a warning (`[intake] unknown-field:<name>` or `[intake] schema-version:<detected>` when the schema becomes versioned). Dropped fields don't stop the ticket from being created — they just aren't rendered in the report detail view.
