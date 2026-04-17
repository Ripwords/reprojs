# Diagnostic Collectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four diagnostic collectors (console / network / cookies / `feedback.log()` breadcrumbs), expand the `systemInfo` snapshot, attach everything to reports via a new `logs` attachment with server-set content-type, and redesign the dashboard drawer as tabs. Bake in five security fixes: protocol-guarded `safeHref()`, URL query-param redaction, string-pattern scrubbers (JWT / PAT / Slack / AWS / Bearer), `beforeSend` sandbox with fail-open, and fetch/XHR clone-failure guards.

**Architecture:** Collectors live under `packages/ui/src/collectors/` as small modules around three shared primitives: a bounded ring buffer, a safe-serialize utility, and a redaction engine. `registerAllCollectors(config)` orchestrates them — starting at `init()`, flushing via `snapshotAll()` at submit time. The logs payload ships as a second multipart part to the existing intake endpoint, stored through the existing `StorageAdapter` as `kind='logs'`. Dashboard drawer gains tabs (Overview / Console / Network / Cookies) with lazy attachment fetching. Content-Type is always server-hardcoded per kind.

**Tech Stack:** Preact + `@preact/signals` (unchanged), raw Canvas 2D (unchanged), tsdown IIFE/ESM dual build (unchanged), `bun test` + happy-dom + `@napi-rs/canvas`, Zod schemas.

**Reference spec:** `docs/superpowers/specs/2026-04-17-diagnostic-collectors-design.md`

**Baseline:** tag `v0.3.0-annotation`. SDK IIFE currently 68 KB raw / 24 KB gzipped; D budget adds ≤ 8 KB gzipped.

---

## Phase 1 — Pure building blocks

### Task 1: RingBuffer with TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/ring-buffer.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/ring-buffer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/ring-buffer.test.ts
import { describe, expect, test } from "bun:test"
import { RingBuffer } from "./ring-buffer"

describe("RingBuffer", () => {
  test("push and drain preserve insertion order", () => {
    const b = new RingBuffer<number>(3)
    b.push(1); b.push(2); b.push(3)
    expect(b.drain()).toEqual([1, 2, 3])
  })

  test("evicts oldest when over capacity", () => {
    const b = new RingBuffer<number>(3)
    b.push(1); b.push(2); b.push(3); b.push(4); b.push(5)
    expect(b.drain()).toEqual([3, 4, 5])
  })

  test("drain returns a copy and does not clear", () => {
    const b = new RingBuffer<number>(3)
    b.push(1); b.push(2)
    const first = b.drain()
    first.push(999 as never)
    expect(b.drain()).toEqual([1, 2])
  })

  test("clear empties the buffer", () => {
    const b = new RingBuffer<number>(3)
    b.push(1); b.push(2)
    b.clear()
    expect(b.size()).toBe(0)
    expect(b.drain()).toEqual([])
  })

  test("size reflects current count", () => {
    const b = new RingBuffer<number>(3)
    expect(b.size()).toBe(0)
    b.push(1); b.push(2)
    expect(b.size()).toBe(2)
    b.push(3); b.push(4)
    expect(b.size()).toBe(3)
  })

  test("capacity of 1 keeps only latest", () => {
    const b = new RingBuffer<string>(1)
    b.push("a"); b.push("b")
    expect(b.drain()).toEqual(["b"])
  })
})
```

- [ ] **Step 2: Confirm failure**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/collectors/ring-buffer.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/ring-buffer.ts
export class RingBuffer<T> {
  private readonly items: T[] = []
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error("RingBuffer capacity must be >= 1")
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) this.items.shift()
  }

  drain(): T[] {
    return this.items.slice()
  }

  clear(): void {
    this.items.length = 0
  }

  size(): number {
    return this.items.length
  }
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/collectors/ring-buffer.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/ring-buffer.ts packages/ui/src/collectors/ring-buffer.test.ts
git commit -m "feat(sdk-ui): add bounded RingBuffer for collectors"
```

---

### Task 2: Safe serializer with string-scrubber support + TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/serialize.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/serialize.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/collectors/serialize.test.ts
import { beforeAll, describe, expect, test } from "bun:test"
import { serializeArg, truncate, scrubString, DEFAULT_STRING_REDACTORS } from "./serialize"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})

describe("truncate", () => {
  test("no-op when under limit", () => {
    expect(truncate("hello", 100)).toBe("hello")
  })
  test("truncates with suffix when over limit", () => {
    const out = truncate("x".repeat(100), 20)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out).toContain("[truncated")
  })
  test("preserves multi-byte UTF-8 at boundary", () => {
    const out = truncate("héllo wörld " + "x".repeat(100), 14)
    // Must not split surrogate/multi-byte bytes mid-char
    expect(() => new TextEncoder().encode(out)).not.toThrow()
  })
})

describe("scrubString", () => {
  test("replaces JWT with REDACTED", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123_def"
    expect(scrubString(`token: ${jwt}`, DEFAULT_STRING_REDACTORS)).toBe("token: REDACTED")
  })
  test("replaces Bearer tokens", () => {
    expect(scrubString("Authorization: Bearer abc.def.ghi", DEFAULT_STRING_REDACTORS))
      .toBe("Authorization: REDACTED")
  })
  test("replaces GitHub PAT / AWS key / Slack token", () => {
    const out = scrubString(
      "gh: ghp_1234567890abcdefghijklmnopqrstuvwxyz0 aws: AKIAIOSFODNN7EXAMPLE slack: xoxb-abc-def-ghi",
      DEFAULT_STRING_REDACTORS,
    )
    expect(out).toContain("gh: REDACTED")
    expect(out).toContain("aws: REDACTED")
    expect(out).toContain("slack: REDACTED")
  })
  test("empty patterns array is a no-op", () => {
    expect(scrubString("anything at all", [])).toBe("anything at all")
  })
})

