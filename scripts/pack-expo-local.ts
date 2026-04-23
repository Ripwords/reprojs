#!/usr/bin/env bun
// Build @reprojs/expo with its @reprojs/* workspace deps inlined, then `npm pack`
// into a standalone tarball suitable for `pnpm add ./reprojs-expo-*.tgz` in an
// external Expo project — no registry publish, no workspace: resolution needed.
//
// Usage:
//   bun run scripts/pack-expo-local.ts [--dest <dir>] [--install <mobile-app-dir>]
//
// Examples:
//   bun run scripts/pack-expo-local.ts --dest /tmp
//   bun run scripts/pack-expo-local.ts --install ~/Documents/invicta/apps/mobile

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { $ } from "bun"

const REPO_ROOT = resolve(import.meta.dir, "..")
const PKG_DIR = join(REPO_ROOT, "packages/expo")
const TSDOWN_CONFIG = join(PKG_DIR, "tsdown.config.ts")
const PKG_JSON = join(PKG_DIR, "package.json")

function parseArg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return null
  const v = process.argv[i + 1]
  return v ?? null
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
}

const destArg = parseArg("dest")
const installArg = parseArg("install")
const dest = resolve(expandHome(destArg ?? "/tmp"))
const installDir = installArg ? resolve(expandHome(installArg)) : null

if (installDir && !existsSync(installDir)) {
  console.error(`install target does not exist: ${installDir}`)
  process.exit(1)
}

const originalConfig = readFileSync(TSDOWN_CONFIG, "utf8")
const originalPkg = readFileSync(PKG_JSON, "utf8")

// Drop every @reprojs/* from tsdown's external list so the bundle inlines them.
// tsdown externals the main entry's `dependencies` by default, so we also
// strip them out of package.json to avoid consumer resolution errors after
// unpacking the tarball in a repo that can't see the monorepo workspace.
const patchedConfig = originalConfig.replace(
  /external:\s*\[[^\]]*\]/,
  (match) => `${match},\n    noExternal: [/^@reprojs\\//]`,
)

const parsedPkg = JSON.parse(originalPkg) as {
  dependencies?: Record<string, string>
}
if (parsedPkg.dependencies) {
  for (const k of Object.keys(parsedPkg.dependencies)) {
    if (k.startsWith("@reprojs/")) delete parsedPkg.dependencies[k]
  }
}
const patchedPkg = JSON.stringify(parsedPkg, null, 2) + "\n"

function restore() {
  writeFileSync(TSDOWN_CONFIG, originalConfig)
  writeFileSync(PKG_JSON, originalPkg)
}

process.on("SIGINT", () => {
  restore()
  process.exit(130)
})

try {
  writeFileSync(TSDOWN_CONFIG, patchedConfig)
  writeFileSync(PKG_JSON, patchedPkg)

  console.log("→ building with inlined @reprojs/* deps")
  await $`bun run build`.cwd(PKG_DIR).quiet()

  console.log("→ npm pack")
  const out = await $`npm pack --pack-destination ${dest} --silent`.cwd(PKG_DIR).text()
  const filename = out.trim().split("\n").pop()
  if (!filename) throw new Error("npm pack did not report a filename")
  const tarball = join(dest, filename)
  console.log(`→ tarball: ${tarball}`)

  if (installDir) {
    // Use a stable `vendor-` prefix so existing `file:vendor-...` entries in
    // the consumer's package.json keep resolving across re-packs.
    const vendorName = `vendor-${filename}`
    const vendor = join(installDir, vendorName)
    copyFileSync(tarball, vendor)
    console.log(`→ installing into ${installDir}`)
    await $`pnpm add ${`./${vendorName}`}`.cwd(installDir)
    console.log(`→ vendored at ${vendor}`)
  } else {
    console.log("→ install with: pnpm add " + tarball)
  }
} finally {
  restore()
  console.log("→ restored tsdown.config.ts and package.json")
}
