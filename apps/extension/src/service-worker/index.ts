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
