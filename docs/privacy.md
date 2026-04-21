---
title: Privacy Policy
description: Privacy policy for the Repro feedback SDK, dashboard, and tester Chrome extension.
editLink: false
lastUpdated: true
---

# Privacy Policy

**Effective date:** 2026-04-20

This policy explains what the Repro project collects, how it is handled, and the rights you have. Repro is a self-hostable bug-reporting stack. It is not a hosted SaaS — each installation is owned and operated by whoever deployed the dashboard.

## Who this policy applies to

Repro is distributed as three components:

| Component | What it does | Who operates it |
| --- | --- | --- |
| **@reprojs/core** (npm SDK) | Embeds a bug-report widget into a host application | The host application's operator |
| **Repro Dashboard** (self-hostable Nuxt app) | Stores reports, serves the triage UI | The team that deployed it |
| **Repro Tester** (Chrome extension) | Injects the SDK into pages for internal QA | The tester who installed it, against a dashboard they chose |

The Repro authors publish the code but **do not operate any hosted service**, do not receive any user data, and have no server-side access to any installation. When you interact with a Repro-powered feedback widget, your data is sent to whichever dashboard the host operator configured — not to us.

The remainder of this policy describes what data the software collects when used as intended. The operator of the dashboard is the data controller for their installation and is responsible for surfacing their own privacy terms to their end users.

## Data the SDK collects

When a reporter submits a bug report via the `@reprojs/core` widget, the following data is transmitted to the `intakeEndpoint` configured by the host operator:

- **Report content**: title, description, severity, and any fields the reporter typed.
- **Annotated screenshot**: a PNG of the viewport (or the area the reporter captured) with the reporter's annotations flattened into it.
- **Session replay** (last 30 seconds, optional): DOM mutations, input events, mouse position, and scroll, captured as structured rrweb-style events. Input values in text fields, password fields, and any element marked `data-repro-mask` are redacted before transmission. Replay recording can be disabled entirely by the host operator via the SDK's `replay.enabled: false` option or on a per-project basis in the dashboard.
- **Console logs**: `console.log / info / warn / error` entries buffered during the report window, with timestamps and stack traces.
- **Network logs**: `fetch` and `XMLHttpRequest` metadata — method, URL, status code, duration, and response size. Request and response bodies are not captured by default; if the host operator explicitly opts in, a configurable denylist filters sensitive headers and body fields before transmission.
- **Breadcrumbs**: custom events the host application emits via `feedback.log(event, data)`.
- **Cookies**: readable (non-`HttpOnly`) cookies present at report time, filtered through a denylist that removes keys matching common authentication patterns (`*session*`, `*token*`, `*auth*`, `*csrf*`, etc.). `HttpOnly` cookies are never accessible to the SDK.
- **System information**: user agent, operating system, browser and version, viewport size, device pixel ratio, language, timezone, page URL, referrer, and any metadata the host application attaches via the SDK's `metadata` option.
- **Reporter identity** (optional): if the host application calls `feedback.identify({ userId, email, name })`, those values are attached to the report. If `identify` is never called, reports are anonymous.
- **Network address**: the intake server sees the reporter's IP address as part of the HTTP request, the same as any other web request. The dashboard stores it alongside the report for rate limiting and abuse detection.

## Data the dashboard stores

The dashboard persists reports and their attachments (screenshots, replay files, logs) in the operator's Postgres database and configured blob storage. It also stores operator accounts — email addresses, OAuth provider IDs for Google/GitHub sign-in, and role assignments — along with project configurations (project keys, allowed origins, GitHub App installation tokens when the GitHub integration is in use).

The dashboard does not transmit any data back to the Repro authors. All data lives on the operator's infrastructure.

## Data the Chrome extension collects

The **Repro Tester** Chrome extension ("the extension") is a dev/QA tool. It itself collects nothing — it stores the tester's own list of `{ label, origin, project key, intake endpoint }` entries in `chrome.storage.local` (local to the tester's browser, never transmitted) and uses that configuration to inject the SDK into tabs whose origin the tester has explicitly added.

When the tester files a bug report through the injected SDK, the data described in [*Data the SDK collects*](#data-the-sdk-collects) is transmitted — to the dashboard the tester configured, not to the extension author.

The extension does not:

- Send data to the extension author.
- Run on any origin the tester has not explicitly added and granted host permission for.
- Fetch or execute remote code — the SDK is bundled into the extension at build time and loaded as a static asset.
- Use the collected data for advertising, creditworthiness, lending, or any purpose unrelated to bug-report submission.
- Sell, transfer, or share collected data with third parties.

## Data retention

Reports, attachments, and operator accounts are retained by the dashboard operator according to their own retention policy. Repro ships with configurable per-project retention defaults and a cron-driven purge job; operators choose how long to keep each class of data.

The extension's local storage retains the tester's configuration until the tester deletes an entry in the popup or uninstalls the extension.

## Your rights

Because Repro is self-hosted, the operator of the dashboard you interact with is your point of contact for access, export, correction, or deletion requests. Reach them directly. If you do not know who operates the dashboard that received your report, the host application that showed you the widget will.

## Changes to this policy

Material changes are committed to the public repository at [github.com/Ripwords/ReproJs](https://github.com/Ripwords/ReproJs). The effective date at the top of this page reflects the most recent change.

## Contact

For questions about the project itself — not about a specific dashboard installation — open an issue at [github.com/Ripwords/ReproJs/issues](https://github.com/Ripwords/ReproJs/issues).
