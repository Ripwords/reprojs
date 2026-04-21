import { useEffect, useState } from "preact/hooks"
import { toOrigin } from "../lib/origin"

// When the user clicks the extension icon, the popup opens with context about
// the tab they came from. Query the active tab's URL once on mount and expose
// its origin so the Add-form can pre-fill it. Returns null until resolved, or
// if the tab is on a non-injectable scheme (chrome://, file://, etc.).
export function useActiveTabOrigin(): string | null {
  const [origin, setOrigin] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const url = tabs[0]?.url
        if (!url || cancelled) return
        const derived = toOrigin(url)
        if (derived !== null) setOrigin(derived)
      } catch {
        // permission race / tabs API unavailable — leave null, form works fine.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return origin
}
