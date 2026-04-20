import { useEffect, useState } from "preact/hooks"
import type { Config } from "../types"
import { deleteConfig, listConfigs } from "../lib/storage"
import { removeOriginPermission } from "../lib/permissions"
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
    </div>
  )
}