describe("serializeArg", () => {
  test("primitives", () => {
    expect(serializeArg("hi", 100, [])).toBe('"hi"')
    expect(serializeArg(42, 100, [])).toBe("42")
    expect(serializeArg(true, 100, [])).toBe("true")
    expect(serializeArg(null, 100, [])).toBe("null")
    expect(serializeArg(undefined, 100, [])).toBe("undefined")
  })
  test("NaN and Infinity", () => {
    expect(serializeArg(Number.NaN, 100, [])).toBe("NaN")
    expect(serializeArg(Number.POSITIVE_INFINITY, 100, [])).toBe("Infinity")
  })
  test("Error includes name + message + stack", () => {
    const e = new Error("boom")
    const out = serializeArg(e, 1000, [])
    expect(out).toContain("Error: boom")
  })
  test("circular reference becomes [Circular]", () => {
    const o: { self?: unknown } = {}
    o.self = o
    const out = serializeArg(o, 200, [])
    expect(out).toContain("[Circular]")
  })
  test("function becomes [Function]", () => {
    expect(serializeArg(() => 1, 100, [])).toBe("[Function]")
  })
  test("truncates long strings", () => {
    const long = "x".repeat(1000)
    const out = serializeArg(long, 50, [])
    expect(out.length).toBeLessThan(100)
    expect(out).toContain("[truncated")
  })
  test("applies string scrubbers after truncation", () => {
    const obj = { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc" }
    const out = serializeArg(obj, 500, DEFAULT_STRING_REDACTORS)
    expect(out).toContain("REDACTED")
    expect(out).not.toContain("eyJhbGci")
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/serialize.ts
export const DEFAULT_STRING_REDACTORS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.?[A-Za-z0-9_.+/=-]*/g,
  /gh[ps]_[A-Za-z0-9]{36,}/g,
  /xox[abp]-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
]

export function scrubString(s: string, patterns: readonly RegExp[]): string {
  let out = s
  for (const re of patterns) out = out.replace(re, "REDACTED")
  return out
}

export function truncate(s: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  const buf = encoder.encode(s)
  if (buf.length <= maxBytes) return s
  // Walk back from maxBytes to nearest complete UTF-8 codepoint boundary
  let cut = maxBytes
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1
  const truncated = new TextDecoder().decode(buf.slice(0, cut))
  return `${truncated}… [truncated ${buf.length - cut}b]`
}

export function serializeArg(
  v: unknown,
  maxBytes: number,
  redactors: readonly RegExp[],
): string {
  let raw: string
  try {
    raw = safeStringify(v)
  } catch {
    raw = "[Unserializable]"
  }
  return scrubString(truncate(raw, maxBytes), redactors)
}

function safeStringify(v: unknown): string {
  if (v === undefined) return "undefined"
  if (v === null) return "null"
  if (typeof v === "function") return "[Function]"
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN"
    if (!Number.isFinite(v)) return v > 0 ? "Infinity" : "-Infinity"
    return String(v)
  }
  if (typeof v === "string") return JSON.stringify(v)
  if (typeof v === "boolean" || typeof v === "bigint") return String(v)
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`
  }
  if (ArrayBuffer.isView(v)) {
    const ta = v as unknown as { length: number; constructor: { name: string } }
    return `[${ta.constructor.name} length=${ta.length}]`
  }
  const seen = new WeakSet<object>()
  return JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    if (typeof value === "function") return "[Function]"
    if (typeof value === "bigint") return String(value)
    return value
  })
}
```

- [ ] **Step 4: Confirm pass**

Run: `cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test src/collectors/serialize.test.ts`
Expected: 11/11 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/serialize.ts packages/ui/src/collectors/serialize.test.ts
git commit -m "feat(sdk-ui): add safe serializer with truncation + default string redactors"
```

---

### Task 3: Redaction engine TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/redact.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/redact.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/src/collectors/redact.test.ts
import { describe, expect, test } from "bun:test"
import {
  DEFAULT_ALLOWED_REQUEST_HEADERS,
  DEFAULT_ALLOWED_RESPONSE_HEADERS,
  DEFAULT_REDACTED_QUERY_PARAMS,
  DEFAULT_SENSITIVE_COOKIE_NAMES,
  redactBody,
  redactCookies,
  redactHeaders,
  redactUrl,
} from "./redact"

describe("redactCookies", () => {
  test("redacts denylist names case-insensitively", () => {
    const out = redactCookies([
      { name: "session", value: "abc" },
      { name: "SessionId", value: "xyz" },
      { name: "locale", value: "en" },
    ])
    expect(out).toEqual([
      { name: "session", value: "<redacted>" },
      { name: "SessionId", value: "<redacted>" },
      { name: "locale", value: "en" },
    ])
  })

  test("strips __Secure- and __Host- prefixes before matching", () => {
    const out = redactCookies([
      { name: "__Secure-session", value: "s" },
      { name: "__Host-auth", value: "a" },
    ])
    expect(out.every((c) => c.value === "<redacted>")).toBe(true)
  })

  test("allowNames overrides redaction", () => {
    const out = redactCookies(
      [{ name: "session", value: "keepme" }],
      { allowNames: ["session"] },
    )
    expect(out[0].value).toBe("keepme")
  })

  test("maskNames extends the defaults", () => {
    const out = redactCookies(
      [{ name: "my_custom_id", value: "abc" }],
      { maskNames: ["custom_id"] },
    )
    expect(out[0].value).toBe("<redacted>")
  })
})

describe("redactHeaders", () => {
  test("request headers allowlist strips unlisted", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", Authorization: "Bearer x", "X-Custom": "y" },
      "request",
    )
    expect(out).toEqual({ "content-type": "application/json" })
  })

  test("response headers allowlist strips unlisted", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", "Set-Cookie": "x", ETag: "abc" },
      "response",
    )
    expect(Object.keys(out).sort()).toEqual(["content-type", "etag"])
  })

  test("all: true passes everything through (lowercased)", () => {
    const out = redactHeaders({ Authorization: "Bearer x" }, "request", { all: true })
    expect(out).toEqual({ authorization: "Bearer x" })
  })

  test("extra allowed headers merge with defaults", () => {
    const out = redactHeaders(
      { "Content-Type": "application/json", "X-Feature": "on", Authorization: "Bearer x" },
      "request",
      { allowed: ["x-feature"] },
    )
    expect(out).toEqual({
      "content-type": "application/json",
      "x-feature": "on",
    })
  })
})

describe("redactUrl", () => {
  test("scrubs default sensitive params", () => {
    const out = redactUrl("https://api.example.com/x?api_key=secret&debug=1")
    expect(out).toBe("https://api.example.com/x?api_key=REDACTED&debug=1")
  })

  test("preserves non-sensitive params", () => {
    const out = redactUrl("https://api.example.com/x?page=2&limit=10")
    expect(out).toBe("https://api.example.com/x?page=2&limit=10")
  })

  test("leaves unparseable URLs alone", () => {
    expect(redactUrl("not a url")).toBe("not a url")
  })

  test("accepts custom redact key list", () => {
    const out = redactUrl("https://x/y?custom_key=secret&page=1", ["custom_key"])
    expect(out).toBe("https://x/y?custom_key=REDACTED&page=1")
  })
})

describe("redactBody", () => {
  test("returns null for null input", () => {
    expect(redactBody(null, { maxBytes: 100 })).toBeNull()
  })

  test("truncates when over maxBytes", () => {
    const out = redactBody("x".repeat(1000), { maxBytes: 50 })
    expect(out?.length).toBeLessThan(100)
    expect(out).toContain("[truncated")
  })

  test("leaves small bodies alone", () => {
    expect(redactBody("small", { maxBytes: 100 })).toBe("small")
  })
})

describe("exported constants", () => {
  test("default arrays are non-empty", () => {
    expect(DEFAULT_SENSITIVE_COOKIE_NAMES.length).toBeGreaterThan(5)
    expect(DEFAULT_ALLOWED_REQUEST_HEADERS).toContain("content-type")
    expect(DEFAULT_ALLOWED_RESPONSE_HEADERS).toContain("etag")
    expect(DEFAULT_REDACTED_QUERY_PARAMS).toContain("api_key")
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/redact.ts
import { truncate } from "./serialize"

export const DEFAULT_SENSITIVE_COOKIE_NAMES = [
  "session", "sid", "auth", "token", "csrf", "jwt",
  "api_key", "access_token", "refresh_token",
  "_session", "connect.sid", "laravel_session", "phpsessid", "jsessionid",
] as const

export const DEFAULT_ALLOWED_REQUEST_HEADERS = [
  "content-type", "content-length", "accept", "accept-language",
  "cache-control", "x-request-id", "x-correlation-id",
] as const

export const DEFAULT_ALLOWED_RESPONSE_HEADERS = [
  "content-type", "content-length", "cache-control", "etag",
  "x-request-id", "x-correlation-id", "retry-after",
] as const

export const DEFAULT_REDACTED_QUERY_PARAMS = [
  "api_key", "apikey", "access_token", "refresh_token",
  "token", "password", "secret", "code", "state",
  "sig", "signature", "authorization",
] as const

export interface CookieEntry {
  name: string
  value: string
}

export interface CookieRedactConfig {
  maskNames?: readonly string[]
  allowNames?: readonly string[]
}

function stripPrefix(name: string): string {
  return name
    .replace(/^__Secure-/i, "")
    .replace(/^__Host-/i, "")
}

function isSensitiveCookie(name: string, deny: readonly string[]): boolean {
  const lowered = stripPrefix(name).toLowerCase()
  return deny.some((d) => lowered.includes(d.toLowerCase()))
}

export function redactCookies(raw: CookieEntry[], opts: CookieRedactConfig = {}): CookieEntry[] {
  const deny = [...DEFAULT_SENSITIVE_COOKIE_NAMES, ...(opts.maskNames ?? [])]
  const allow = new Set((opts.allowNames ?? []).map((n) => n.toLowerCase()))
  return raw.map((c) => ({
    name: c.name,
    value: allow.has(c.name.toLowerCase())
      ? c.value
      : isSensitiveCookie(c.name, deny)
        ? "<redacted>"
        : c.value,
  }))
}

export interface HeaderRedactOpts {
  allowed?: readonly string[]
  all?: boolean
}

export function redactHeaders(
  headers: Record<string, string>,
  kind: "request" | "response",
  opts: HeaderRedactOpts = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  if (opts.all) {
    for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v
    return out
  }
  const base = kind === "request" ? DEFAULT_ALLOWED_REQUEST_HEADERS : DEFAULT_ALLOWED_RESPONSE_HEADERS
  const allow = new Set([...base, ...(opts.allowed ?? [])].map((h) => h.toLowerCase()))
  for (const [k, v] of Object.entries(headers)) {
    if (allow.has(k.toLowerCase())) out[k.toLowerCase()] = v
  }
  return out
}

export function redactUrl(
  url: string,
  redactKeys: readonly string[] = DEFAULT_REDACTED_QUERY_PARAMS,
): string {
  try {
    const u = new URL(url)
    const deny = new Set(redactKeys.map((k) => k.toLowerCase()))
    for (const key of [...u.searchParams.keys()]) {
      if (deny.has(key.toLowerCase())) u.searchParams.set(key, "REDACTED")
    }
    return u.toString()
  } catch {
    return url
  }
}

export function redactBody(body: string | null, opts: { maxBytes: number }): string | null {
  if (body === null) return null
  return truncate(body, opts.maxBytes)
}
```

- [ ] **Step 4: Confirm pass**

Expected: 15/15 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/redact.ts packages/ui/src/collectors/redact.test.ts
git commit -m "feat(sdk-ui): add redaction engine (cookies, headers, URL params, bodies)"
```

---

## Phase 2 — Collectors

### Task 4: System-info snapshot TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/system-info.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/system-info.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/system-info.test.ts
import { beforeAll, describe, expect, test } from "bun:test"
import { snapshotSystemInfo } from "./system-info"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost:4000/app?x=1" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    screen: win.screen,
    Intl: globalThis.Intl,
  })
})

describe("snapshotSystemInfo", () => {
  test("returns a well-shaped object", () => {
    const s = snapshotSystemInfo()
    expect(typeof s.userAgent).toBe("string")
    expect(typeof s.platform).toBe("string")
    expect(typeof s.language).toBe("string")
    expect(typeof s.timezone).toBe("string")
    expect(typeof s.timezoneOffset).toBe("number")
    expect(s.viewport.w).toBeGreaterThan(0)
    expect(s.viewport.h).toBeGreaterThan(0)
    expect(s.dpr).toBeGreaterThan(0)
    expect(typeof s.online).toBe("boolean")
    expect(s.pageUrl).toBe("http://localhost:4000/app?x=1")
    expect(s.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test("connection is omitted when navigator.connection is undefined", () => {
    const s = snapshotSystemInfo()
    // happy-dom doesn't provide navigator.connection
    expect(s.connection).toBeUndefined()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/system-info.ts
import type { SystemInfo } from "@feedback-tool/shared"

interface NetworkInformationLike {
  effectiveType?: string
  rtt?: number
  downlink?: number
}

export function snapshotSystemInfo(): SystemInfo {
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return "UTC"
    }
  })()
  const offset = -new Date().getTimezoneOffset()
  const conn = (navigator as unknown as { connection?: NetworkInformationLike }).connection
  const referrer = document.referrer || undefined
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    timezone: tz,
    timezoneOffset: offset,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    screen: { w: window.screen.width, h: window.screen.height },
    dpr: window.devicePixelRatio || 1,
    online: navigator.onLine,
    connection: conn
      ? { effectiveType: conn.effectiveType, rtt: conn.rtt, downlink: conn.downlink }
      : undefined,
    pageUrl: location.href,
    referrer,
    documentReferrer: referrer,
    timestamp: new Date().toISOString(),
  }
}
```

> **Note:** `SystemInfo` import from `@feedback-tool/shared` doesn't exist yet — it lands in Task 11. The test at Task 4 time will fail to resolve the type. **Temporary workaround for Task 4:** inline the `SystemInfo` interface at the top of `system-info.ts` with the shape listed in the spec §4.1, then delete it and switch to the shared import in Task 11.

Inline the interface during Task 4:

```ts
// TEMP until Task 11 adds the shared export; will be replaced with:
//   import type { SystemInfo } from "@feedback-tool/shared"
interface SystemInfo {
  userAgent: string
  platform: string
  language: string
  timezone: string
  timezoneOffset: number
  viewport: { w: number; h: number }
  screen: { w: number; h: number }
  dpr: number
  online: boolean
  connection?: { effectiveType?: string; rtt?: number; downlink?: number }
  pageUrl: string
  referrer?: string
  documentReferrer?: string
  timestamp: string
}
```

- [ ] **Step 4: Confirm pass**

Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/system-info.ts packages/ui/src/collectors/system-info.test.ts
git commit -m "feat(sdk-ui): add systemInfo snapshot with inline type (swapped in Task 11)"
```

---

### Task 5: Cookies collector TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/cookies.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/cookies.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/cookies.test.ts
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { createCookiesCollector } from "./cookies"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, { window: win, document: win.document })
})

beforeEach(() => {
  // Wipe cookies between tests
  for (const c of document.cookie.split(";")) {
    const name = c.split("=")[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`
  }
})

describe("cookies collector", () => {
  test("empty cookie string yields empty array", () => {
    const c = createCookiesCollector({})
    c.start({})
    expect(c.snapshot()).toEqual([])
  })

  test("parses name=value pairs", () => {
    document.cookie = "a=1"
    document.cookie = "b=2"
    const c = createCookiesCollector({})
    c.start({})
    const snap = c.snapshot()
    expect(snap).toContainEqual({ name: "a", value: "1" })
    expect(snap).toContainEqual({ name: "b", value: "2" })
  })

  test("applies default redaction to sensitive names", () => {
    document.cookie = "session=abc"
    document.cookie = "locale=en"
    const c = createCookiesCollector({})
    c.start({})
    const snap = c.snapshot()
    expect(snap.find((e) => e.name === "session")?.value).toBe("<redacted>")
    expect(snap.find((e) => e.name === "locale")?.value).toBe("en")
  })

  test("snapshot is pure — re-reading sees new cookies", () => {
    const c = createCookiesCollector({})
    c.start({})
    expect(c.snapshot()).toEqual([])
    document.cookie = "fresh=1"
    expect(c.snapshot()).toContainEqual({ name: "fresh", value: "1" })
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/cookies.ts
import { type CookieEntry, redactCookies } from "./redact"

export interface CookiesCollectorConfig {
  maskNames?: string[]
  allowNames?: string[]
  enabled?: boolean
}

export interface CookiesCollector {
  start(config: CookiesCollectorConfig): void
  snapshot(): CookieEntry[]
  stop(): void
}

export function createCookiesCollector(initial: CookiesCollectorConfig): CookiesCollector {
  let config: CookiesCollectorConfig = initial
  let running = false
  return {
    start(c) {
      config = c
      running = true
    },
    snapshot() {
      if (!running || config.enabled === false) return []
      if (typeof document === "undefined" || !document.cookie) return []
      const raw: CookieEntry[] = document.cookie
        .split(";")
        .map((pair) => pair.trim())
        .filter((p) => p.length > 0)
        .map((pair) => {
          const idx = pair.indexOf("=")
          if (idx < 0) return { name: pair, value: "" }
          return { name: pair.slice(0, idx), value: pair.slice(idx + 1) }
        })
      return redactCookies(raw, {
        maskNames: config.maskNames,
        allowNames: config.allowNames,
      })
    },
    stop() {
      running = false
    },
  }
}
```

- [ ] **Step 4: Confirm pass**

Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/cookies.ts packages/ui/src/collectors/cookies.test.ts
git commit -m "feat(sdk-ui): add cookies collector with redaction"
```

---

### Task 6: Breadcrumbs collector TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/breadcrumbs.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/breadcrumbs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/breadcrumbs.test.ts
import { describe, expect, test } from "bun:test"
import { createBreadcrumbsCollector } from "./breadcrumbs"

describe("breadcrumbs collector", () => {
  test("records an event with default level info", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("checkout.started")
    const [e] = b.snapshot()
    expect(e?.event).toBe("checkout.started")
    expect(e?.level).toBe("info")
    expect(e?.data).toBeUndefined()
  })

  test("records data payload", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("user.identified", { id: 42, paid: true })
    expect(b.snapshot()[0]?.data).toEqual({ id: 42, paid: true })
  })

  test("explicit level overrides default", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 10 })
    b.breadcrumb("boom", { code: 500 }, "error")
    expect(b.snapshot()[0]?.level).toBe("error")
  })

  test("respects maxEntries via ring buffer", () => {
    const b = createBreadcrumbsCollector({})
    b.start({ maxEntries: 3 })
    for (const i of [1, 2, 3, 4, 5]) b.breadcrumb(`evt-${i}`)
    const snap = b.snapshot()
    expect(snap.length).toBe(3)
    expect(snap.map((e) => e.event)).toEqual(["evt-3", "evt-4", "evt-5"])
  })

  test("breadcrumb is a no-op before start()", () => {
    const b = createBreadcrumbsCollector({})
    b.breadcrumb("before-start")
    expect(b.snapshot()).toEqual([])
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/breadcrumbs.ts
import { RingBuffer } from "./ring-buffer"

export type BreadcrumbLevel = "debug" | "info" | "warn" | "error"

export interface Breadcrumb {
  ts: number
  event: string
  level: BreadcrumbLevel
  data?: Record<string, string | number | boolean | null>
}

export interface BreadcrumbsConfig {
  maxEntries?: number
  maxDataBytes?: number
  enabled?: boolean
}

export interface BreadcrumbsCollector {
  start(config: BreadcrumbsConfig): void
  snapshot(): Breadcrumb[]
  stop(): void
  breadcrumb: (
    event: string,
    data?: Record<string, string | number | boolean | null>,
    level?: BreadcrumbLevel,
  ) => void
}

export function createBreadcrumbsCollector(_initial: BreadcrumbsConfig): BreadcrumbsCollector {
  let buffer: RingBuffer<Breadcrumb> | null = null
  let running = false
  let enabled = true
  return {
    start(config) {
      enabled = config.enabled !== false
      buffer = new RingBuffer<Breadcrumb>(config.maxEntries ?? 50)
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    stop() {
      running = false
      buffer = null
    },
    breadcrumb(event, data, level = "info") {
      if (!running || !enabled || !buffer) return
      buffer.push({
        ts: Date.now(),
        event: event.length > 200 ? event.slice(0, 200) : event,
        level,
        ...(data ? { data } : {}),
      })
    },
  }
}
```

- [ ] **Step 4: Confirm pass**

Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/breadcrumbs.ts packages/ui/src/collectors/breadcrumbs.test.ts
git commit -m "feat(sdk-ui): add breadcrumbs collector backing feedback.log()"
```

---

### Task 7: Console collector TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/console.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/console.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/console.test.ts
import { afterEach, describe, expect, test } from "bun:test"
import { createConsoleCollector } from "./console"

describe("console collector", () => {
  const created: Array<ReturnType<typeof createConsoleCollector>> = []
  afterEach(() => {
    for (const c of created.splice(0)) c.stop()
  })

  test("captures console.log with level 'log'", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({ maxEntries: 10, maxArgBytes: 1000, maxEntryBytes: 10_000 })
    console.log("hello", 42)
    const snap = c.snapshot()
    expect(snap.length).toBe(1)
    expect(snap[0]?.level).toBe("log")
    expect(snap[0]?.args[0]).toContain("hello")
    expect(snap[0]?.args[1]).toBe("42")
  })

  test("console.error includes stack", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.error("boom")
    expect(c.snapshot()[0]?.stack).toBeDefined()
  })

  test("console.log does NOT capture stack", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.log("noisy")
    expect(c.snapshot()[0]?.stack).toBeUndefined()
  })

  test("calls the original console method", () => {
    const orig = console.log
    const seen: unknown[][] = []
    console.log = (...a: unknown[]) => {
      seen.push(a)
    }
    const c = createConsoleCollector({})
    created.push(c)
    c.start({})
    console.log("x")
    expect(seen).toEqual([["x"]])
    console.log = orig
  })

  test("stop restores the original console methods", () => {
    const orig = console.log
    const c = createConsoleCollector({})
    c.start({})
    expect(console.log).not.toBe(orig)
    c.stop()
    expect(console.log).toBe(orig)
  })

  test("ring buffer evicts oldest beyond maxEntries", () => {
    const c = createConsoleCollector({})
    created.push(c)
    c.start({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) console.log(`m-${i}`)
    const snap = c.snapshot()
    expect(snap.length).toBe(3)
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/console.ts
import { RingBuffer } from "./ring-buffer"
import { serializeArg } from "./serialize"

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug"

export interface ConsoleEntry {
  level: ConsoleLevel
  ts: number
  args: string[]
  stack?: string
}

export interface ConsoleConfig {
  maxEntries?: number
  maxArgBytes?: number
  maxEntryBytes?: number
  enabled?: boolean
  stringRedactors?: RegExp[]
}

export interface ConsoleCollector {
  start(config: ConsoleConfig): void
  snapshot(): ConsoleEntry[]
  stop(): void
}

const METHODS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"]

export function createConsoleCollector(_initial: ConsoleConfig): ConsoleCollector {
  let buffer: RingBuffer<ConsoleEntry> | null = null
  const originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {}
  let running = false
  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      const maxArg = config.maxArgBytes ?? 1024
      const redactors = config.stringRedactors ?? []
      buffer = new RingBuffer<ConsoleEntry>(config.maxEntries ?? 100)
      for (const level of METHODS) {
        const orig = console[level].bind(console)
        originals[level] = orig
        console[level] = (...args: unknown[]) => {
          try {
            const serialized = args.map((a) => serializeArg(a, maxArg, redactors))
            const entry: ConsoleEntry = {
              level,
              ts: Date.now(),
              args: serialized,
            }
            if (level === "warn" || level === "error") {
              entry.stack = new Error("trace").stack ?? undefined
            }
            buffer?.push(entry)
          } catch {
            // Never let collector throw into host code
          }
          orig(...args)
        }
      }
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    stop() {
      if (!running) return
      for (const level of METHODS) {
        const o = originals[level]
        if (o) console[level] = o
      }
      for (const key of Object.keys(originals) as ConsoleLevel[]) delete originals[key]
      buffer = null
      running = false
    },
  }
}
```

- [ ] **Step 4: Confirm pass**

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/console.ts packages/ui/src/collectors/console.test.ts
git commit -m "feat(sdk-ui): add console collector (log/info/warn/error/debug) with stack on warn+error"
```

---

### Task 8: Network collector (fetch + XHR) TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/network.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/network.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/network.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { createNetworkCollector } from "./network"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window()
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    XMLHttpRequest: win.XMLHttpRequest,
  })
})

describe("network collector — fetch", () => {
  const created: Array<ReturnType<typeof createNetworkCollector>> = []
  afterEach(() => {
    for (const c of created.splice(0)) c.stop()
  })

  test("records a successful fetch with status + duration", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ maxEntries: 10 })
    await fetch("http://example.com/x")
    const entry = c.snapshot()[0]
    expect(entry?.method).toBe("GET")
    expect(entry?.url).toBe("http://example.com/x")
    expect(entry?.status).toBe(200)
    expect(entry?.initiator).toBe("fetch")
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0)
    globalThis.fetch = originalFetch
  })

  test("records a failed fetch with status null + error", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      throw new Error("offline")
    }
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x").catch(() => {})
    const entry = c.snapshot()[0]
    expect(entry?.status).toBeNull()
    expect(entry?.error).toContain("offline")
    globalThis.fetch = originalFetch
  })

  test("redacts sensitive query params in URL", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x?api_key=secret&debug=1")
    const entry = c.snapshot()[0]
    expect(entry?.url).toContain("api_key=REDACTED")
    expect(entry?.url).toContain("debug=1")
    globalThis.fetch = originalFetch
  })

  test("does not capture bodies by default", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({})
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBeUndefined()
    expect(entry?.responseBody).toBeUndefined()
    globalThis.fetch = originalFetch
  })

  test("captures bodies when opted in", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response("hello body")
    const c = createNetworkCollector({})
    created.push(c)
    c.start({ requestBody: true, responseBody: true, maxBodyBytes: 1024 })
    await fetch("http://example.com/x", { method: "POST", body: "hi" })
    const entry = c.snapshot()[0]
    expect(entry?.requestBody).toBe("hi")
    expect(entry?.responseBody).toBe("hello body")
    globalThis.fetch = originalFetch
  })

  test("stop restores the original fetch", async () => {
    const originalFetch = globalThis.fetch
    const c = createNetworkCollector({})
    c.start({})
    expect(globalThis.fetch).not.toBe(originalFetch)
    c.stop()
    expect(globalThis.fetch).toBe(originalFetch)
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/network.ts
import { RingBuffer } from "./ring-buffer"
import { redactBody, redactHeaders, redactUrl } from "./redact"

export interface NetworkEntry {
  id: string
  ts: number
  method: string
  url: string
  status: number | null
  durationMs: number | null
  size: number | null
  initiator: "fetch" | "xhr"
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  error?: string
}

export interface NetworkConfig {
  maxEntries?: number
  requestBody?: boolean
  responseBody?: boolean
  maxBodyBytes?: number
  allowedHeaders?: string[]
  allHeaders?: boolean
  redactQueryParams?: boolean
  enabled?: boolean
}

export interface NetworkCollector {
  start(config: NetworkConfig): void
  snapshot(): NetworkEntry[]
  stop(): void
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function headersToObject(h: Headers | Record<string, string> | undefined): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  return { ...h }
}

export function createNetworkCollector(_initial: NetworkConfig): NetworkCollector {
  let buffer: RingBuffer<NetworkEntry> | null = null
  let originalFetch: typeof globalThis.fetch | null = null
  let originalXHROpen: XMLHttpRequest["open"] | null = null
  let originalXHRSend: XMLHttpRequest["send"] | null = null
  let running = false
  let cfg: NetworkConfig = {}

  function wrapFetch() {
    const orig = globalThis.fetch
    originalFetch = orig
    const maxBody = cfg.maxBodyBytes ?? 16_384
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET")
      const rawUrl =
        input instanceof Request ? input.url : typeof input === "string" ? input : input.toString()
      const url = cfg.redactQueryParams === false ? rawUrl : redactUrl(rawUrl)
      const started = performance.now()
      const ts = Date.now()
      const id = uid()

      let requestBody: string | undefined
      let requestHeaders: Record<string, string> | undefined
      if (cfg.requestBody && typeof init?.body === "string") {
        requestBody = redactBody(init.body, { maxBytes: maxBody }) ?? undefined
      }
      if (init?.headers) {
        const raw = headersToObject(init.headers as Headers | Record<string, string>)
        requestHeaders = redactHeaders(raw, "request", {
          allowed: cfg.allowedHeaders,
          all: cfg.allHeaders,
        })
      }

      try {
        const res = await orig(input, init)
        const durationMs = performance.now() - started
        const responseHeaders = redactHeaders(headersToObject(res.headers), "response", {
          allowed: cfg.allowedHeaders,
          all: cfg.allHeaders,
        })
        let responseBody: string | undefined
        let size: number | null = null
        if (cfg.responseBody) {
          try {
            const clone = res.clone()
            const text = await clone.text()
            size = text.length
            responseBody = redactBody(text, { maxBytes: maxBody }) ?? undefined
          } catch {
            responseBody = undefined
          }
        }
        buffer?.push({
          id,
          ts,
          method,
          url,
          status: res.status,
          durationMs,
          size,
          initiator: "fetch",
          requestHeaders,
          responseHeaders,
          requestBody,
          responseBody,
        })
        return res
      } catch (err) {
        const durationMs = performance.now() - started
        buffer?.push({
          id,
          ts,
          method,
          url,
          status: null,
          durationMs,
          size: null,
          initiator: "fetch",
          requestHeaders,
          requestBody,
          error: err instanceof Error ? err.message : String(err),
        })
        throw err
      }
    }
  }

  function wrapXHR() {
    const proto = XMLHttpRequest.prototype
    const origOpen = proto.open
    const origSend = proto.send
    originalXHROpen = origOpen
    originalXHRSend = origSend
    type Patched = XMLHttpRequest & {
      __ftMethod?: string
      __ftUrl?: string
      __ftStart?: number
      __ftId?: string
      __ftTs?: number
    }
    proto.open = function (this: Patched, method: string, url: string, ...rest: unknown[]) {
      this.__ftMethod = method
      this.__ftUrl = cfg.redactQueryParams === false ? url : redactUrl(url)
      this.__ftId = uid()
      return origOpen.call(this as XMLHttpRequest, method, url, ...(rest as [boolean?]))
    }
    proto.send = function (this: Patched, body?: Document | XMLHttpRequestBodyInit | null) {
      this.__ftStart = performance.now()
      this.__ftTs = Date.now()
      this.addEventListener("loadend", () => {
        const durationMs =
          this.__ftStart !== undefined ? performance.now() - this.__ftStart : null
        buffer?.push({
          id: this.__ftId ?? uid(),
          ts: this.__ftTs ?? Date.now(),
          method: this.__ftMethod ?? "GET",
          url: this.__ftUrl ?? "",
          status: this.status || null,
          durationMs,
          size: typeof this.response === "string" ? this.response.length : null,
          initiator: "xhr",
          requestBody:
            cfg.requestBody && typeof body === "string"
              ? redactBody(body, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined
              : undefined,
          responseBody:
            cfg.responseBody && typeof this.response === "string"
              ? redactBody(this.response, { maxBytes: cfg.maxBodyBytes ?? 16_384 }) ?? undefined
              : undefined,
          error: this.status === 0 ? "network error" : undefined,
        })
      })
      return origSend.call(this as XMLHttpRequest, body as BodyInit | null | undefined)
    }
  }

  return {
    start(config) {
      if (running) return
      if (config.enabled === false) return
      cfg = config
      buffer = new RingBuffer<NetworkEntry>(config.maxEntries ?? 50)
      if (typeof globalThis.fetch === "function") wrapFetch()
      if (typeof XMLHttpRequest !== "undefined") wrapXHR()
      running = true
    },
    snapshot() {
      return buffer?.drain() ?? []
    },
    stop() {
      if (!running) return
      if (originalFetch) globalThis.fetch = originalFetch
      if (originalXHROpen) XMLHttpRequest.prototype.open = originalXHROpen
      if (originalXHRSend) XMLHttpRequest.prototype.send = originalXHRSend
      originalFetch = null
      originalXHROpen = null
      originalXHRSend = null
      buffer = null
      running = false
    },
  }
}
```

- [ ] **Step 4: Confirm pass**

Expected: 6/6 PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/network.ts packages/ui/src/collectors/network.test.ts
git commit -m "feat(sdk-ui): add network collector (fetch + XHR) with body/header/URL redaction"
```

---

### Task 9: Orchestration — `registerAllCollectors` TDD

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/index.ts`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/index.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/ui/src/collectors/index.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { registerAllCollectors, type PendingReport } from "./index"

beforeAll(async () => {
  const { Window } = await import("happy-dom")
  const win = new Window({ url: "http://localhost/" })
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    location: win.location,
    navigator: win.navigator,
    screen: win.screen,
  })
})

describe("registerAllCollectors", () => {
  const stops: Array<() => void> = []
  afterEach(() => {
    for (const s of stops.splice(0)) s()
  })

  test("snapshotAll returns systemInfo + cookies + logs shape", () => {
    const { snapshotAll, stopAll } = registerAllCollectors({})
    stops.push(stopAll)
    const snap = snapshotAll()
    expect(snap.systemInfo).toBeDefined()
    expect(Array.isArray(snap.cookies)).toBe(true)
    expect(snap.logs.version).toBe(1)
    expect(Array.isArray(snap.logs.console)).toBe(true)
    expect(Array.isArray(snap.logs.network)).toBe(true)
    expect(Array.isArray(snap.logs.breadcrumbs)).toBe(true)
    expect(snap.logs.config.capturesBodies).toBe(false)
    expect(snap.logs.config.capturesAllHeaders).toBe(false)
  })

  test("breadcrumb exposed and routed", () => {
    const { snapshotAll, stopAll, breadcrumb } = registerAllCollectors({})
    stops.push(stopAll)
    breadcrumb("checkout.done", { amount: 42 })
    expect(snapshotAll().logs.breadcrumbs[0]?.event).toBe("checkout.done")
  })

  test("applyBeforeSend returns original when hook returns undefined (bypass)", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({})
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)).toBe(r)
  })

  test("applyBeforeSend returns hook result", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({
      beforeSend: (r) => ({ ...r, title: "changed" }),
    })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)?.title).toBe("changed")
  })

  test("applyBeforeSend fails open when hook throws", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({
      beforeSend: () => {
        throw new Error("oops")
      },
    })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "kept",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    const result = applyBeforeSend(r)
    expect(result?.title).toBe("kept")
  })

  test("applyBeforeSend null return aborts", () => {
    const { applyBeforeSend, stopAll } = registerAllCollectors({ beforeSend: () => null })
    stops.push(stopAll)
    const r: PendingReport = {
      title: "t",
      description: "",
      context: { pageUrl: "http://x", userAgent: "", viewport: { w: 1, h: 1 }, timestamp: "" },
      logs: null,
      screenshot: null,
    }
    expect(applyBeforeSend(r)).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm failure**

- [ ] **Step 3: Implement**

```ts
// packages/ui/src/collectors/index.ts
import { type BreadcrumbLevel, createBreadcrumbsCollector } from "./breadcrumbs"
import { createConsoleCollector } from "./console"
import { createCookiesCollector } from "./cookies"
import { createNetworkCollector } from "./network"
import { DEFAULT_STRING_REDACTORS } from "./serialize"
import { snapshotSystemInfo } from "./system-info"

export interface PendingReport {
  title: string
  description: string
  context: {
    pageUrl: string
    userAgent: string
    viewport: { w: number; h: number }
    timestamp: string
    reporter?: { userId?: string; email?: string; name?: string }
    metadata?: Record<string, string | number | boolean>
    systemInfo?: unknown
    cookies?: unknown
  }
  logs: LogsAttachment | null
  screenshot: Blob | null
}

export interface LogsAttachment {
  version: 1
  console: unknown[]
  network: unknown[]
  breadcrumbs: unknown[]
  config: {
    consoleMax: number
    networkMax: number
    breadcrumbsMax: number
    capturesBodies: boolean
    capturesAllHeaders: boolean
  }
}

export interface CollectorConfig {
  console?: {
    maxEntries?: number
    maxArgBytes?: number
    maxEntryBytes?: number
    enabled?: boolean
  }
  network?: {
    maxEntries?: number
    requestBody?: boolean
    responseBody?: boolean
    maxBodyBytes?: number
    allowedHeaders?: string[]
    allHeaders?: boolean
    redactQueryParams?: boolean
    enabled?: boolean
  }
  cookies?: { maskNames?: string[]; allowNames?: string[]; enabled?: boolean }
  breadcrumbs?: { maxEntries?: number; maxDataBytes?: number; enabled?: boolean }
  stringRedactors?: RegExp[]
  beforeSend?: (report: PendingReport) => PendingReport | null
}

export function registerAllCollectors(config: CollectorConfig): {
  snapshotAll: () => {
    systemInfo: ReturnType<typeof snapshotSystemInfo>
    cookies: ReturnType<ReturnType<typeof createCookiesCollector>["snapshot"]>
    logs: LogsAttachment
  }
  stopAll: () => void
  breadcrumb: (
    event: string,
    data?: Record<string, string | number | boolean | null>,
    level?: BreadcrumbLevel,
  ) => void
  applyBeforeSend: (report: PendingReport) => PendingReport | null
} {
  const stringRedactors = config.stringRedactors ?? [...DEFAULT_STRING_REDACTORS]
  const consoleCollector = createConsoleCollector({})
  const networkCollector = createNetworkCollector({})
  const cookiesCollector = createCookiesCollector({})
  const breadcrumbsCollector = createBreadcrumbsCollector({})

  consoleCollector.start({ ...config.console, stringRedactors })
  networkCollector.start({ ...config.network })
  cookiesCollector.start({ ...config.cookies })
  breadcrumbsCollector.start({ ...config.breadcrumbs })

  return {
    snapshotAll() {
      const consoleSnap = consoleCollector.snapshot()
      const networkSnap = networkCollector.snapshot()
      const breadcrumbsSnap = breadcrumbsCollector.snapshot()
      const cookiesSnap = cookiesCollector.snapshot()
      return {
        systemInfo: snapshotSystemInfo(),
        cookies: cookiesSnap,
        logs: {
          version: 1,
          console: consoleSnap,
          network: networkSnap,
          breadcrumbs: breadcrumbsSnap,
          config: {
            consoleMax: config.console?.maxEntries ?? 100,
            networkMax: config.network?.maxEntries ?? 50,
            breadcrumbsMax: config.breadcrumbs?.maxEntries ?? 50,
            capturesBodies: Boolean(config.network?.requestBody || config.network?.responseBody),
            capturesAllHeaders: Boolean(config.network?.allHeaders),
          },
        },
      }
    },
    stopAll() {
      consoleCollector.stop()
      networkCollector.stop()
      cookiesCollector.stop()
      breadcrumbsCollector.stop()
    },
    breadcrumb: breadcrumbsCollector.breadcrumb,
    applyBeforeSend(report) {
      const hook = config.beforeSend
      if (!hook) return report
      try {
        const result = hook(report)
        return result === undefined ? report : result
      } catch (err) {
        console.warn(
          "[feedback-tool] collectors.beforeSend threw; proceeding with original report",
          err,
        )
        return report
      }
    },
  }
}
```

- [ ] **Step 4: Confirm pass**

Expected: 6/6 PASS. Full SDK-UI suite: `bun test` from `packages/ui/` should show ~97 tests (60 pre-C + ring 6 + serialize 11 + redact 15 + system 2 + cookies 4 + breadcrumbs 5 + console 6 + network 6 + index 6 = 40 new ≈ 100).

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/ui/src/collectors/index.ts packages/ui/src/collectors/index.test.ts
git commit -m "feat(sdk-ui): add registerAllCollectors orchestration with beforeSend sandbox"
```

---

## Phase 3 — Shared types + SDK wiring + intake

### Task 10: Extend `@feedback-tool/shared` with SystemInfo / CookieEntry / LogsAttachment

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/shared/src/reports.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/system-info.ts` (switch to the shared type)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/ui/src/collectors/index.ts` (switch to the shared `LogsAttachment` and export `PendingReport`)

- [ ] **Step 1: Append to `packages/shared/src/reports.ts`**

Add (keep existing content intact):

```ts
export const SystemInfo = z.object({
  userAgent: z.string(),
  platform: z.string(),
  language: z.string(),
  timezone: z.string(),
  timezoneOffset: z.number(),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  dpr: z.number().positive(),
  online: z.boolean(),
  connection: z
    .object({
      effectiveType: z.string().optional(),
      rtt: z.number().optional(),
      downlink: z.number().optional(),
    })
    .optional(),
  pageUrl: z.string().url(),
  referrer: z.string().optional(),
  documentReferrer: z.string().optional(),
  timestamp: z.string(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const CookieEntry = z.object({
  name: z.string(),
  value: z.string(),
})
export type CookieEntry = z.infer<typeof CookieEntry>

export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  ts: z.number().int(),
  args: z.array(z.string()),
  stack: z.string().optional(),
})
export type ConsoleEntry = z.infer<typeof ConsoleEntry>

export const NetworkEntry = z.object({
  id: z.string(),
  ts: z.number().int(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  size: z.number().int().nullable(),
  initiator: z.enum(["fetch", "xhr"]),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
})
export type NetworkEntry = z.infer<typeof NetworkEntry>

export const Breadcrumb = z.object({
  ts: z.number().int(),
  event: z.string().max(200),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})
export type Breadcrumb = z.infer<typeof Breadcrumb>

export const LogsAttachment = z.object({
  version: z.literal(1),
  console: z.array(ConsoleEntry),
  network: z.array(NetworkEntry),
  breadcrumbs: z.array(Breadcrumb),
  config: z.object({
    consoleMax: z.number(),
    networkMax: z.number(),
    breadcrumbsMax: z.number(),
    capturesBodies: z.boolean(),
    capturesAllHeaders: z.boolean(),
  }),
})
export type LogsAttachment = z.infer<typeof LogsAttachment>
```

Also extend the existing `ReportContext`:

Replace the existing `export const ReportContext = z.object({ ... })` block with:

```ts
export const ReportContext = z.object({
  pageUrl: z.string().url(),
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  systemInfo: SystemInfo.optional(),
  cookies: z.array(CookieEntry).optional(),
})
export type ReportContext = z.infer<typeof ReportContext>
```

- [ ] **Step 2: Update `packages/ui/src/collectors/system-info.ts`**

Replace the inline `interface SystemInfo` block with:

```ts
import type { SystemInfo } from "@feedback-tool/shared"
```

Keep the rest of the file.

- [ ] **Step 3: Update `packages/ui/src/collectors/index.ts`**

Replace the inline `LogsAttachment` interface and the `PendingReport.context` shape with:

```ts
import type { LogsAttachment, ReportContext } from "@feedback-tool/shared"

export interface PendingReport {
  title: string
  description: string
  context: ReportContext
  logs: LogsAttachment | null
  screenshot: Blob | null
}
```

- [ ] **Step 4: Verify types compile + tests still pass**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bunx tsc --noEmit
cd /Users/jiajingteoh/Documents/feedback-tool/packages/ui && bun test 2>&1 | tail -5
```
Expected: tsc 0 errors, all SDK-UI tests still passing (both existing and new from Tasks 1–9).

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/shared/src/reports.ts packages/ui/src/collectors/system-info.ts packages/ui/src/collectors/index.ts
git commit -m "feat(shared): add SystemInfo/CookieEntry/LogsAttachment + extend ReportContext"
```

---

### Task 11: Wire collectors into SDK init + intake-client

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/config.ts` (extend `InitOptions`)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/index.ts` (start collectors on init, snapshot on submit, expose `log`)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/intake-client.ts` (accept + send `logs` multipart part)
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/packages/core/src/context.ts` (merge `systemInfo` + `cookies` into the returned context)

- [ ] **Step 1: Extend `config.ts` `InitOptions`**

Read `packages/core/src/config.ts`. Replace the `InitOptions` interface with:

```ts
import type { CollectorConfig } from "@feedback-tool/ui"

export interface InitOptions {
  projectKey: string
  endpoint: string
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  launcher?: boolean
  metadata?: Record<string, string | number | boolean>
  collectors?: CollectorConfig
}
```

Also add `CollectorConfig` export from `packages/ui/src/index.ts`:

```ts
export type { CollectorConfig } from "./collectors"
```

- [ ] **Step 2: Add `snapshotAll` / `breadcrumb` to `packages/core/src/index.ts`**

Replace the `init()` function and add `log()` export. The full file:

```ts
// packages/core/src/index.ts
import type { ReporterIdentity } from "@feedback-tool/shared"
import {
  close as uiClose,
  mount,
  open as uiOpen,
  registerAllCollectors,
  unmount,
  type BreadcrumbLevel,
  type CollectorConfig,
} from "@feedback-tool/ui"
import { resolveConfig, type InitOptions, type ResolvedConfig } from "./config"
import { gatherContext } from "./context"
import { capture } from "./screenshot"
import { postReport } from "./intake-client"

let _config: ResolvedConfig | null = null
let _reporter: ReporterIdentity | null = null
let _mounted = false
let _collectors: ReturnType<typeof registerAllCollectors> | null = null

export function init(options: InitOptions): void {
  const cfg = resolveConfig(options)
  _config = cfg
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _collectors = registerAllCollectors(options.collectors ?? {})
  mount({
    config: { position: cfg.position, launcher: cfg.launcher },
    capture,
    onSubmit: async ({ title, description, screenshot }) => {
      if (!_config || !_collectors) return { ok: false, message: "Not initialized" }
      const snap = _collectors.snapshotAll()
      const context = gatherContext(_reporter, _config.metadata, snap)
      const pending = {
        title,
        description,
        context,
        logs: snap.logs,
        screenshot,
      }
      const final = _collectors.applyBeforeSend(pending)
      if (final === null) return { ok: false, message: "aborted by beforeSend" }
      const result = await postReport(_config, {
        title: final.title,
        description: final.description,
        context: final.context,
        metadata: _config.metadata,
        screenshot: final.screenshot,
        logs: final.logs,
      })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    },
  })
  _mounted = true
}

export function open(): void {
  if (!_config) throw new Error("FeedbackTool.open called before init")
  uiOpen()
}

export function close(): void {
  uiClose()
}

export function identify(reporter: ReporterIdentity | null): void {
  _reporter = reporter
}

export function log(
  event: string,
  data?: Record<string, string | number | boolean | null>,
  level?: BreadcrumbLevel,
): void {
  _collectors?.breadcrumb(event, data, level)
}

export function _unmount(): void {
  if (_mounted) unmount()
  if (_collectors) _collectors.stopAll()
  _mounted = false
  _config = null
  _reporter = null
  _collectors = null
}
```

- [ ] **Step 3: Update `gatherContext` in `context.ts`**

Read the current file. Modify `gatherContext` to accept the collector snapshot and merge it in:

```ts
// packages/core/src/context.ts
import type { ReportContext, ReporterIdentity, SystemInfo, CookieEntry } from "@feedback-tool/shared"

export function gatherContext(
  reporter: ReporterIdentity | null,
  metadata: Record<string, string | number | boolean> | undefined,
  extras?: { systemInfo?: SystemInfo; cookies?: CookieEntry[] },
): ReportContext {
  return {
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timestamp: new Date().toISOString(),
    ...(reporter ? { reporter } : {}),
    ...(metadata ? { metadata } : {}),
    ...(extras?.systemInfo ? { systemInfo: extras.systemInfo } : {}),
    ...(extras?.cookies ? { cookies: extras.cookies } : {}),
  }
}
```

Update the existing `context.test.ts` expectations — extras are optional so old tests still pass. Add one test:

```ts
test("includes systemInfo and cookies when extras provided", () => {
  const ctx = gatherContext(null, undefined, {
    systemInfo: {
      userAgent: "x", platform: "y", language: "en", timezone: "UTC",
      timezoneOffset: 0, viewport: { w: 1, h: 1 }, screen: { w: 1, h: 1 },
      dpr: 1, online: true, pageUrl: "http://x/", timestamp: "2026-01-01T00:00:00Z",
    },
    cookies: [{ name: "a", value: "1" }],
  })
  expect(ctx.systemInfo?.userAgent).toBe("x")
  expect(ctx.cookies).toEqual([{ name: "a", value: "1" }])
})
```

- [ ] **Step 4: Update `intake-client.ts` to accept `logs`**

Read the current file. Extend `IntakeInput`:

```ts
import type { LogsAttachment, ReportContext } from "@feedback-tool/shared"

export interface IntakeInput {
  title: string
  description: string
  context: ReportContext
  metadata?: Record<string, string | number | boolean>
  screenshot: Blob | null
  logs?: LogsAttachment | null
}
```

In `postReport`, after the screenshot part append:

```ts
  if (input.logs) {
    body.set(
      "logs",
      new Blob([JSON.stringify(input.logs)], { type: "application/json" }),
      "logs.json",
    )
  }
```

- [ ] **Step 5: Type-check and build**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool/packages/core && bunx tsc --noEmit
cd /Users/jiajingteoh/Documents/feedback-tool && bun run sdk:build 2>&1 | tail -3
```
Expected: 0 tsc errors, IIFE builds, gzipped size ≤ 32 KB.

- [ ] **Step 6: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add packages/core/src/config.ts packages/core/src/index.ts packages/core/src/intake-client.ts packages/core/src/context.ts packages/core/src/context.test.ts packages/ui/src/index.ts
git commit -m "feat(sdk): wire collectors into init, expose feedback.log(), send logs multipart"
```

---

### Task 12: Dashboard intake endpoint — persist `logs` attachment

**Files:**
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/server/api/intake/reports.ts` (handle `logs` part)

- [ ] **Step 1: Extend the handler**

Read the current file. After the `if (screenshotPart?.data && ...)` block that persists the screenshot, append:

```ts
  const logsPart = parts.find((p) => p.name === "logs")
  if (logsPart?.data && logsPart.data.length > 0) {
    let parsedLogs: LogsAttachment
    try {
      parsedLogs = LogsAttachment.parse(JSON.parse(logsPart.data.toString("utf8")))
    } catch {
      throw createError({ statusCode: 400, statusMessage: "Invalid logs payload" })
    }
    const key = `${report.id}/logs.json`
    await storage.put(key, new Uint8Array(logsPart.data), "application/json")
    await db.insert(reportAttachments).values({
      reportId: report.id,
      kind: "logs",
      storageKey: key,
      contentType: "application/json",
      sizeBytes: logsPart.data.length,
    })
    void parsedLogs // used only for validation
  }
```

Add the import at the top of the file:

```ts
import { LogsAttachment } from "@feedback-tool/shared"
```

The existing `ReportIntakeInput` block (at the same file) can stay — new optional fields on `ReportContext` don't affect its validation (it'll drop unknown fields? No — Zod defaults to strip, so `systemInfo` / `cookies` survive the `.parse()` because they're in the schema now.).

- [ ] **Step 2: Smoke test the endpoint**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null
bun run dev > /tmp/d-task12.log 2>&1 &
PID=$!
sleep 22
cd apps/dashboard && bun test tests/api/intake.test.ts 2>&1 | tail -5
kill $PID 2>/dev/null
wait $PID 2>/dev/null
```
Expected: existing 4 intake tests still pass (no regression to sub-project B).

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/server/api/intake/reports.ts
git commit -m "feat(api): accept and persist optional logs multipart on intake"
```

---

### Task 13: Intake integration tests — logs happy path + malformed + content-type invariant + backward compat

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/tests/api/logs-intake.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// apps/dashboard/tests/api/logs-intake.test.ts
import { setup } from "@nuxt/test-utils/e2e"
import { setDefaultTimeout } from "bun:test"
setDefaultTimeout(30000)
import { afterEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import type { LogsAttachment } from "@feedback-tool/shared"
import { createUser, makePngBlob, seedProject, truncateDomain, truncateReports } from "../helpers"
import { db } from "../../server/db"
import { reportAttachments, reports } from "../../server/db/schema"

await setup({ server: true, port: 3000, host: "localhost" })

const PK = "ft_pk_ABCDEF1234567890abcdef12"
const ORIGIN = "http://localhost:4000"

function buildReportJSON(projectKey: string, title = "D test") {
  return JSON.stringify({
    projectKey,
    title,
    description: "d",
    context: {
      pageUrl: "http://localhost:4000/p",
      userAgent: "UA",
      viewport: { w: 1000, h: 800 },
      timestamp: new Date().toISOString(),
    },
  })
}

function buildLogs(): LogsAttachment {
  return {
    version: 1,
    console: [{ level: "log", ts: Date.now(), args: ['"hi"'] }],
    network: [
      {
        id: "a",
        ts: Date.now(),
        method: "GET",
        url: "http://x/",
        status: 200,
        durationMs: 12,
        size: 100,
        initiator: "fetch",
      },
    ],
    breadcrumbs: [{ ts: Date.now(), event: "e", level: "info" }],
    config: {
      consoleMax: 100,
      networkMax: 50,
      breadcrumbsMax: 50,
      capturesBodies: false,
      capturesAllHeaders: false,
    },
  }
}

function buildFormData(opts: {
  reportJson: string
  screenshot?: Blob
  logs?: Blob
}): FormData {
  const fd = new FormData()
  fd.set("report", new Blob([opts.reportJson], { type: "application/json" }))
  if (opts.screenshot) fd.set("screenshot", opts.screenshot, "screenshot.png")
  if (opts.logs) fd.set("logs", opts.logs, "logs.json")
  return fd
}

describe("logs intake", () => {
  afterEach(async () => {
    await truncateReports()
    await truncateDomain()
  })

  test("happy path: 201, two attachment rows, logs roundtrip", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const logs = buildLogs()
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob([JSON.stringify(logs)], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const atts = await db.select().from(reportAttachments).where(sql`report_id = ${body.id}`)
    expect(atts.map((a) => a.kind).sort()).toEqual(["logs", "screenshot"])
    void projectId
  })

  test("backward compat: no logs part still creates a valid report with just screenshot", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
      }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const atts = await db.select().from(reportAttachments).where(sql`report_id = ${body.id}`)
    expect(atts.map((a) => a.kind)).toEqual(["screenshot"])
  })

  test("malformed logs payload returns 400 and no report row", async () => {
    const admin = await createUser("admin@example.com", "admin")
    await seedProject({ name: "Demo", publicKey: PK, allowedOrigins: [ORIGIN], createdBy: admin })
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: buildFormData({
        reportJson: buildReportJSON(PK),
        screenshot: makePngBlob(),
        logs: new Blob(["{not json"], { type: "application/json" }),
      }),
    })
    expect(res.status).toBe(400)
    const rows = await db.select().from(reports)
    expect(rows.length).toBe(0)
  })

  test("intake hardcodes Content-Type per kind; client-supplied MIME is ignored", async () => {
    const admin = await createUser("admin@example.com", "admin")
    const projectId = await seedProject({
      name: "Demo",
      publicKey: PK,
      allowedOrigins: [ORIGIN],
      createdBy: admin,
    })
    const logs = buildLogs()
    const fd = new FormData()
    fd.set("report", new Blob([buildReportJSON(PK)], { type: "application/json" }))
    fd.set("screenshot", new Blob([makePngBlob()], { type: "text/html" }), "screenshot.png")
    fd.set("logs", new Blob([JSON.stringify(logs)], { type: "application/javascript" }), "logs.json")
    const res = await fetch("http://localhost:3000/api/intake/reports", {
      method: "POST",
      headers: { Origin: ORIGIN },
      body: fd,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }
    const rows = await db.select().from(reportAttachments).where(sql`report_id = ${body.id}`)
    const shot = rows.find((a) => a.kind === "screenshot")
    const logsRow = rows.find((a) => a.kind === "logs")
    expect(shot?.contentType).toBe("image/png")
    expect(logsRow?.contentType).toBe("application/json")
    void projectId
  })
})
```

Note: the screenshot line uses a nested Blob on purpose — happy-dom's `FormData` accepts it and the intake handler doesn't read the outer Blob's type. The existing `makePngBlob` helper already sets `type: "image/png"`; we're re-wrapping to force a conflicting MIME in the outer Blob so the test genuinely exercises the "client MIME ignored" path.

- [ ] **Step 2: Run tests**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null
bun run dev > /tmp/d-task13.log 2>&1 &
PID=$!
sleep 22
cd apps/dashboard && bun test tests/api/logs-intake.test.ts 2>&1 | tail -10
kill $PID 2>/dev/null
wait $PID 2>/dev/null
```
Expected: 4/4 PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/tests/api/logs-intake.test.ts
git commit -m "test(api): add logs intake integration tests + content-type invariant regression"
```

---

## Phase 4 — Dashboard drawer

### Task 14: `safeHref` composable + fix existing `pageUrl` XSS

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/composables/use-safe-href.ts`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/reports.vue` (existing pageUrl `:href` binding)

- [ ] **Step 1: Create `use-safe-href.ts`**

```ts
// apps/dashboard/app/composables/use-safe-href.ts
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"])

export function safeHref(url: string | null | undefined): string {
  if (!url) return "#"
  try {
    const u = new URL(url, window.location.origin)
    return SAFE_PROTOCOLS.has(u.protocol) ? u.toString() : "#"
  } catch {
    return "#"
  }
}
```

- [ ] **Step 2: Fix the existing XSS in `reports.vue`**

Read the file. Find the drawer's `<a :href="selected.pageUrl" ...>` binding. Replace the `href` value to use `safeHref`:

```vue
<a :href="safeHref(selected.pageUrl)" target="_blank" rel="noopener">{{ selected.pageUrl }}</a>
```

Add in the `<script setup>` at the top:

```ts
import { safeHref } from "~/composables/use-safe-href"
```

- [ ] **Step 3: Manual regression check via curl**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null
bun run dev > /tmp/d-task14.log 2>&1 &
PID=$!
sleep 22
# seed project manually and post a malicious report
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
ADMIN_ID=$(docker exec "$OUR_PG" psql -U postgres -d feedback_tool -t -c "INSERT INTO \"user\" (id, email, email_verified, role, status, created_at, updated_at) VALUES ('admin-xss-test', 'admin@example.com', true, 'admin', 'active', now(), now()) RETURNING id" | xargs)
PROJECT_ID=$(docker exec "$OUR_PG" psql -U postgres -d feedback_tool -t -c "INSERT INTO projects (name, slug, created_by, public_key, allowed_origins) VALUES ('XSS', 'xss', 'admin-xss-test', 'ft_pk_XSS1234567890abcdefghijk', ARRAY['http://attacker.com']) RETURNING id" | xargs)
curl -s -X POST http://localhost:3000/api/intake/reports \
  -H "Origin: http://attacker.com" \
  -F "report=$(cat <<EOF
{"projectKey":"ft_pk_XSS1234567890abcdefghijk","title":"XSS","description":"","context":{"pageUrl":"javascript:alert(1)//","userAgent":"x","viewport":{"w":1,"h":1},"timestamp":"2026-01-01T00:00:00Z"}}
EOF
)" \
  -F "screenshot=@/dev/null;filename=x.png;type=image/png" 2>&1 | head -3
kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Manual inspection follows in Task 20's smoke test. What this task guarantees: the `safeHref` function exists and is wired into the existing binding. Automated verification is deferred to the end-to-end smoke.

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/composables/use-safe-href.ts apps/dashboard/app/pages/projects/[id]/reports.vue
git commit -m "fix(dashboard): safeHref() guard on rendered report URLs (was javascript: XSS)"
```

---

### Task 15: Drawer shell + tab bar + lazy `logs` fetch

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/drawer.vue`
- Create: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/tabs.vue`
- Modify: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/pages/projects/[id]/reports.vue` (replace inline drawer with `<ReportDrawer>`)

- [ ] **Step 1: Create `tabs.vue`**

```vue
<!-- apps/dashboard/app/components/report-drawer/tabs.vue -->
<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

interface Props {
  activeTab: "overview" | "console" | "network" | "cookies"
  logs: LogsAttachment | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ change: [tab: Props["activeTab"]] }>()

const consoleCount = computed(() =>
  props.logs ? props.logs.console.length + props.logs.breadcrumbs.length : null,
)
const networkCount = computed(() => (props.logs ? props.logs.network.length : null))
const networkErrors = computed(() =>
  props.logs
    ? props.logs.network.filter((n) => n.status === null || (n.status && n.status >= 400)).length
    : 0,
)
</script>

<template>
  <nav class="flex gap-4 border-b px-4 text-sm">
    <button
      v-for="tab in ['overview', 'console', 'network', 'cookies'] as const"
      :key="tab"
      type="button"
      class="py-2 capitalize border-b-2 -mb-px"
      :class="activeTab === tab ? 'border-neutral-900 font-semibold' : 'border-transparent text-neutral-500 hover:text-neutral-900'"
      @click="emit('change', tab)"
    >
      {{ tab }}
      <span
        v-if="tab === 'console' && consoleCount !== null"
        class="ml-1 text-xs text-neutral-500"
      >· {{ consoleCount }}</span>
      <span
        v-if="tab === 'network' && networkCount !== null"
        class="ml-1 text-xs text-neutral-500"
      >
        · {{ networkCount }}
        <span v-if="networkErrors > 0" class="text-red-600">· {{ networkErrors }}✗</span>
      </span>
    </button>
  </nav>
</template>
```

- [ ] **Step 2: Create `drawer.vue`**

```vue
<!-- apps/dashboard/app/components/report-drawer/drawer.vue -->
<script setup lang="ts">
import type { LogsAttachment, ReportSummaryDTO } from "@feedback-tool/shared"
import OverviewTab from "./overview-tab.vue"
import ConsoleTab from "./console-tab.vue"
import NetworkTab from "./network-tab.vue"
import CookiesTab from "./cookies-tab.vue"
import Tabs from "./tabs.vue"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()
const emit = defineEmits<{ close: [] }>()

type TabName = "overview" | "console" | "network" | "cookies"
const activeTab = ref<TabName>("overview")
const logs = ref<LogsAttachment | null>(null)
const logsLoaded = ref(false)
const logsError = ref<string | null>(null)

async function ensureLogs() {
  if (logsLoaded.value) return
  logsLoaded.value = true
  try {
    const res = await $fetch<LogsAttachment>(
      `/api/projects/${props.projectId}/reports/${props.report.id}/attachment?kind=logs`,
      { baseURL: useRuntimeConfig().public.betterAuthUrl, credentials: "include" },
    ).catch(() => null)
    logs.value = res ?? null
  } catch (e: unknown) {
    logsError.value = e instanceof Error ? e.message : String(e)
  }
}

watch(activeTab, (t) => {
  if (t === "console" || t === "network" || t === "cookies") ensureLogs()
})

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close")
    return
  }
  if (e.key === "1") activeTab.value = "overview"
  if (e.key === "2") activeTab.value = "console"
  if (e.key === "3") activeTab.value = "network"
  if (e.key === "4") activeTab.value = "cookies"
}
onMounted(() => window.addEventListener("keydown", onKey))
onUnmounted(() => window.removeEventListener("keydown", onKey))
</script>

<template>
  <div class="fixed inset-0 bg-black/40 z-50" @click="emit('close')">
    <aside
      class="absolute right-0 top-0 h-full w-[640px] max-w-full bg-white shadow-2xl overflow-y-auto"
      @click.stop
    >
      <header class="p-4 border-b flex items-center justify-between">
        <h2 class="font-semibold truncate">{{ report.title }}</h2>
        <button type="button" class="text-neutral-500" @click="emit('close')">Close</button>
      </header>
      <Tabs :active-tab="activeTab" :logs="logs" @change="activeTab = $event" />
      <OverviewTab v-if="activeTab === 'overview'" :project-id="projectId" :report="report" />
      <ConsoleTab v-else-if="activeTab === 'console'" :logs="logs" />
      <NetworkTab v-else-if="activeTab === 'network'" :logs="logs" />
      <CookiesTab v-else-if="activeTab === 'cookies'" :project-id="projectId" :report="report" />
    </aside>
  </div>
</template>
```

> **Note:** `OverviewTab`, `ConsoleTab`, `NetworkTab`, `CookiesTab` don't exist yet — they land in Tasks 16–19. Each of those tasks keeps the drawer usable through incremental additions. For the drawer to compile NOW we need stub components. **Create stubs:**

Create stubs at the start of this task so `drawer.vue` compiles cleanly:

```vue
<!-- apps/dashboard/app/components/report-drawer/overview-tab.vue (stub until Task 16) -->
<template><div class="p-4 text-sm text-neutral-500">Overview tab — landing in Task 16.</div></template>
```

```vue
<!-- apps/dashboard/app/components/report-drawer/console-tab.vue (stub until Task 17) -->
<template><div class="p-4 text-sm text-neutral-500">Console tab — landing in Task 17.</div></template>
```

```vue
<!-- apps/dashboard/app/components/report-drawer/network-tab.vue (stub until Task 18) -->
<template><div class="p-4 text-sm text-neutral-500">Network tab — landing in Task 18.</div></template>
```

```vue
<!-- apps/dashboard/app/components/report-drawer/cookies-tab.vue (stub until Task 19) -->
<template><div class="p-4 text-sm text-neutral-500">Cookies tab — landing in Task 19.</div></template>
```

- [ ] **Step 3: Replace the inline drawer in `reports.vue`**

Read `apps/dashboard/app/pages/projects/[id]/reports.vue`. Replace the entire `<div v-if="selected" class="fixed inset-0 bg-black/40 z-50" ...>` block with:

```vue
<ReportDrawer
  v-if="selected"
  :project-id="(route.params.id as string)"
  :report="selected"
  @close="close"
/>
```

Import at the top of `<script setup>`:

```ts
import ReportDrawer from "~/components/report-drawer/drawer.vue"
```

Keep the rest of the page (table + list) unchanged.

- [ ] **Step 4: Smoke — start server, open drawer, click tabs**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
bun run dev > /tmp/d-task15.log 2>&1 &
PID=$!
sleep 22
curl -sI http://localhost:3000/ -m 5 | head -1
kill $PID 2>/dev/null
wait $PID 2>/dev/null
grep -iE "error" /tmp/d-task15.log | grep -v "WARN\|Duplicated" | head -5
```
Expected: dashboard compiles, no new errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer apps/dashboard/app/pages/projects/[id]/reports.vue
git commit -m "feat(dashboard): drawer shell with tabs + lazy logs attachment fetch"
```

---

### Task 16: Overview tab (replaces the existing inline drawer body)

**Files:**
- Replace: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/overview-tab.vue`

- [ ] **Step 1: Implement**

```vue
<!-- apps/dashboard/app/components/report-drawer/overview-tab.vue -->
<script setup lang="ts">
import type { ReportSummaryDTO, ReportContext } from "@feedback-tool/shared"
import { safeHref } from "~/composables/use-safe-href"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()

// Fetch the full report for its context. The list DTO doesn't carry description or context,
// so the drawer hits the same list endpoint for the detail row. (Full detail endpoint is a
// sub-project F concern; using list+filter is good enough.)
const { data: details } = await useApi<{
  items: Array<ReportSummaryDTO & { description?: string | null; context?: ReportContext }>
}>(`/api/projects/${props.projectId}/reports?limit=50`)

const thisReport = computed(() =>
  details.value?.items.find((r) => r.id === props.report.id) ?? null,
)
const ctx = computed(() => thisReport.value?.context as ReportContext | undefined)
const sys = computed(() => ctx.value?.systemInfo)

const fmtTime = (iso: string) => new Date(iso).toLocaleString()
</script>

<template>
  <div class="p-4 space-y-4">
    <img
      v-if="report.thumbnailUrl"
      :src="report.thumbnailUrl"
      alt="Report screenshot"
      class="w-full border rounded"
    />
    <div class="text-sm space-y-1">
      <div>
        <span class="text-neutral-500">Reporter:</span>
        {{ report.reporterEmail ?? "anonymous" }}
      </div>
      <div>
        <span class="text-neutral-500">Page:</span>
        <a :href="safeHref(report.pageUrl)" target="_blank" rel="noopener" class="underline">
          {{ report.pageUrl }}
        </a>
      </div>
      <div>
        <span class="text-neutral-500">Received:</span> {{ fmtTime(report.receivedAt) }}
      </div>
    </div>

    <section v-if="sys" class="border rounded p-3 text-xs bg-neutral-50 grid grid-cols-2 gap-x-4 gap-y-1">
      <div><span class="text-neutral-500">Platform:</span> {{ sys.platform }}</div>
      <div><span class="text-neutral-500">Language:</span> {{ sys.language }}</div>
      <div><span class="text-neutral-500">Timezone:</span> {{ sys.timezone }} ({{ sys.timezoneOffset }})</div>
      <div><span class="text-neutral-500">DPR:</span> {{ sys.dpr }}</div>
      <div><span class="text-neutral-500">Viewport:</span> {{ sys.viewport.w }}×{{ sys.viewport.h }}</div>
      <div><span class="text-neutral-500">Screen:</span> {{ sys.screen.w }}×{{ sys.screen.h }}</div>
      <div><span class="text-neutral-500">Online:</span> {{ sys.online ? "yes" : "no" }}</div>
      <div v-if="sys.connection">
        <span class="text-neutral-500">Connection:</span>
        {{ sys.connection.effectiveType ?? "unknown" }}
      </div>
      <div v-if="sys.referrer" class="col-span-2">
        <span class="text-neutral-500">Referrer:</span>
        <a :href="safeHref(sys.referrer)" target="_blank" rel="noopener" class="underline">{{ sys.referrer }}</a>
      </div>
    </section>

    <details class="text-xs">
      <summary class="cursor-pointer text-neutral-500">Raw context</summary>
      <pre class="mt-2 bg-neutral-100 p-3 rounded overflow-x-auto">{{ JSON.stringify(ctx, null, 2) }}</pre>
    </details>
  </div>
</template>
```

- [ ] **Step 2: Extend the list endpoint to include `description` + `context`**

Read `apps/dashboard/server/api/projects/[id]/reports/index.get.ts`. The existing list endpoint only returns summary fields. Extend it to also include `description` and `context` so the overview tab can render without a separate detail endpoint.

In the file, replace the `.select({ ... })` block in the `db.select()` chain with:

```ts
.select({
  id: reports.id,
  title: reports.title,
  description: reports.description,
  context: reports.context,
  createdAt: reports.createdAt,
  attachmentId: reportAttachments.id,
})
```

And replace the final map-to-DTO to include them:

```ts
const items = rows.map((r) => {
  const ctx = r.context as ReportContext
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    context: ctx,
    reporterEmail: ctx.reporter?.email ?? null,
    pageUrl: ctx.pageUrl,
    receivedAt: r.createdAt.toISOString(),
    thumbnailUrl: r.attachmentId
      ? `/api/projects/${id}/reports/${r.id}/attachment?kind=screenshot`
      : null,
  }
})
```

- [ ] **Step 3: Rebuild + smoke**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
lsof -ti:3000 | xargs -r kill -9 2>/dev/null
bun run dev > /tmp/d-task16.log 2>&1 &
PID=$!
sleep 22
curl -sI http://localhost:3000/ -m 5 | head -1
kill $PID 2>/dev/null
wait $PID 2>/dev/null
cd apps/dashboard && bun test tests/api/reports.test.ts 2>&1 | tail -3
```
Expected: existing reports tests still pass (the list endpoint now returns MORE fields; existing assertions still hold).

