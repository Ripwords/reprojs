import { useEffect, useState } from "preact/hooks"
import type { Config, ConfigInput } from "../types"
import { addConfig, deleteConfig, listConfigs } from "../lib/storage"
import { removeOriginPermission, requestOriginPermission } from "../lib/permissions"
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
    const granted = await requestOriginPermission(input.origin)
    if (!granted) {
      return { ok: false, message: "Host permission denied for this origin." }
    }
    await addConfig(input)
    await refresh()
    return { ok: true }
  }

  async function handleDelete(id: string) {
    const target = configs.find((c) => c.id === id)
    if (!target) return
    await deleteConfig(id)
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
