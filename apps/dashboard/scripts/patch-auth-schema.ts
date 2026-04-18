#!/usr/bin/env bun
// apps/dashboard/scripts/patch-auth-schema.ts
//
// Post-processor for better-auth's generated `auth-schema.ts`.
//
// Two transforms, both idempotent:
//
// 1. timestamp → timestamptz
//    `@better-auth/cli generate` emits `timestamp("col_name")` for every
//    datetime column when the adapter is `pg`. That maps to Postgres `timestamp`
//    (a.k.a. "timestamp without time zone"), which stores naïve values and drifts
//    if the session TZ ever differs from UTC. The rest of this codebase uses
//    `timestamptz` via `{ withTimezone: true }`, and we want auth to match.
//
//    The CLI has no config flag for this (verified against
//    node_modules/@better-auth/cli/dist/generators-*.mjs — the pg mapping is
//    hardcoded: `timestamp('${name}')`), so we rewrite the file after generation.
//
//    The transform only matches the exact single-arg form the CLI emits:
//      timestamp("some_col")
//    and upgrades it to:
//      timestamp("some_col", { withTimezone: true, mode: "date" })
//
// 2. unique partial index on user.invite_token
//    The CLI emits `pgTable("user", { ... })` with no options callback, so
//    there's nowhere to declare indexes on the user table. We need a unique
//    index on `invite_token` so (a) accept-time lookups are O(log n) and
//    (b) the DB rejects duplicate pending tokens. A partial predicate scopes
//    the uniqueness to rows still holding a token — once an invite is accepted
//    the token is nulled out, and those rows must not collide with each other.
//
//    We rewrite the single-arg `pgTable("user", { ... })` call into the
//    two-arg form `pgTable("user", { ... }, (table) => [ ... ])` and make sure
//    the imports include `uniqueIndex` and `sql`.
//
// Running the script twice is a no-op for both transforms:
//   - The timestamp regex requires a bare single-arg call, which no longer
//     exists after the first pass.
//   - The user-index transform checks whether `user_invite_token_idx` already
//     appears in the file and skips if so.

import { $ } from "bun"
import { resolve } from "node:path"

const SCHEMA_PATH = resolve(import.meta.dir, "..", "server", "db", "schema", "auth-schema.ts")

// Match `timestamp("col_name")` — a single double-quoted string argument with
// no options object. We deliberately don't match the already-patched form so
// reruns are idempotent.
const TIMESTAMP_RE = /\btimestamp\((\s*"[^"\\]+"\s*)\)/g

const USER_INVITE_IDX_NAME = "user_invite_token_idx"

// Match the entire `export const user = pgTable("user", { ... })` declaration
// in its single-arg form. Captures the body block so we can splice the options
// callback after it. The `[^]` trick matches across newlines without the `s`
// flag (preserves compatibility with older runtimes if ever needed).
// We deliberately anchor the closing paren to `}\)` with no preceding comma,
// so if a `(table) => [...]` block is ever already present this regex won't
// match (second run → no-op).
const USER_TABLE_RE = /export const user = pgTable\("user", (\{[^]*?\n\})\)/

function patchTimestamps(src: string): { out: string; count: number } {
  let count = 0
  const out = src.replace(TIMESTAMP_RE, (_match, arg: string) => {
    count++
    return `timestamp(${arg.trim()}, { withTimezone: true, mode: "date" })`
  })
  return { out, count }
}

function ensureImports(src: string): { out: string; changed: boolean } {
  // The generated file starts with:
  //   import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core"
  //   import { relations } from "drizzle-orm"
  // We need `uniqueIndex` from pg-core and `sql` from drizzle-orm.
  let out = src
  let changed = false

  const pgCoreImportRe = /import \{([^}]+)\} from "drizzle-orm\/pg-core"/
  const pgCoreMatch = pgCoreImportRe.exec(out)
  if (!pgCoreMatch) {
    throw new Error("patch-auth-schema: could not find drizzle-orm/pg-core import line")
  }
  const pgCoreNames = pgCoreMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (!pgCoreNames.includes("uniqueIndex")) {
    pgCoreNames.push("uniqueIndex")
    out = out.replace(
      pgCoreImportRe,
      `import { ${pgCoreNames.join(", ")} } from "drizzle-orm/pg-core"`,
    )
    changed = true
  }

  const drizzleImportRe = /import \{([^}]+)\} from "drizzle-orm"/
  const drizzleMatch = drizzleImportRe.exec(out)
  if (!drizzleMatch) {
    throw new Error("patch-auth-schema: could not find drizzle-orm import line")
  }
  const drizzleNames = drizzleMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (!drizzleNames.includes("sql")) {
    drizzleNames.push("sql")
    out = out.replace(drizzleImportRe, `import { ${drizzleNames.join(", ")} } from "drizzle-orm"`)
    changed = true
  }

  return { out, changed }
}

function patchUserInviteIndex(src: string): { out: string; applied: boolean } {
  if (src.includes(USER_INVITE_IDX_NAME)) {
    return { out: src, applied: false }
  }

  const match = USER_TABLE_RE.exec(src)
  if (!match) {
    throw new Error(
      'patch-auth-schema: could not locate single-arg `export const user = pgTable("user", {...})` declaration',
    )
  }

  const body = match[1]
  const replacement =
    `export const user = pgTable("user", ${body}, (table) => [\n` +
    `  uniqueIndex("${USER_INVITE_IDX_NAME}")\n` +
    `    .on(table.inviteToken)\n` +
    `    .where(sql\`\${table.inviteToken} is not null\`),\n` +
    `])`

  const out = src.replace(USER_TABLE_RE, replacement)
  return { out, applied: true }
}

async function main(): Promise<void> {
  const file = Bun.file(SCHEMA_PATH)
  if (!(await file.exists())) {
    console.error(`patch-auth-schema: ${SCHEMA_PATH} not found — did auth:gen run?`)
    process.exit(1)
  }

  const before = await file.text()

  const tsResult = patchTimestamps(before)
  const importsResult = ensureImports(tsResult.out)
  const indexResult = patchUserInviteIndex(importsResult.out)

  const anyChange = tsResult.count > 0 || importsResult.changed || indexResult.applied

  if (!anyChange) {
    console.log(
      "patch-auth-schema: nothing to do — timestamps, imports, and user_invite_token_idx already patched",
    )
    return
  }

  await Bun.write(SCHEMA_PATH, indexResult.out)
  const parts: string[] = []
  if (tsResult.count > 0) parts.push(`${tsResult.count} timestamp(...) call(s)`)
  if (importsResult.changed) parts.push("imports (uniqueIndex, sql)")
  if (indexResult.applied) parts.push(USER_INVITE_IDX_NAME)
  console.log(`patch-auth-schema: patched ${parts.join(", ")}`)

  // Re-run oxfmt so the file matches the repo's formatter output. `auth:gen`
  // invokes this script from `cd apps/dashboard`, where oxfmt isn't on PATH;
  // fall back to the repo-root node_modules binary so the script works
  // regardless of cwd.
  try {
    await $`oxfmt --write ${SCHEMA_PATH}`.quiet()
  } catch {
    const localOxfmt = resolve(import.meta.dir, "..", "..", "..", "node_modules", ".bin", "oxfmt")
    await $`${localOxfmt} --write ${SCHEMA_PATH}`.quiet()
  }
}

await main()
