import { chromium, expect, test } from "@playwright/test"
import { createServer } from "node:http"
import { readFileSync, mkdtempSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const EXT_PATH = resolvePath(__dirname, "../../dist-e2e")
const FIXTURE = readFileSync(resolvePath(__dirname, "fixtures/test-site.html"), "utf8")

test("injects the SDK on a configured origin", async () => {
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html")
    res.end(FIXTURE)
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  const testOrigin = `http://127.0.0.1:${address.port}`

  const userDataDir = mkdtempSync(resolvePath(tmpdir(), "repro-ext-"))
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-sandbox",
    ],
  })

  try {
    let [sw] = context.serviceWorkers()
    if (!sw) sw = await context.waitForEvent("serviceworker")
    const extId = new URL(sw.url()).host

    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extId}/index.html`)
    await popup.evaluate(
      async ({ origin }) => {
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
      { origin: testOrigin },
    )

    const page = await context.newPage()
    await page.goto(testOrigin)
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
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const address = server.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  const testOrigin = `http://127.0.0.1:${address.port}`

  const userDataDir = mkdtempSync(resolvePath(tmpdir(), "repro-ext-"))
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
    await page.goto(testOrigin)
    await page.waitForTimeout(2000)
    const host = page.locator("#repro-host")
    await expect(host).toHaveCount(0)
  } finally {
    await context.close()
    server.close()
  }
})