- [ ] **Step 4: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/overview-tab.vue apps/dashboard/server/api/projects/[id]/reports/index.get.ts
git commit -m "feat(dashboard): overview tab renders systemInfo + uses safeHref"
```

---

### Task 17: Console tab (with breadcrumb subsection)

**Files:**
- Replace: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/console-tab.vue`

- [ ] **Step 1: Implement**

```vue
<!-- apps/dashboard/app/components/report-drawer/console-tab.vue -->
<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

const props = defineProps<{ logs: LogsAttachment | null }>()

const levels = reactive({ log: true, info: true, warn: true, error: true, debug: true })
const query = ref("")

const filtered = computed(() => {
  if (!props.logs) return []
  const q = query.value.toLowerCase()
  return props.logs.console.filter(
    (e) => levels[e.level] && (q === "" || e.args.some((a) => a.toLowerCase().includes(q))),
  )
})

const levelColor: Record<string, string> = {
  log: "text-neutral-700",
  info: "text-neutral-700",
  debug: "text-neutral-500",
  warn: "text-yellow-700 bg-yellow-50",
  error: "text-red-700 bg-red-50",
}
const levelStripe: Record<string, string> = {
  warn: "border-l-4 border-yellow-400",
  error: "border-l-4 border-red-500",
  log: "",
  info: "",
  debug: "",
}

const fmtTs = (ts: number) => new Date(ts).toLocaleTimeString()
const expanded = ref<Set<number>>(new Set())
function toggle(i: number) {
  if (expanded.value.has(i)) expanded.value.delete(i)
  else expanded.value.add(i)
  expanded.value = new Set(expanded.value)
}
</script>

<template>
  <div v-if="!logs" class="p-4 text-sm text-neutral-500">Loading…</div>
  <div v-else-if="logs.console.length === 0 && logs.breadcrumbs.length === 0" class="p-4 text-sm text-neutral-500">
    No console entries or app events captured.
  </div>
  <div v-else class="p-2 space-y-3">
    <section>
      <div class="flex flex-wrap gap-2 p-2 text-xs">
        <label v-for="lv in (['log', 'info', 'warn', 'error', 'debug'] as const)" :key="lv" class="flex items-center gap-1">
          <input v-model="levels[lv]" type="checkbox" />
          {{ lv }}
        </label>
        <input
          v-model="query"
          placeholder="filter…"
          class="ml-auto border rounded px-2 py-1 text-xs"
        />
      </div>
      <ul class="text-xs font-mono">
        <li
          v-for="(e, i) in filtered"
          :key="i"
          :class="[levelColor[e.level], levelStripe[e.level], 'px-2 py-1 cursor-pointer']"
          @click="toggle(i)"
        >
          <span class="uppercase mr-2 inline-block w-10">{{ e.level }}</span>
          <span class="text-neutral-500 mr-2">{{ fmtTs(e.ts) }}</span>
          <span class="whitespace-pre-wrap break-all">{{ e.args.join(" ") }}</span>
          <pre v-if="expanded.has(i) && e.stack" class="mt-1 text-neutral-600 whitespace-pre-wrap">{{ e.stack }}</pre>
        </li>
      </ul>
    </section>
    <section v-if="logs.breadcrumbs.length > 0" class="border-t pt-2">
      <h3 class="px-2 text-xs font-semibold text-neutral-600">App events</h3>
      <ul class="text-xs font-mono">
        <li v-for="(b, i) in logs.breadcrumbs" :key="i" class="px-2 py-1">
          <span class="uppercase mr-2 inline-block w-10">{{ b.level }}</span>
          <span class="text-neutral-500 mr-2">{{ fmtTs(b.ts) }}</span>
          <strong>{{ b.event }}</strong>
          <span v-if="b.data" class="ml-2 text-neutral-600">{{ JSON.stringify(b.data) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/console-tab.vue
git commit -m "feat(dashboard): console tab with level filter + breadcrumb section"
```

