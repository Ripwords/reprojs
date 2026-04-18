#!/usr/bin/env bun
// apps/dashboard/scripts/patch-auth-schema.ts
//
// Post-processor for better-auth's generated `auth-schema.ts`.
//
// Problem: `@better-auth/cli generate` emits `timestamp("col_name")` for every
// datetime column when the adapter is `pg`. That maps to Postgres `timestamp`
// (a.k.a. "timestamp without time zone"), which stores naïve values and drifts
// if the session TZ ever differs from UTC. The rest of this codebase uses
// `timestamptz` via `{ withTimezone: true }`, and we want auth to match.
//
// The CLI has no config flag for this (verified against
// node_modules/@better-auth/cli/dist/generators-*.mjs — the pg mapping is
// hardcoded: `timestamp('${name}')`), so we rewrite the file after generation.
//
// The transform only matches the exact single-arg form the CLI emits:
//   timestamp("some_col")
// and upgrades it to:
//   timestamp("some_col", { withTimezone: true, mode: "date" })
//
// Chained calls (`.notNull()`, `.defaultNow()`, `.$onUpdate(...)`) are untouched
// because we only rewrite inside the `timestamp(...)` call itself. Running the
// script twice is a no-op — the regex requires a bare single-arg call, which
// no longer exists after the first pass.

import { $ } from "bun"
import { resolve } from "node:path"

const SCHEMA_PATH = resolve(import.meta.dir, "..", "server", "db", "schema", "auth-schema.ts")

// Match `timestamp("col_name")` — a single double-quoted string argument with
// no options object. We deliberately don't match the already-patched form so
// reruns are idempotent.
const TIMESTAMP_RE = /\btimestamp\((\s*"[^"\\]+"\s*)\)/g

async function main(): Promise<void> {
  const file = Bun.file(SCHEMA_PATH)
  if (!(await file.exists())) {
    console.error(`patch-auth-schema: ${SCHEMA_PATH} not found — did auth:gen run?`)
    process.exit(1)
  }

  const before = await file.text()
  let replacements = 0
  const after = before.replace(TIMESTAMP_RE, (_match, arg: string) => {
    replacements++
    return `timestamp(${arg.trim()}, { withTimezone: true, mode: "date" })`
  })

  if (replacements === 0) {
    console.log("patch-auth-schema: no bare timestamp(...) calls found — already patched, skipping")
    return
  }

  await Bun.write(SCHEMA_PATH, after)
  console.log(`patch-auth-schema: rewrote ${replacements} timestamp(...) call(s) to withTimezone`)

  // Re-run oxfmt so the file matches the repo's formatter output.
  await $`oxfmt --write ${SCHEMA_PATH}`.quiet()
}

await main()
