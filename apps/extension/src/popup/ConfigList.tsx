import type { Config } from "../types"

type Props = {
  configs: Config[]
  onDelete: (id: string) => void
}

export function ConfigList({ configs, onDelete }: Props) {
  if (configs.length === 0) {
    return <p class="empty">No origins configured yet.</p>
  }
  return (
    <ul class="config-list">
      {configs.map((c) => (
        <li key={c.id} class="config-item">
          <div>
            <div class="label">{c.label}</div>
            <div class="origin">{c.origin}</div>
          </div>
          <button class="btn danger" onClick={() => onDelete(c.id)} type="button">
            Remove
          </button>
        </li>
      ))}
    </ul>
  )
}
