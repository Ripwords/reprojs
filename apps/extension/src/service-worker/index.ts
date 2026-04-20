import { findConfigForUrl, toOrigin } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { listConfigs } from "../lib/storage"
import { bootRepro, injectConfig } from "../bootstrap/set-config"

// Per-tab dedupe: remember the last origin we injected for each tab. Chrome
// fires tabs.onUpdated with status==="complete" multiple times during a
// single navigation on framework-heavy pages (Next.js dev, subframe loads,
// Fast Refresh cycles), so without this we'd re-run the 3-step inject chain
// and end up with a second IIFE load fighting the first for the shadow-DOM
// host. The bootRepro sentinel is the backstop; this is the cheap check
// that avoids even calling executeScript.
//
// The Map is lost when the service worker is torn down (~30s idle in MV3),
// but the bootRepro sentinel survives in page-world state, so re-entry after
// a worker revival is still safe.
const injectedForTab = new Map<number, string>()

async function tryInject(tabId: number, url: string): Promise<void> {
  const origin = toOrigin(url)
  if (origin === null) return

  if (injectedForTab.get(tabId) === origin) return

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
    injectedForTab.set(tabId, origin)
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

// A real navigation (not an HMR cycle) should clear the dedupe key so the
// SDK gets a fresh mount on the new page. changeInfo.url is only populated
// when the tab's URL actually changed — Fast Refresh and subframe completes
// don't emit it.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    injectedForTab.delete(tabId)
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedForTab.delete(tabId)
})
