# Tester Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension at `apps/extension/` that lets internal testers inject the `@reprojs/core` SDK into pre-configured origins with a `{ label, origin, projectKey, intakeEndpoint }` list stored in `chrome.storage.local`.

**Architecture:** crxjs + Vite + Preact. Empty `host_permissions` at ship time; runtime `chrome.permissions.request` when the tester adds an origin. Service worker watches `tabs.onUpdated`, matches the tab's origin against stored configs, and uses `chrome.scripting.executeScript` into `world: "MAIN"` to (1) set `window.__REPRO_CONFIG__`, (2) load the bundled `@reprojs/core` IIFE. No dashboard auth, no remote code.

**Tech Stack:** TypeScript (strict), Preact, Vite, `@crxjs/vite-plugin`, `chrome.storage.local`, `chrome.permissions`, `chrome.scripting`, `chrome.tabs`, bun-test, Playwright (MV3 persistent context), oxlint, oxfmt.

Spec: `docs/superpowers/specs/2026-04-20-tester-chrome-extension-design.md`.

**Non-obvious repo facts the implementer needs:**
- Monorepo uses **Bun workspaces** (not pnpm / turbo). Root package manager is Bun. The extension package goes under `apps/extension/` and gets picked up by the `apps/*` glob in `package.json`.
- SDK IIFE artifact lives at `packages/core/dist/repro.iife.js` and the global is `Repro`. Build it with `bun run sdk:build` from the repo root.
- SDK init signature (from `packages/core/src/config.ts`): `Repro.init({ projectKey, endpoint })`. `projectKey` must match `/^rp_pk_[A-Za-z0-9]{24}$/`. `endpoint` must be a valid absolute URL.
- Lint is **oxlint** and format is **oxfmt**. Do not introduce ESLint/Prettier.
- Tests use `bun test`. Import from `"bun:test"`.
- Existing spec files show the repo's voice and structure — match it.

---

## File Structure

```
apps/extension/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── manifest.config.ts
├── index.html                 # popup entry (vite auto-serves)
├── options.html               # options entry
├── scripts/
│   └── sync-sdk.ts            # copies packages/core/dist/repro.iife.js → public/
├── public/
│   └── repro.iife.js          # .gitignored, regenerated from sync-sdk.ts
├── src/
│   ├── types.ts
│   ├── lib/
│   │   ├── storage.ts
│   │   ├── storage.test.ts
│   │   ├── origin.ts
│   │   ├── origin.test.ts
│   │   └── permissions.ts
│   ├── service-worker/
│   │   └── index.ts
│   ├── bootstrap/
│   │   └── set-config.ts      # world:"MAIN" inline injected fn source
│   ├── popup/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── ConfigList.tsx
│   │   ├── AddConfigForm.tsx
│   │   └── styles.css
│   └── options/
│       └── main.tsx           # reuses popup App.tsx
└── tests/
    └── e2e/
        └── inject.spec.ts     # Playwright MV3
```

Additions outside `apps/extension/`:
- `.gitignore`: add `apps/extension/public/repro.iife.js`.
- Root `package.json` scripts: `ext:dev`, `ext:build`, `ext:test`.

---

## Task 1: Scaffold `apps/extension/` package

**Files:**
- Create: `apps/extension/package.json`
- Create: `apps/extension/tsconfig.json`
- Create: `apps/extension/vite.config.ts`
- Create: `apps/extension/manifest.config.ts`
- Create: `apps/extension/index.html`
- Create: `apps/extension/options.html`
- Create: `apps/extension/src/popup/main.tsx`
- Create: `apps/extension/src/popup/App.tsx`
- Create: `apps/extension/src/options/main.tsx`
- Create: `apps/extension/src/service-worker/index.ts`
- Create: `apps/extension/public/.gitkeep`

- [ ] **Step 1: Create `apps/extension/package.json`**

```json
{
  "name": "@reprojs/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "bun scripts/sync-sdk.ts && vite build",
    "preview": "vite preview",
    "test": "bun test src/",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "preact": "^10.23.0"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.0.0-beta.28",
    "@playwright/test": "^1.48.0",
    "@preact/preset-vite": "^2.9.0",
    "@reprojs/core": "workspace:*",
    "@types/bun": "^1.3.12",
    "@types/chrome": "^0.0.270",
    "typescript": "^5.8",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `apps/extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["chrome", "bun-types"],
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*", "scripts/**/*", "*.ts", "*.tsx"]
}
```

- [ ] **Step 3: Create `apps/extension/manifest.config.ts`**

```ts
import { defineManifest } from "@crxjs/vite-plugin"
import pkg from "./package.json" with { type: "json" }

