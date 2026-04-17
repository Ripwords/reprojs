// Regenerates packages/ui/src/styles-inline.ts from packages/ui/src/styles.css.
//
// tsdown/rolldown doesn't inline CSS imports as text (it extracts them to a
// side stylesheet), which doesn't work for the SDK's Shadow-DOM-injected
// styles. This script wraps the CSS source in `String.raw` so the IIFE bundle
// can carry it as a runtime string. The import path (./styles-inline) is
// deliberately extension-free + non-.css so formatters don't rewrite it.
//
// Run before `bun run sdk:build` (the root `sdk:build` script does this for you).

import { resolve } from "node:path"

const here = import.meta.dir
const cssPath = resolve(here, "src", "styles.css")
const tsPath = resolve(here, "src", "styles-inline.ts")

const css = await Bun.file(cssPath).text()

const header = `// Auto-generated from styles.css by build-css.ts. Do not edit by hand.
// Run \`bun run packages/ui/build-css.ts\` after editing styles.css.

export default String.raw\``
const footer = `\`\n`

// String.raw template literals preserve almost everything verbatim, except
// backslash sequences and backticks. styles.css has neither in practice, but
// guard against accidents:
if (css.includes("`") || css.includes("${")) {
  throw new Error("styles.css contains `` ` `` or ${ — escape those before inlining")
}

await Bun.write(tsPath, header + css + footer)
console.info(`[build-css] wrote ${tsPath} (${css.length} chars)`)
