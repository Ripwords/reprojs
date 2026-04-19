# SDK

The SDK is one package — `@reprokit/core` — that bundles the widget UI, recorder, and all shared types. No matter how your app is built (React, Vue, Svelte, Angular, Nuxt, Next, vanilla, …), the install is identical.

## Install

### `<script>` tag

```html
<script src="https://your-dashboard.example.com/sdk/repro.iife.js" async></script>
<script>
  Repro.init({
    projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
    endpoint: "https://your-dashboard.example.com",
  })
</script>
```

The `/sdk/repro.iife.js` bundle is served by the dashboard itself, so you always load a version that matches your dashboard. The IIFE registers a single global: `window.Repro`.

### ESM / bundler

```bash
npm install @reprokit/core
# or pnpm / yarn / bun
```

```ts
import { init } from "@reprokit/core"

init({
  projectKey: "rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx",
  endpoint: "https://your-dashboard.example.com",
})
```

## Where to get a project key

Sign in to your dashboard, create a project, open **Project → Settings**. Each project has:

- A **public key** (`rp_pk_` + 24 base62 chars) — safe to ship in your client JS
- An **origin allowlist** — requests from any origin not on the list are rejected with 403 and no CORS oracle leaked

You can rotate the key any time.

## API

### `init(options)`

Boots the widget. Call it once, as early as you can — typically at app startup.

```ts
interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean // show the floating button? default true
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig // fine-grained per-collector opts
  replay?: {
    enabled?: boolean
    masking?: "strict" | "moderate" | "minimal"
    maskSelectors?: string[]
    blockSelectors?: string[]
    maxBytes?: number
  }
}
```

Returns a `FeedbackHandle` with `pauseReplay()` / `resumeReplay()` methods.

### `open()` / `close()`

Open or close the widget programmatically. Useful if you want your own button instead of the default launcher (`launcher: false` + your handler calling `open()`).

```ts
import { open, close } from "@reprokit/core"

button.addEventListener("click", () => open())
```

### `identify(reporter)`

Tell Repro who the current user is. Attached to any report submitted after.

```ts
import { identify } from "@reprokit/core"

identify({
  userId: "user_123",
  email: "alex@example.com",
  name: "Alex Example",
})

// On sign-out:
identify(null)
```

### `log(event, data?, level?)`

Drop a breadcrumb into the rolling session log. Appears in the dashboard's Events tab of a report, with a timestamp.

```ts
import { log } from "@reprokit/core"

log("checkout.started", { cart_id: "c_9f2", items: 3 })
log("payment.failed", { reason: "card_declined" }, "error")
```

Level is one of `"debug" | "info" | "warn" | "error"` (default `"info"`).

## Privacy

### Masking inputs

The replay recorder masks password fields and anything you tag with `data-repro-mask`:

```html
<input type="password" />                 <!-- always masked -->
<input data-repro-mask />                 <!-- opt-in mask -->
<div data-repro-block>secret widget</div> <!-- fully blocked -->
```

Tune with `replay.masking`:

- `"strict"` — mask all inputs + text
- `"moderate"` — default; mask sensitive inputs + `data-repro-mask`
- `"minimal"` — mask only password fields

### Denylisted cookies / headers

Operators configure a cookie/header denylist on the dashboard. Report payloads strip those keys before storage.

## Bundle size

`@reprokit/core@0.1.0`:

- **ESM**: ~157 KB uncompressed (`@reprokit/*` deps inlined)
- **IIFE** (minified): ~93 KB — the one your users download

Typical real-world transfer once your CDN gzips it: ~32 KB.