export default defineManifest({
  manifest_version: 3,
  name: "Repro Tester",
  description: "Inject the Repro SDK into configured origins for internal QA.",
  version: pkg.version,
  permissions: ["storage", "scripting", "activeTab", "tabs"],
  host_permissions: [],
  optional_host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/service-worker/index.ts",
    type: "module",
  },
  action: {
    default_popup: "index.html",
  },
  options_page: "options.html",
  web_accessible_resources: [
    {
      resources: ["repro.iife.js"],
      matches: ["<all_urls>"],
    },
  ],
})
```

- [ ] **Step 4: Create `apps/extension/vite.config.ts`**

```ts
import { defineConfig } from "vite"
import { crx } from "@crxjs/vite-plugin"
import preact from "@preact/preset-vite"
import manifest from "./manifest.config"

export default defineConfig({
  plugins: [preact(), crx({ manifest })],
  build: {
    target: "es2022",
  },
})
```

- [ ] **Step 5: Create `apps/extension/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Repro Tester</title>
  </head>
  <body style="width: 380px; margin: 0;">
    <div id="root"></div>
    <script type="module" src="/src/popup/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `apps/extension/options.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Repro Tester — Options</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/options/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `apps/extension/public/.gitkeep`**

```
```

(Empty file so the `public/` directory is tracked; the real contents are generated.)

- [ ] **Step 8: Create stub entries so build succeeds**

`apps/extension/src/popup/main.tsx`:
```tsx
import { render } from "preact"
import { App } from "./App"

render(<App />, document.getElementById("root")!)
```

`apps/extension/src/popup/App.tsx`:
```tsx
export function App() {
  return <div>Repro Tester</div>
}
```

`apps/extension/src/options/main.tsx`:
```tsx
import { render } from "preact"
import { App } from "../popup/App"

render(<App />, document.getElementById("root")!)
```

`apps/extension/src/service-worker/index.ts`:
```ts
// Placeholder — real logic in Task 6.
self.addEventListener("install", () => {
  // no-op
})
```

- [ ] **Step 9: Install dependencies at repo root**

Run: `bun install`
Expected: Bun resolves the new workspace package, symlinks `@reprojs/core` from `packages/core`, writes an updated `bun.lock`.

- [ ] **Step 10: Verify the build produces an unpacked extension**

