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
      link: https://github.com/Ripwords/ReproJs

features:
  - title: Drop-in widget, any framework
    details: Single script tag or ESM import. Renders inside Shadow DOM so host styles never leak. Works with React, Vue, Svelte, Angular, Nuxt, Next, or plain HTML.
  - title: Expo / React Native SDK
    details: Floating bug-report launcher, annotated screenshot, console + network + device context. Offline queue with Idempotency-Key retries. One `<ReproProvider>` wraps your app. [Install guide →](/guide/expo)
  - title: Rich context, zero config
    details: Every report bundles an annotated screenshot, rrweb-compatible replay of the last 30 seconds, console + network logs, cookies, and system info.
  - title: Tester Chrome extension
    details: Your QA team can file reports from sites the SDK isn't embedded on yet — staging builds, vendor previews, third-party widgets. The service worker proxies intake so strict CSPs don't block submission. [Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/repro-tester/kiedhhobipcjkgiljemcmmmnfcbcmjbg)
  - title: Self-hostable end to end
    details: One compose file, four secrets, one command. Pulls the image from Docker Hub, runs migrations, exposes the dashboard on :3000. Reverse-proxy with Caddy for TLS.
  - title: GitHub Issues sync
    details: Optional GitHub App. One-click "create issue" or auto-sync on intake, with two-way status reconciliation via webhooks.
  - title: Pluggable storage
    details: Local disk by default; any S3-compatible endpoint (AWS S3, Cloudflare R2, Backblaze B2, Hetzner, MinIO, Garage) for scale.
  - title: Open source
    details: MIT-licensed. Contribute on GitHub. No seat-based pricing; no data lock-in.
---

<div style="text-align: center; margin: 3rem 0;">
  <p style="margin-bottom: 1rem; color: var(--vp-c-text-2);">Repro is free and open source. If it helps you, consider supporting ongoing development:</p>
  <a href="https://buymeacoffee.com/ripwords" target="_blank" rel="noopener">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174" />
  </a>
</div>

