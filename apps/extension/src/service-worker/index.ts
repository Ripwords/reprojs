import { installBridge } from "../bootstrap/bridge"
import { bootRepro, injectConfig } from "../bootstrap/set-config"
import { installFetchProxy } from "../bootstrap/proxy-fetch"
import { findConfigForUrl, toOrigin } from "../lib/origin"
import { hasOriginPermission } from "../lib/permissions"
import { listConfigs } from "../lib/storage"
import { registerProxyHandler } from "./proxy-handler"

registerProxyHandler()

// Per-tab dedupe + in-flight lock. Two concurrent tabs.onUpdated firings for
// the same tab (common on framework dev servers that emit multiple complete
// events per navigation) would otherwise both pass the "have I injected?"
// check and race through the executeScript chain, with the second IIFE load
// colliding with the first on attachShadow. Set the Map BEFORE the awaited
// work so the second tryInject sees the entry and bails. Clear on throw or
// explicit URL change.
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

  let intakeOrigin: string
  try {
    intakeOrigin = new URL(match.intakeEndpoint).origin
  } catch {
    injectedForTab.delete(tabId)
    console.debug("[repro-extension] bad intakeEndpoint in config", match.id)
    return
  }

  try {
    // 1. Write __REPRO_CONFIG__ into the page world.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: injectConfig,
      args: [match.projectKey, match.intakeEndpoint],
    })
    // 2. Install the fetch proxy BEFORE the SDK loads so the SDK's intake
    //    POST is routed through the service worker instead of hitting the
    //    page's connect-src CSP.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      func: installFetchProxy,
      args: [intakeOrigin],
    })
    // 3. Install the ISOLATED-world bridge so window.postMessage from the
    //    fetch proxy can reach chrome.runtime.sendMessage.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      func: installBridge,
    })
    // 4. Load the bundled SDK IIFE in the page world.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      files: ["repro.iife.js"],
    })
    // 5. Call Repro.init(). Guarded against double-init inside bootRepro.
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