Run: `bun --filter @reprojs/extension build`
Expected: `apps/extension/dist/manifest.json` exists and lists the popup, options page, service worker, and `repro.iife.js` web-accessible resource (this is the placeholder build — `sync-sdk.ts` isn't wired yet, but the skeleton must build).

- [ ] **Step 11: Add `.gitignore` entry**

Modify `.gitignore` (repo root). Append:
```
apps/extension/public/repro.iife.js
```

- [ ] **Step 12: Commit**

```bash
git add apps/extension .gitignore bun.lock package.json
git commit -m "feat(extension): scaffold apps/extension MV3 + crxjs skeleton"
```

---

## Task 2: Config types + storage wrapper (TDD)

**Files:**
- Create: `apps/extension/src/types.ts`
- Create: `apps/extension/src/lib/storage.ts`
- Test: `apps/extension/src/lib/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/lib/storage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { addConfig, deleteConfig, listConfigs, updateConfig } from "./storage"
import type { Config } from "../types"

type Shape = { configs?: Config[] }
const stubChromeStorage = () => {
  const state: Shape = {}
  const mock = {
    storage: {
      local: {
        get: (keys: string[] | null) => {
          if (keys === null) return Promise.resolve({ ...state })
          const out: Record<string, unknown> = {}
          for (const k of keys) if (k in state) out[k] = (state as Record<string, unknown>)[k]
          return Promise.resolve(out)
        },
        set: (partial: Shape) => {
          Object.assign(state, partial)
          return Promise.resolve()
        },
      },
    },
  }
  ;(globalThis as unknown as { chrome: typeof mock }).chrome = mock
  return state
}

describe("storage", () => {
  beforeEach(() => stubChromeStorage())
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  test("listConfigs returns empty array when unset", async () => {
    expect(await listConfigs()).toEqual([])
  })

  test("addConfig appends with a generated id and createdAt", async () => {
    const c = await addConfig({
      label: "staging",
      origin: "https://staging.acme.com",
      projectKey: "rp_pk_abcdefghijklmnopqrstuvwx",
      intakeEndpoint: "https://repro.example.com",
    })
    expect(c.id).toMatch(/[0-9a-f-]{36}/)
    expect(c.createdAt).toBeGreaterThan(0)
    expect(await listConfigs()).toHaveLength(1)
  })

  test("updateConfig replaces a matching entry by id", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
    })
    await updateConfig(c.id, { label: "a-renamed" })
    const [updated] = await listConfigs()
    expect(updated?.label).toBe("a-renamed")
  })

  test("deleteConfig removes the matching entry", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
    })
    await deleteConfig(c.id)
    expect(await listConfigs()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/extension/src/lib/storage.test.ts`
Expected: FAIL — module `./storage` and `../types` do not exist.

- [ ] **Step 3: Create `apps/extension/src/types.ts`**

```ts
export type Config = {
  id: string
  label: string
  origin: string
  projectKey: string
  intakeEndpoint: string
  createdAt: number
}

export type ConfigInput = Omit<Config, "id" | "createdAt">
```

- [ ] **Step 4: Implement `apps/extension/src/lib/storage.ts`**

```ts
import type { Config, ConfigInput } from "../types"

const KEY = "configs"

async function readAll(): Promise<Config[]> {
  const result = await chrome.storage.local.get([KEY])
  const value = (result as { configs?: Config[] }).configs
  return value ?? []
}

async function writeAll(configs: Config[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: configs })
}

export async function listConfigs(): Promise<Config[]> {
  return readAll()
}

export async function addConfig(input: ConfigInput): Promise<Config> {
  const config: Config = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  const all = await readAll()
  await writeAll([...all, config])
  return config
}

export async function updateConfig(id: string, patch: Partial<ConfigInput>): Promise<void> {
  const all = await readAll()
  const next = all.map((c) => (c.id === id ? { ...c, ...patch } : c))
  await writeAll(next)
}

export async function deleteConfig(id: string): Promise<void> {
  const all = await readAll()
  await writeAll(all.filter((c) => c.id !== id))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/extension/src/lib/storage.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/types.ts apps/extension/src/lib/storage.ts apps/extension/src/lib/storage.test.ts
git commit -m "feat(extension): add chrome.storage.local config wrapper"
```

---

## Task 3: Origin matching utility (TDD)

**Files:**
- Create: `apps/extension/src/lib/origin.ts`
- Test: `apps/extension/src/lib/origin.test.ts`

The service worker gets a tab URL and must find the matching `Config`. Origin match rules:
- Exact origin match (scheme + host + port).
- Skip non-http(s) URLs (`chrome://`, `file://`, `chrome-extension://`, `about:`).
- Input that fails `URL` parsing returns `null`.

- [ ] **Step 1: Write the failing test**

Create `apps/extension/src/lib/origin.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { findConfigForUrl, toOrigin } from "./origin"
import type { Config } from "../types"

const cfg = (origin: string, id = "1"): Config => ({
  id,
  label: "l",
  origin,
  projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
  intakeEndpoint: "https://repro.example.com",
  createdAt: 0,
})

describe("toOrigin", () => {
  test("extracts scheme + host + port for https", () => {
    expect(toOrigin("https://staging.acme.com/some/path?x=1")).toBe("https://staging.acme.com")
  })
  test("extracts with explicit port", () => {
    expect(toOrigin("http://localhost:3000/foo")).toBe("http://localhost:3000")
  })
  test("returns null for chrome://", () => {
    expect(toOrigin("chrome://extensions")).toBeNull()
  })
  test("returns null for file://", () => {
    expect(toOrigin("file:///tmp/a.html")).toBeNull()
  })
  test("returns null for chrome-extension://", () => {
    expect(toOrigin("chrome-extension://abc/popup.html")).toBeNull()
  })
  test("returns null for unparseable", () => {
    expect(toOrigin("not a url")).toBeNull()
  })
})

describe("findConfigForUrl", () => {
  test("matches by exact origin", () => {
    const configs = [cfg("https://a.example"), cfg("https://b.example", "2")]
    expect(findConfigForUrl("https://b.example/path", configs)?.id).toBe("2")
  })
  test("returns undefined for non-matching origin", () => {
    const configs = [cfg("https://a.example")]
    expect(findConfigForUrl("https://c.example/path", configs)).toBeUndefined()
  })
  test("returns undefined for chrome:// URLs", () => {
    const configs = [cfg("https://a.example")]
    expect(findConfigForUrl("chrome://extensions", configs)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/extension/src/lib/origin.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `apps/extension/src/lib/origin.ts`**

```ts
import type { Config } from "../types"

const INJECTABLE = new Set(["http:", "https:"])

export function toOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    if (!INJECTABLE.has(u.protocol)) return null
    return u.origin
  } catch {
    return null
  }
}

