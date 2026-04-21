import { AddConfigForm } from "../popup/AddConfigForm"
import { ConfigList } from "../popup/ConfigList"
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "../popup/styles.css"
// oxlint-disable-next-line eslint-plugin-import/no-unassigned-import
import "./styles.css"
import { useConfigs } from "../popup/useConfigs"

export function App() {
  const { items, add, remove, regrant } = useConfigs()

  return (
    <div class="opt-shell">
      <header class="opt-head">
        <span class="opt-title">Repro Tester</span>
        <span class="opt-sub">Extension settings</span>
      </header>

      <div class="opt-body">
        <section class="opt-section">
          <div class="opt-section-head">
            <span class="opt-section-title">
              Configured origins
              {items.length > 0 && <strong>{items.length}</strong>}
            </span>
          </div>
          <ConfigList configs={items} onRemove={remove} onRegrant={regrant} />
        </section>

        <section class="opt-section">
          <div class="opt-section-head">
            <span class="opt-section-title">Add a new origin</span>
          </div>
          <AddConfigForm onSubmit={add} />
        </section>
      </div>

      <footer class="opt-foot">
        <span>v{chrome.runtime.getManifest().version}</span>
        <span>data stays on your device</span>
      </footer>
    </div>
  )
}
