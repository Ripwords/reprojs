import type { Config, ConfigInput } from "../types"

const KEY = "configs"

async function readAll(): Promise<Config[]> {
  const result = await chrome.storage.local.get([KEY])
  const value = (result as { configs?: Config[] }).configs
  return value ?? []
}

async function writeAll(configs: Config[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: configs })
}

export async function listConfigs(): Promise<Config[]> {
  return readAll()
}

export async function addConfig(input: ConfigInput): Promise<Config> {
  const config: Config = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }
  const all = await readAll()
  await writeAll([...all, config])
  return config
}

export async function updateConfig(id: string, patch: Partial<ConfigInput>): Promise<void> {
  const all = await readAll()
  const next = all.map((c) => (c.id === id ? { ...c, ...patch } : c))
  await writeAll(next)
}

export async function deleteConfig(id: string): Promise<void> {
  const all = await readAll()
  await writeAll(all.filter((c) => c.id !== id))
}