---

### Task 18: Network tab

**Files:**
- Replace: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/network-tab.vue`

- [ ] **Step 1: Implement**

```vue
<!-- apps/dashboard/app/components/report-drawer/network-tab.vue -->
<script setup lang="ts">
import type { LogsAttachment } from "@feedback-tool/shared"

const props = defineProps<{ logs: LogsAttachment | null }>()

const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id)
  else expanded.value.add(id)
  expanded.value = new Set(expanded.value)
}
const methodColor: Record<string, string> = {
  GET: "bg-neutral-100 text-neutral-800",
  POST: "bg-blue-100 text-blue-800",
  PUT: "bg-yellow-100 text-yellow-800",
  DELETE: "bg-red-100 text-red-800",
  PATCH: "bg-purple-100 text-purple-800",
}
const statusColor = (s: number | null) => {
  if (s === null) return "text-neutral-500"
  if (s >= 500) return "text-red-700"
  if (s >= 400) return "text-orange-700"
  return "text-neutral-700"
}
const fmtMs = (v: number | null) => (v === null ? "—" : `${Math.round(v)}ms`)
const fmtSize = (v: number | null) => {
  if (v === null) return "—"
  if (v < 1024) return `${v}B`
  return `${(v / 1024).toFixed(1)}kB`
}
</script>

