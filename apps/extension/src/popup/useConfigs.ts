import { useCallback, useEffect, useState } from "preact/hooks"
import type { Config, ConfigInput } from "../types"
import {
  hasOriginPermission,
  removeOriginPermission,
  requestOriginPermission,
  requestOriginPermissions,
} from "../lib/permissions"
import { addConfig, deleteConfig, listConfigs } from "../lib/storage"

export type PermissionStatus = "granted" | "pending"
export type ConfigWithStatus = Config & { permission: PermissionStatus }

function safeIntakeOrigin(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin
  } catch {
    return null
  }
}

async function computeStatus(configs: readonly Config[]): Promise<ConfigWithStatus[]> {
  return Promise.all(
    configs.map(async (c) => {
      const intake = safeIntakeOrigin(c.intakeEndpoint)
      const [pageOk, intakeOk] = await Promise.all([
        hasOriginPermission(c.origin),
        intake ? hasOriginPermission(intake) : Promise.resolve(true),
      ])
      return { ...c, permission: pageOk && intakeOk ? "granted" : "pending" }
    }),
  )
}

// The popup dies the instant Chrome shows the native permission prompt, which
// cancels any pending async JS after the `await requestOriginPermissions(...)`
// line. The config save has to run BEFORE that prompt appears so it persists
// even when the popup disappears. If the user denies or ignores the prompt,
// the config still shows up next time they open the popup — marked "pending"
// with a Grant button.
export function useConfigs() {
  const [items, setItems] = useState<ConfigWithStatus[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const stored = await listConfigs()
    const withStatus = await computeStatus(stored)
    setItems(withStatus)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onChange = (): void => {
      void refresh()
    }
    chrome.permissions.onAdded.addListener(onChange)
    chrome.permissions.onRemoved.addListener(onChange)
    return () => {
      chrome.permissions.onAdded.removeListener(onChange)
      chrome.permissions.onRemoved.removeListener(onChange)
    }
  }, [refresh])

  const add = useCallback(
    async (input: ConfigInput): Promise<{ ok: true } | { ok: false; message: string }> => {
      const intakeOrigin = safeIntakeOrigin(input.intakeEndpoint)
      if (intakeOrigin === null) {
        return { ok: false, message: "Invalid intake endpoint URL." }
      }
      // Persist FIRST — survives popup tear-down triggered by the native
      // permission prompt.
      await addConfig(input)
      await refresh()
      // Fire-and-forget the permission request. Whether it resolves before
      // the popup dies or after is irrelevant now: storage is already
      // committed, and chrome.permissions.onAdded will wake up this list
      // the next time the popup opens.
      void requestOriginPermissions([input.origin, intakeOrigin])
      return { ok: true }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      const target = items.find((c) => c.id === id)
      if (!target) return
      await deleteConfig(id)
      // Drop only the page-origin permission. The intake origin may still be
      // in use by another config pointing at the same dashboard; dropping it
      // here would force the user to re-grant it for the next config.
      await removeOriginPermission(target.origin)
      await refresh()
    },
    [items, refresh],
  )

  const regrant = useCallback(
    async (id: string): Promise<void> => {
      const target = items.find((c) => c.id === id)
      if (!target) return
      const intakeOrigin = safeIntakeOrigin(target.intakeEndpoint)
      if (intakeOrigin === null) {
        void requestOriginPermission(target.origin)
        return
      }
      void requestOriginPermissions([target.origin, intakeOrigin])
    },
    [items],
  )

  return { items, loading, refresh, add, remove, regrant }
}
