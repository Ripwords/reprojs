import { findConfigForUrl, toOrigin } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { listConfigs } from "../lib/storage"
import { bootRepro, injectConfig } from "../bootstrap/set-config"

// Per-tab dedupe + in-flight lock. Two concurrent tabs.onUpdated firings for
// the same tab (common on framework dev servers that emit multiple complete
// events per navigation) would otherwise both pass the "have I injected?"
// check and race through the 3-step executeScript chain. Each IIFE load gets
// its own module-scoped WeakMap for the shadow-DOM host, so the second race
// winner tries to re-attachShadow on the host the first race already
// claimed, and the attachShadow call throws NotSupportedError.
//
// Fix: set the Map BEFORE the awaited work so the second tryInject sees the
// entry and bails. Clear on explicit URL change or failure, so real
// navigations and permission-denied cases can re-inject correctly.
//
// The Map is lost when the service worker is torn down (~30s idle in MV3).
// The bootRepro DOM-existence check in set-config.ts is the backstop for
// that case — page-world state survives worker revivals.
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

  // Reserve the slot BEFORE awaiting so the next concurrent tryInject for
  // this tab sees the entry and bails. Clear on error so a genuine
  // permission/navigation failure can retry on the next onUpdated cycle.
  injectedForTab.set(tabId, origin)

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
    injectedForTab.delete(tabId)
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