<template>
  <div v-if="!logs" class="p-4 text-sm text-neutral-500">Loading…</div>
  <div v-else-if="logs.network.length === 0" class="p-4 text-sm text-neutral-500">
    No network requests captured in the last {{ logs.config.networkMax }} calls.
  </div>
  <table v-else class="w-full text-xs">
    <thead class="bg-neutral-50 text-left">
      <tr>
        <th class="p-2">Method</th>
        <th class="p-2">URL</th>
        <th class="p-2">Status</th>
        <th class="p-2 text-right">Time</th>
        <th class="p-2 text-right">Size</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="n in logs.network" :key="n.id">
        <tr class="border-t cursor-pointer hover:bg-neutral-50" @click="toggle(n.id)">
          <td class="p-2">
            <span :class="[methodColor[n.method] ?? 'bg-neutral-100', 'px-2 py-0.5 rounded text-xs']">
              {{ n.method }}
            </span>
          </td>
          <td class="p-2 font-mono text-xs truncate max-w-xs" :title="n.url">{{ n.url }}</td>
          <td class="p-2" :class="statusColor(n.status)">{{ n.status ?? "—" }}</td>
          <td class="p-2 text-right">{{ fmtMs(n.durationMs) }}</td>
          <td class="p-2 text-right">{{ fmtSize(n.size) }}</td>
        </tr>
        <tr v-if="expanded.has(n.id)" class="border-t bg-neutral-50">
          <td colspan="5" class="p-3 text-xs space-y-2">
            <div v-if="n.error" class="text-red-700">Error: {{ n.error }}</div>
            <div v-if="n.requestHeaders && Object.keys(n.requestHeaders).length">
              <div class="font-semibold">Request headers</div>
              <pre class="whitespace-pre-wrap">{{ JSON.stringify(n.requestHeaders, null, 2) }}</pre>
            </div>
            <div v-if="n.requestBody">
              <div class="font-semibold">Request body</div>
              <pre class="whitespace-pre-wrap break-all">{{ n.requestBody }}</pre>
            </div>
            <div v-if="n.responseHeaders && Object.keys(n.responseHeaders).length">
              <div class="font-semibold">Response headers</div>
              <pre class="whitespace-pre-wrap">{{ JSON.stringify(n.responseHeaders, null, 2) }}</pre>
            </div>
            <div v-if="n.responseBody">
              <div class="font-semibold">Response body</div>
              <pre class="whitespace-pre-wrap break-all">{{ n.responseBody }}</pre>
            </div>
          </td>
        </tr>
      </template>
    </tbody>
  </table>