export function findConfigForUrl(url: string, configs: readonly Config[]): Config | undefined {
  const origin = toOrigin(url)
  if (origin === null) return undefined
  return configs.find((c) => c.origin === origin)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/extension/src/lib/origin.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/lib/origin.ts apps/extension/src/lib/origin.test.ts
git commit -m "feat(extension): add origin matching utility"
```

---

## Task 4: Permissions helper

**Files:**
- Create: `apps/extension/src/lib/permissions.ts`

No unit tests — this file is a thin wrapper over `chrome.permissions`. Its behavior is exercised in the Playwright test in Task 10.

- [ ] **Step 1: Implement**

Create `apps/extension/src/lib/permissions.ts`:

```ts
function originPattern(origin: string): string {
  return `${origin}/*`
}

export async function hasOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(origin)] })
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(origin)] })
}

export async function removeOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.remove({ origins: [originPattern(origin)] })
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit -p apps/extension/tsconfig.json`
Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/lib/permissions.ts
git commit -m "feat(extension): add chrome.permissions helpers"
```

---

## Task 5: SDK sync script

**Files:**
- Create: `apps/extension/scripts/sync-sdk.ts`

Rationale: MV3 forbids remote code, so the SDK IIFE must be bundled as a static asset. We copy it from `packages/core/dist/` into `apps/extension/public/` at extension build time. The file is `.gitignored` so we don't double-track it.

- [ ] **Step 1: Implement**

Create `apps/extension/scripts/sync-sdk.ts`:

```ts
import { existsSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, "../../../packages/core/dist/repro.iife.js")
const DEST = resolve(__dirname, "../public/repro.iife.js")

if (!existsSync(SRC)) {
  console.error(
    `[sync-sdk] Missing ${SRC}.\n` +
      `Run 'bun run sdk:build' from the repo root before building the extension.`,
  )
  process.exit(1)
}

await mkdir(dirname(DEST), { recursive: true })
await copyFile(SRC, DEST)
console.log(`[sync-sdk] Copied @reprojs/core IIFE → ${DEST}`)
```

- [ ] **Step 2: Verify it works end-to-end**

Run these in sequence from the repo root:
```bash
bun run sdk:build
bun --filter @reprojs/extension build
```
Expected: `apps/extension/dist/repro.iife.js` exists and is a non-empty JS file starting with `var Repro=`.

- [ ] **Step 3: Commit**

```bash
git add apps/extension/scripts/sync-sdk.ts
git commit -m "feat(extension): add SDK sync script"
```

---

## Task 6: Service worker injection

**Files:**
- Create: `apps/extension/src/bootstrap/set-config.ts`
- Modify: `apps/extension/src/service-worker/index.ts`

The service worker fires on `chrome.tabs.onUpdated` when `status === "complete"`, finds a matching config, and runs two `chrome.scripting.executeScript` calls in `world: "MAIN"`. The first call sets `window.__REPRO_CONFIG__`; the second loads the SDK IIFE which reads that config and calls `Repro.init(...)`.

Note: `Repro.init()` requires an explicit call — the IIFE itself exposes the global but does not auto-init. We need a third inline call to run `Repro.init(window.__REPRO_CONFIG__)`.

- [ ] **Step 1: Create `apps/extension/src/bootstrap/set-config.ts`**

This file holds the two inline `func` bodies that get serialized into `executeScript`. It's pure source code — no module imports. Keep it side-effect-free at import time.

