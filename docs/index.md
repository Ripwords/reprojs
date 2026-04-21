---
layout: home

hero:
  name: Repro
  text: Feedback that actually reproduces.
  tagline: Framework-agnostic embeddable SDK + self-hostable triage dashboard. Every bug report ships with an annotated screenshot, 30 seconds of session replay, and diagnostic context.
  image:
    light: /logo.svg
    dark: /logo-dark.svg
    alt: Repro logo
  actions:
    - theme: brand
      text: Self-host in 3 minutes
      link: /self-hosting/
    - theme: alt
      text: Embed the SDK
      link: /guide/sdk
    - theme: alt
      text: GitHub
      link: https://github.com/Ripwords/reprojs

features:
  - title: Drop-in widget, any framework
    details: Single script tag or ESM import. Renders inside Shadow DOM so host styles never leak. Works with React, Vue, Svelte, Angular, Nuxt, Next, or plain HTML.
  - title: Rich context, zero config
    details: Every report bundles an annotated screenshot, rrweb-compatible replay of the last 30 seconds, console + network logs, cookies, and system info.
  - title: Tester Chrome extension
    details: Your QA team can file reports from sites the SDK isn't embedded on yet — staging builds, vendor previews, third-party widgets. The service worker proxies intake so strict CSPs don't block submission.
  - title: Self-hostable end to end
    details: One compose file, four secrets, one command. Pulls the image from Docker Hub, runs migrations, exposes the dashboard on :3000. Reverse-proxy with Caddy for TLS.
  - title: GitHub Issues sync
    details: Optional GitHub App. One-click "create issue" or auto-sync on intake, with two-way status reconciliation via webhooks.
  - title: Pluggable storage
    details: Local disk by default; any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage) for scale.
  - title: Open source
    details: MIT-licensed. Contribute on GitHub. No seat-based pricing; no data lock-in.
---