</template>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/network-tab.vue
git commit -m "feat(dashboard): network tab with method/status/duration table + inline expand"
```

---

### Task 19: Cookies tab

**Files:**
- Replace: `/Users/jiajingteoh/Documents/feedback-tool/apps/dashboard/app/components/report-drawer/cookies-tab.vue`

- [ ] **Step 1: Implement**

```vue
<!-- apps/dashboard/app/components/report-drawer/cookies-tab.vue -->
<script setup lang="ts">
import type { ReportContext, ReportSummaryDTO } from "@feedback-tool/shared"

const props = defineProps<{ projectId: string; report: ReportSummaryDTO }>()

// Cookies live in report.context, not in the logs attachment. Pull them from the same list
// endpoint (already includes the context since Task 16).
const { data } = await useApi<{
  items: Array<ReportSummaryDTO & { context?: ReportContext }>
}>(`/api/projects/${props.projectId}/reports?limit=50`)

const cookies = computed(() => {
  const row = data.value?.items.find((r) => r.id === props.report.id)
  return row?.context?.cookies ?? []
})

const query = ref("")
const filtered = computed(() => {
  if (!query.value) return cookies.value
  const q = query.value.toLowerCase()
  return cookies.value.filter((c) => c.name.toLowerCase().includes(q))
})
</script>

