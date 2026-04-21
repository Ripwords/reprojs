import { useEffect, useState } from "preact/hooks"
import type { Config, ConfigInput } from "../types"
import { addConfig, deleteConfig, listConfigs } from "../lib/storage"
import { removeOriginPermission, requestOriginPermissions } from "../lib/permissions"
import { AddConfigForm } from "./AddConfigForm"
import { ConfigList } from "./ConfigList"
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "./styles.css"

export function App() {
  const [configs, setConfigs] = useState<Config[]>([])

  async function refresh() {
    setConfigs(await listConfigs())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleAdd(
    input: ConfigInput,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    let intakeOrigin: string
    try {
      intakeOrigin = new URL(input.intakeEndpoint).origin
    } catch {
      return { ok: false, message: "Invalid intake endpoint URL." }
    }
    // Grant both the page origin (for SDK injection) and the intake origin
    // (so the service worker's proxy fetch can reach it from its CSP-less
    // context) in a single consent prompt.
    const granted = await requestOriginPermissions([input.origin, intakeOrigin])
    if (!granted) {
      return {
        ok: false,
        message:
          "Host permission denied — the extension needs access to both the test site and the intake endpoint.",
      }
    }
    await addConfig(input)
    await refresh()
    return { ok: true }
  }

  async function handleDelete(id: string) {
    const target = configs.find((c) => c.id === id)
    if (!target) return
    await deleteConfig(id)
    // Only drop the page-origin permission. Leave the intake-origin permission
    // in place — it may still be in use by another saved config pointing at
    // the same dashboard.
    await removeOriginPermission(target.origin)
    await refresh()
  }

  return (
    <div class="app">
      <h1>Configured origins</h1>
      <ConfigList configs={configs} onDelete={handleDelete} />
      <AddConfigForm onSubmit={handleAdd} />
    </div>
  )
}
