# Getting started

Repro has two halves:

1. **The SDK** — a tiny widget you embed in any web app so end users can file bug reports in a click.
2. **The dashboard** — a self-hosted Nuxt app where your team triages reports and (optionally) syncs them to GitHub Issues.

Pick where to start:

- [**Self-host the dashboard**](/self-hosting/) — you need a running dashboard before the SDK has anywhere to send reports. Most people start here.
- [**Embed the SDK**](/guide/sdk) — once the dashboard is up and you have a project key.
- [**Architecture**](/guide/architecture) — how the pieces fit together.

## Why Repro

- **Framework-agnostic SDK** — no peer dep on React / Vue / Svelte. One script tag works everywhere.
- **Rich context by default** — you get the annotated screenshot, session replay, and diagnostic bundle with every report. No "can you reproduce it?" back-and-forth.
- **Self-hostable** — ships as a Docker image on GHCR. Your data, your database.
- **Open source** — MIT license, single-tenant by design.

## Non-goals

Worth being upfront about what Repro isn't:

- Not a product analytics or heatmap tool
- Not a customer support chat widget
- Not a replacement for APM (Datadog, Sentry)
- No native mobile SDKs in v1 (web only)
- No SaaS billing layer — single-workspace self-host only

## Status

Repro is pre-1.0 and under active development. v0.1.0 is the initial cut of the rebranded monorepo with a working end-to-end flow: SDK → intake API → dashboard triage → (optional) GitHub Issues sync.