<template>
  <div v-if="cookies.length === 0" class="p-4 text-sm text-neutral-500">
    No cookies captured.
  </div>
  <div v-else class="p-2">
    <input
      v-model="query"
      placeholder="filter by name…"
      class="mb-2 border rounded px-2 py-1 text-xs w-full"
    />
    <table class="w-full text-xs">
      <thead class="bg-neutral-50 text-left">
        <tr>
          <th class="p-2">Name</th>
          <th class="p-2">Value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in filtered" :key="c.name" class="border-t">
          <td class="p-2 font-mono">{{ c.name }}</td>
          <td
            class="p-2 font-mono break-all"
            :class="c.value === '<redacted>' ? 'italic text-neutral-400' : ''"
          >
            {{ c.value }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add apps/dashboard/app/components/report-drawer/cookies-tab.vue
git commit -m "feat(dashboard): cookies tab with redacted-value indication"
```

---

## Phase 5 — Docs + verification

### Task 20: Threat model doc + end-to-end smoke + tag

**Files:**
- Create: `/Users/jiajingteoh/Documents/feedback-tool/docs/superpowers/security/threat-model.md`

- [ ] **Step 1: Write the threat model doc**

```markdown
# Feedback Tool Threat Model

## Scope
This document captures the security invariants the feedback-tool platform relies on, the
known tradeoffs, and the attacker capabilities we defend against.

## Identity model
- **Public project keys are not secrets.** They are embedded in every host page's
  `<script>` tag. Abuse mitigation is the per-key rate limit (60/min) and key
  rotation from the project settings page — not concealment. Treat any leaked
  key as "rotate it."
- **Origin header enforcement is browser-only.** A leaked key + curl can POST
  from any origin header. We accept this; the compensating controls are the
  rate limit and admin monitoring of insert volume.

## Intake invariants
- `contentType` on `report_attachments` is **server-set per `kind`**, never
  passed through from client Blob MIME types. Regression-tested.
- Intake endpoint is the only public endpoint with CORS. All other endpoints
  are session-scoped and same-origin.
- 5 MB total payload cap enforced at the multipart reader.

## Collector data
- Host-app strings logged via `console.*` or `feedback.log()` are trusted inputs.
  We apply default regex scrubbers (JWT, GitHub PAT, Slack, AWS, Bearer) as
  defense-in-depth, but this is best-effort — not a guarantee.
- Network URL query strings get `api_key` / `token` / `access_token` / etc.
  redacted by default.
- Request + response bodies are **not captured** by default. Opt-in.
- Cookies matching common sensitive names (`session`, `auth`, `jwt`, etc.) are
  redacted with `__Secure-` / `__Host-` prefix stripping.

## Dashboard rendering
- Any URL rendered as `href` goes through `safeHref()`, which only allows
  `http:` / `https:` / `mailto:`. A `javascript:` URI in a reported pageUrl
  resolves to `#`.
- Report `title` and `description` are rendered via Vue text interpolation
  (`{{ }}`), which HTML-escapes. `v-html` is never used on user-supplied data.

## PII posture
- Reporter email (if provided via `feedback.identify()`) is stored as part of
  the report context.
- Project deletion cascades to reports + attachments at the DB level.
- Attachment blobs on disk are not deleted by the cascade — orphaned files
  are an acceptable v1 state on single-tenant self-host. A cleanup job is a
  future follow-up.
- There is no self-service "delete my data" UI for end-users. GDPR / erasure
  requests are handled by the install's admin deleting the report rows.

## `beforeSend` contract
- Runs synchronously, once, immediately before the intake POST.
- Wrapped in try/catch: if the hook throws, we log to `console.warn` and send
  the original report unmodified (fail-open).
- Returning `null` aborts the submit entirely (silent cancel, no retry).
- Async work inside the hook must be resolved before return.

## Known deferrals
- Signed reports / HMAC on intake payload — not in v1.
- Per-end-user PII deletion UI — future compliance sub-project.
- Server-side replay integrity checks (E) — tracked in sub-project E design.
- Attachment retention policy — admin-configurable via a future sub-project.
```

- [ ] **Step 2: Final gate — tests + build + bundle**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check 2>&1 | tail -3
bun run sdk:build 2>&1 | tail -3
wc -c packages/core/dist/feedback-tool.iife.js
gzip -c packages/core/dist/feedback-tool.iife.js | wc -c
(cd packages/ui && bun test 2>&1 | tail -5)
(cd packages/core && bun test 2>&1 | tail -5)

lsof -ti:3000 | xargs -r kill -9 2>/dev/null
OUR_PG=$(docker ps --format '{{.Names}} {{.Ports}}' | awk '/0\.0\.0\.0:5436->/{print $1; exit}')
docker exec "$OUR_PG" psql -U postgres -d feedback_tool -c "TRUNCATE report_attachments, reports, project_members, projects, \"account\", \"session\", \"verification\", \"user\" RESTART IDENTITY CASCADE" >/dev/null
bun run dev > /tmp/d-final.log 2>&1 &
PID=$!
sleep 22
(cd apps/dashboard && bun test 2>&1 | tail -5)
kill $PID 2>/dev/null
wait $PID 2>/dev/null
```

Expected:
- `bun run check` → 0 errors.
- IIFE gzipped ≤ 32 KB (budget).
- SDK-UI ≈ 100 tests pass.
- SDK-core 10 tests pass.
- Dashboard 45 + 4 new = 49 tests pass.

- [ ] **Step 3: Manual laptop smoke (Chrome)**

Walk through §10.2 of the spec verbatim — 11 steps from "embed SDK with default `collectors: {}`" through "tabs re-use cached attachment." Every step must produce the documented result.

- [ ] **Step 4: Redaction smoke**

Walk through §10.3 of the spec — init with aggressive capture, log a JWT in `console.log`, issue a fetch with `?api_key=secret` and `Authorization: Bearer abc.def.ghi`. Submit. In the dashboard, confirm:
- Console tab: JWT shows `REDACTED`.
- Network tab: URL shows `?api_key=REDACTED&debug=1`. Authorization header value (visible only because of `allHeaders: true`) shows `REDACTED`.

- [ ] **Step 5: `javascript:` regression smoke**

Manually POST a report with `context.pageUrl = "javascript:alert(document.cookie)//"`:

```bash
PK=$(docker exec "$OUR_PG" psql -U postgres -d feedback_tool -t -c "SELECT public_key FROM projects LIMIT 1" | xargs)
curl -sD - -X POST http://localhost:3000/api/intake/reports \
  -H "Origin: http://localhost:4000" \
  -F "report=$(cat <<EOF
{"projectKey":"$PK","title":"XSS test","description":"","context":{"pageUrl":"javascript:alert(document.cookie)//","userAgent":"x","viewport":{"w":1,"h":1},"timestamp":"2026-01-01T00:00:00Z"}}
EOF
)" \
  -F "screenshot=@/dev/null;filename=x.png;type=image/png" | head -5
```

Open that report in the dashboard. The Page URL link's `href` attribute (inspect via DevTools) shows `#`, not the `javascript:` URI. Clicking does nothing.

- [ ] **Step 6: `beforeSend` fail-open smoke**

In a browser console on the demo page:
```js
FeedbackTool.init({
  projectKey: "...",
  endpoint: "http://localhost:3000",
  collectors: { beforeSend: () => { throw new Error("oops") } },
})
```
Submit a report. Confirm the dashboard receives it with the original data and the page console shows `[feedback-tool] collectors.beforeSend threw; proceeding with original report`.

- [ ] **Step 7: Commit docs + tag**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
git add docs/superpowers/security/threat-model.md
git commit -m "docs(security): add threat model covering public keys, origin, content-type, PII"
git tag -a v0.4.0-collectors -m "Sub-project D complete: diagnostic collectors

Console / network / cookies / feedback.log() breadcrumbs + expanded systemInfo.
Hybrid storage: light fields in context JSONB, heavy logs as kind='logs'
attachment with server-set application/json content-type. Tabbed drawer
redesign with lazy attachment fetch.

Security: safeHref() protocol guard retrofits the shipped pageUrl XSS,
redactUrl() strips sensitive query params, default string redactors
scrub JWT/PAT/Slack/AWS/Bearer patterns from every serialized string,
beforeSend is sandboxed fail-open, fetch/XHR clone failures are
non-fatal. Threat model documented at docs/superpowers/security/.

Bundle: ~30 KB gzipped (budget 32). ~150 tests total."

git tag | tail -4
```

---

## Self-Review

### Spec coverage

| Spec section | Task(s) |
| --- | --- |
| §3 architecture (packages/ui/src/collectors/ dir) | Tasks 1–9 |
| §4.1 SystemInfo + CookieEntry additions to ReportContext | Task 10 |
| §4.2 LogsAttachment schema | Task 10 |
| §4.3 no migration | — (reserved in B) |
| §5.1 Collector + CollectorConfig interface | Task 9 |
| §5.2 per-collector modules | Tasks 1–8 (ring, serialize; cookies, breadcrumbs, console, network, system-info) |
| §6 redaction engine + beforeSend | Tasks 3, 9 |
| §7.1 intake endpoint extension | Task 12 |
| §7.2 content-type invariant | Task 12 (hardcoded insert) + Task 13 (regression test) |
| §7.3 5 MB cap | — (inherited from B) |
| §8.1 drawer shell | Task 15 |
| §8.2 lazy fetch | Task 15 |
| §8.3 safeHref() | Task 14 |
| §8.4 keyboard shortcuts | Task 15 |
| §9.1 unit tests (~35) | Tasks 1–9 |
| §9.2 integration tests (4) | Task 13 |
| §10 done-criteria | Task 20 |
| §12 threat model doc | Task 20 |

### Placeholder scan

No "TBD" / "implement later" / silent steps. The only forward-reference is Task 4's inline `SystemInfo` interface that gets replaced in Task 10 — that's documented as an intentional temporary workaround with the exact replacement code.

### Type consistency

- `Shape` / `Tool` / `Transform` are unchanged from C.
- `Collector<T>` / `CollectorConfig` / `PendingReport` / `LogsAttachment` / `ConsoleEntry` / `NetworkEntry` / `Breadcrumb` / `CookieEntry` / `SystemInfo` are defined once in Task 10's shared module and imported consistently in Tasks 4, 6, 7, 8, 9, 11.
- `DEFAULT_SENSITIVE_COOKIE_NAMES` / `DEFAULT_ALLOWED_REQUEST_HEADERS` / `DEFAULT_ALLOWED_RESPONSE_HEADERS` / `DEFAULT_REDACTED_QUERY_PARAMS` / `DEFAULT_STRING_REDACTORS` are declared once in Task 3 and imported by Tasks 5, 8 (and bundled into consumers through Task 9 orchestration).
- `safeHref` is defined once in Task 14 and imported by Tasks 14 (patches existing binding) and 16 (overview tab).
- `beforeSend` / `PendingReport` return semantics are consistent across Tasks 9 (implementation), 11 (caller), and 20 (smoke).