```ts
// These functions are serialized by chrome.scripting.executeScript's `func`
// option. They run in the page's MAIN world, so they must be self-contained
// — no closures over module-scope values.

export function injectConfig(projectKey: string, endpoint: string): void {
  const g = globalThis as unknown as { __REPRO_CONFIG__?: unknown }
  g.__REPRO_CONFIG__ = { projectKey, endpoint, source: "extension" }
}

export function bootRepro(): void {
  const g = globalThis as unknown as {
    __REPRO_CONFIG__?: { projectKey: string; endpoint: string }
    Repro?: { init: (opts: { projectKey: string; endpoint: string }) => void }
  }
  const cfg = g.__REPRO_CONFIG__
  if (!cfg || !g.Repro) return
  g.Repro.init({ projectKey: cfg.projectKey, endpoint: cfg.endpoint })
}
```

- [ ] **Step 2: Replace `apps/extension/src/service-worker/index.ts`**

```ts
import { findConfigForUrl } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { listConfigs } from "../lib/storage"
import { bootRepro, injectConfig } from "../bootstrap/set-config"

async function tryInject(tabId: number, url: string): Promise<void> {
  const configs = await listConfigs()
  const match = findConfigForUrl(url, configs)
  if (!match) return

  // Permission may have been revoked in chrome://extensions between tab load
  // and here. Check first so we emit a clear log line instead of a noisy
  // scripting error.
  if (!(await hasOriginPermission(match.origin))) return

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: injectConfig,
      args: [match.projectKey, match.intakeEndpoint],
    })
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      files: ["repro.iife.js"],
    })
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: bootRepro,
    })
  } catch (err) {
    // Permission denied / tab closed mid-inject / page navigated away.
    // Swallow — the next tabs.onUpdated cycle will retry if the user returns.
    console.debug("[repro-extension] inject failed", err)
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return
  if (!tab.url) return
  void tryInject(tabId, tab.url)
})
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit -p apps/extension/tsconfig.json`
Expected: Zero errors.

- [ ] **Step 4: Build to confirm the service worker compiles**

Run: `bun --filter @reprojs/extension build`
Expected: Build succeeds. `apps/extension/dist/service-worker/index.js` exists.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/bootstrap apps/extension/src/service-worker/index.ts
git commit -m "feat(extension): inject SDK via chrome.scripting on tab load"
```

---

## Task 7: Popup — config list component

**Files:**
- Create: `apps/extension/src/popup/ConfigList.tsx`
- Modify: `apps/extension/src/popup/App.tsx`
- Create: `apps/extension/src/popup/styles.css`

- [ ] **Step 1: Create `apps/extension/src/popup/styles.css`**

```css
:root {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: #1f2937;
  background: #f9fafb;
}
body {
  margin: 0;
}
.app {
  padding: 12px;
}
.config-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.config-item {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.config-item .label {
  font-weight: 600;
}
.config-item .origin {
  color: #6b7280;
  font-size: 12px;
  word-break: break-all;
}
.btn {
  font: inherit;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #d1d5db;
  background: white;
  cursor: pointer;
}
.btn.primary {
  background: #2563eb;
  color: white;
  border-color: #2563eb;
}
.btn.danger {
  color: #b91c1c;
  border-color: #fecaca;
}
.empty {
  color: #6b7280;
  text-align: center;
  padding: 20px 0;
}
.error {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 4px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.field input {
  font: inherit;
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}
.form {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px;
  margin-top: 12px;
}
h1 {
  margin: 0 0 12px;
  font-size: 14px;
}
```

- [ ] **Step 2: Create `apps/extension/src/popup/ConfigList.tsx`**

```tsx
import type { Config } from "../types"

type Props = {
  configs: Config[]
  onDelete: (id: string) => void
}

export function ConfigList({ configs, onDelete }: Props) {
  if (configs.length === 0) {
    return <p class="empty">No origins configured yet.</p>
  }
  return (
    <ul class="config-list">
      {configs.map((c) => (
        <li key={c.id} class="config-item">
          <div>
            <div class="label">{c.label}</div>
            <div class="origin">{c.origin}</div>
          </div>
          <button class="btn danger" onClick={() => onDelete(c.id)} type="button">
            Remove
          </button>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Replace `apps/extension/src/popup/App.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks"
import type { Config } from "../types"
import { deleteConfig, listConfigs } from "../lib/storage"
import { removeOriginPermission } from "../lib/permissions"
import { ConfigList } from "./ConfigList"
import "./styles.css"

export function App() {
  const [configs, setConfigs] = useState<Config[]>([])

  async function refresh() {
    setConfigs(await listConfigs())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleDelete(id: string) {
    const target = configs.find((c) => c.id === id)
    if (!target) return
    await deleteConfig(id)
    await removeOriginPermission(target.origin)
    await refresh()
  }

  return (
    <div class="app">
      <h1>Configured origins</h1>
      <ConfigList configs={configs} onDelete={handleDelete} />
    </div>
  )
}
```

- [ ] **Step 4: Build**

Run: `bun --filter @reprojs/extension build`
Expected: Build succeeds. `apps/extension/dist/index.html` exists and references the built popup bundle.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/popup
git commit -m "feat(extension): popup shell + config list component"
```

---

## Task 8: Popup — add config form with permission request

**Files:**
- Create: `apps/extension/src/popup/AddConfigForm.tsx`
- Modify: `apps/extension/src/popup/App.tsx`

- [ ] **Step 1: Create `apps/extension/src/popup/AddConfigForm.tsx`**

```tsx
import { useState } from "preact/hooks"
import type { ConfigInput } from "../types"

const KEY_RE = /^rp_pk_[A-Za-z0-9]{24}$/

type Props = {
  onSubmit: (input: ConfigInput) => Promise<{ ok: true } | { ok: false; message: string }>
}

function validate(input: ConfigInput): string | null {
  if (input.label.trim().length === 0) return "Label is required."
  if (!KEY_RE.test(input.projectKey)) return "projectKey must match rp_pk_[24 chars]."
  let originUrl: URL
  try {
    originUrl = new URL(input.origin)
  } catch {
    return "Origin must be a valid URL (e.g. https://staging.acme.com)."
  }
  if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
    return "Origin must use http or https."
  }
  if (`${originUrl.origin}` !== input.origin) {
    return "Origin must be scheme + host (+ port) only, with no path."
  }
  try {
    new URL(input.intakeEndpoint)
  } catch {
    return "Intake endpoint must be a valid absolute URL."
  }
  return null
}

export function AddConfigForm({ onSubmit }: Props) {
  const [label, setLabel] = useState("")
  const [origin, setOrigin] = useState("")
  const [projectKey, setProjectKey] = useState("")
  const [intakeEndpoint, setIntakeEndpoint] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: Event) {
    e.preventDefault()
    const input: ConfigInput = { label: label.trim(), origin: origin.trim(), projectKey: projectKey.trim(), intakeEndpoint: intakeEndpoint.trim() }
    const err = validate(input)
    if (err) {
      setError(err)
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await onSubmit(input)
    setSubmitting(false)
    if (result.ok) {
      setLabel("")
      setOrigin("")
      setProjectKey("")
      setIntakeEndpoint("")
    } else {
      setError(result.message)
    }
  }

  return (
    <form class="form" onSubmit={handleSubmit}>
      <div class="field">
        <label for="label">Label</label>
        <input id="label" value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} />
      </div>
      <div class="field">
        <label for="origin">Origin</label>
        <input
          id="origin"
          placeholder="https://staging.acme.com"
          value={origin}
          onInput={(e) => setOrigin((e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for="projectKey">Project key</label>
        <input id="projectKey" value={projectKey} onInput={(e) => setProjectKey((e.target as HTMLInputElement).value)} />
      </div>
      <div class="field">
        <label for="intakeEndpoint">Intake endpoint</label>
        <input
          id="intakeEndpoint"
          placeholder="https://repro.example.com"
          value={intakeEndpoint}
          onInput={(e) => setIntakeEndpoint((e.target as HTMLInputElement).value)}
        />
      </div>
      {error ? <div class="error">{error}</div> : null}
      <button type="submit" class="btn primary" disabled={submitting}>
        {submitting ? "Requesting permission…" : "Add origin"}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Replace `apps/extension/src/popup/App.tsx`**

```tsx
import { useEffect, useState } from "preact/hooks"
import type { Config, ConfigInput } from "../types"
import { addConfig, deleteConfig, listConfigs } from "../lib/storage"
import { removeOriginPermission, requestOriginPermission } from "../lib/permissions"
import { AddConfigForm } from "./AddConfigForm"
import { ConfigList } from "./ConfigList"
import "./styles.css"

export function App() {
  const [configs, setConfigs] = useState<Config[]>([])

  async function refresh() {
    setConfigs(await listConfigs())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleAdd(input: ConfigInput): Promise<{ ok: true } | { ok: false; message: string }> {
    const granted = await requestOriginPermission(input.origin)
    if (!granted) {
      return { ok: false, message: "Host permission denied for this origin." }
    }
    await addConfig(input)
    await refresh()
    return { ok: true }
  }

  async function handleDelete(id: string) {
    const target = configs.find((c) => c.id === id)
    if (!target) return
    await deleteConfig(id)
    await removeOriginPermission(target.origin)
    await refresh()
  }

  return (
    <div class="app">
      <h1>Configured origins</h1>
      <ConfigList configs={configs} onDelete={handleDelete} />
      <AddConfigForm onSubmit={handleAdd} />
    </div>
  )
}
```

- [ ] **Step 3: Build**

Run: `bun --filter @reprojs/extension build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup
git commit -m "feat(extension): add-config form with permission request"
```

---

## Task 9: Wire root scripts

**Files:**
- Modify: `package.json` (repo root)

- [ ] **Step 1: Add scripts**

Edit the repo-root `package.json`. Insert these entries into the `scripts` object (alphabetical order with the existing ones):

```json
"ext:dev": "bun --filter @reprojs/extension dev",
"ext:build": "bun run sdk:build && bun --filter @reprojs/extension build",
"ext:test": "bun --filter @reprojs/extension test",
```

- [ ] **Step 2: Verify each script runs**

Run: `bun run ext:test`
Expected: Storage + origin tests pass (13 tests).

Run: `bun run ext:build`
Expected: Build completes; `apps/extension/dist/manifest.json` and `apps/extension/dist/repro.iife.js` both exist.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(extension): add ext:* scripts to root"
```

---

## Task 10: Playwright MV3 integration test

**Files:**
- Create: `apps/extension/playwright.config.ts`
- Create: `apps/extension/tests/e2e/inject.spec.ts`
- Create: `apps/extension/tests/e2e/fixtures/test-site.html`

Rationale: Playwright launches Chromium with a persistent context and the built extension loaded via `--load-extension`. The test serves a static HTML fixture from a local server on a known origin, grants the host permission programmatically via `chrome.permissions.request` (triggered from the popup page), seeds a config, and asserts the SDK injected (shadow-DOM root `#repro-host` appears).

- [ ] **Step 1: Create `apps/extension/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    headless: false,
  },
})
```

- [ ] **Step 2: Create `apps/extension/tests/e2e/fixtures/test-site.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Repro Tester Test Site</title>
  </head>
  <body>
    <h1>Test site</h1>
  </body>
</html>
```

- [ ] **Step 3: Create `apps/extension/tests/e2e/inject.spec.ts`**

```ts
import { chromium, expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { mkdtempSync } from "node:fs"

const EXT_PATH = resolve(__dirname, "../../dist")
const FIXTURE = readFileSync(resolve(__dirname, "fixtures/test-site.html"), "utf8")

test("injects the SDK on a configured origin", async () => {
  // Local HTTP server for the fixture. We bind to 127.0.0.1:0 to get a free
  // port; the origin is whatever port gets assigned.
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(FIXTURE)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  const origin = `http://127.0.0.1:${address.port}`

  const userDataDir = mkdtempSync(resolve(tmpdir(), "repro-ext-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  })

  try {
    // Find the extension ID via the service worker URL.
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent("serviceworker")
    const extId = new URL(sw.url()).host

    // Seed a config and grant host permission from the extension context.
    // We run this from the popup HTML so it inherits the extension origin.
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extId}/index.html`)
    await popup.evaluate(
      async ({ origin }) => {
        // Request permission first (this triggers the native prompt; Playwright
        // auto-accepts via the context setting below).
        await chrome.permissions.request({ origins: [`${origin}/*`] })
        await chrome.storage.local.set({
          configs: [
            {
              id: "test-1",
              label: "test",
              origin,
              projectKey: "rp_pk_" + "a".repeat(24),
              intakeEndpoint: "https://repro.example.com",
              createdAt: Date.now(),
            },
          ],
        })
      },
      { origin },
    )

    // Navigate to the configured origin. Wait for the SDK shadow-host to appear.
    const page = await context.newPage()
    await page.goto(origin)
    const host = page.locator("#repro-host")
    await expect(host).toBeAttached({ timeout: 10_000 })
  } finally {
    await context.close()
    server.close()
  }
})

test("does NOT inject on an unconfigured origin", async () => {
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(FIXTURE)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  const origin = `http://127.0.0.1:${address.port}`

  const userDataDir = mkdtempSync(resolve(tmpdir(), "repro-ext-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  })

  try {
    const page = await context.newPage()
    await page.goto(origin)
    // Wait a beat for any potential injection to fire.
    await page.waitForTimeout(2000)
    const host = page.locator("#repro-host")
    await expect(host).toHaveCount(0)
  } finally {
    await context.close()
    server.close()
  }
})
```

- [ ] **Step 4: Run the test**

Run: `bun run ext:build && cd apps/extension && bunx playwright install chromium && bunx playwright test`
Expected: Both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/playwright.config.ts apps/extension/tests
git commit -m "test(extension): playwright MV3 injection coverage"
```

---

## Task 11: Manual smoke test with dev dashboard

This task has no code changes — it verifies the end-to-end flow with a real dashboard.

- [ ] **Step 1: Start local dashboard + Docker**

Run (from repo root, in separate terminals):
```bash
bun run dev:docker
bun run dev
```

- [ ] **Step 2: Create a project with the tester's origin allowlisted**

In the dashboard, create a project. Add `http://127.0.0.1:5173` (Vite's default) to the project's allowed origins. Copy the project key (`rp_pk_...`) and note the dashboard URL (`http://localhost:3000` by default).

- [ ] **Step 3: Build and load the extension**

```bash
bun run ext:build
```
Then in Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `apps/extension/dist`.

- [ ] **Step 4: Configure one origin in the extension popup**

Click the extension icon. Enter:
- Label: "local"
- Origin: `http://127.0.0.1:5173`
- Project key: paste
- Intake endpoint: `http://localhost:3000`

Submit; accept the Chrome permission prompt.

- [ ] **Step 5: Verify injection on a test page**

Open `http://127.0.0.1:5173/` (or any page served on that origin — you can use `bun x serve apps/extension/tests/e2e/fixtures/ -l 5173` if no dev site is handy). The Repro launcher button should appear in the bottom-right.

- [ ] **Step 6: File a report and verify it lands in the dashboard inbox**

Click the launcher → annotate → submit. Switch to the dashboard → Tickets inbox → the new report should appear within a few seconds.

---

## Task 12: oxlint + oxfmt pass

- [ ] **Step 1: Format**

Run: `bun run fmt`
Expected: Files in `apps/extension/` formatted per repo conventions.

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: Zero new errors in `apps/extension/`. Pre-existing warnings elsewhere are fine.

- [ ] **Step 3: Commit if any changes**

```bash
git add -A
git commit -m "chore(extension): oxfmt + oxlint pass"
```

---

## Task 13: Update repo README / docs pointer

**Files:**
- Modify: `CLAUDE.md` (add brief extension entry to the Repository Layout section)

Skip if the extension is considered self-documenting via its spec + plan. If adding, keep it tight:

- [ ] **Step 1: Insert under `apps/` in CLAUDE.md §4**

Edit `CLAUDE.md`, find the `apps/` block in the Repository Layout tree, and add:

```
│   └── extension/              # Chrome MV3 extension for internal testers
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note apps/extension in repo layout"
```

---

## Self-Review Notes

Covered spec sections: scope (Task 1), package layout (Task 1), manifest (Task 1), data model (Task 2), adding origin (Task 8), injection (Task 6), removing origin (Task 7–8), CSP & security (built into Tasks 1 + 6 via `world:"MAIN"` + bundled asset), error handling (Task 6 swallows, Task 8 surfaces), testing (Tasks 2, 3, 10, 11), distribution (covered in the spec only — no code work needed until first release).

No placeholders; every code step has complete inline code. Types are consistent: `Config` and `ConfigInput` are defined in Task 2 and reused verbatim in Tasks 3, 7, 8, 10.
