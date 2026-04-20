import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { addConfig, deleteConfig, listConfigs, updateConfig } from "./storage"
import type { Config } from "../types"

type Shape = { configs?: Config[] }
const stubChromeStorage = () => {
  const state: Shape = {}
  const mock = {
    storage: {
      local: {
        get: (keys: string[] | null) => {
          if (keys === null) return Promise.resolve({ ...state })
          const out: Record<string, unknown> = {}
          for (const k of keys) if (k in state) out[k] = (state as Record<string, unknown>)[k]
          return Promise.resolve(out)
        },
        set: (partial: Shape) => {
          Object.assign(state, partial)
          return Promise.resolve()
        },
      },
    },
  }
  ;(globalThis as unknown as { chrome: typeof mock }).chrome = mock
  return state
}

describe("storage", () => {
  beforeEach(() => stubChromeStorage())
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome
  })

  test("listConfigs returns empty array when unset", async () => {
    expect(await listConfigs()).toEqual([])
  })

  test("addConfig appends with a generated id and createdAt", async () => {
    const c = await addConfig({
      label: "staging",
      origin: "https://staging.acme.com",
      projectKey: "rp_pk_abcdefghijklmnopqrstuvwx",
      intakeEndpoint: "https://repro.example.com",
    })
    expect(c.id).toMatch(/[0-9a-f-]{36}/)
    expect(c.createdAt).toBeGreaterThan(0)
    expect(await listConfigs()).toHaveLength(1)
  })

  test("updateConfig replaces a matching entry by id", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
    })
    await updateConfig(c.id, { label: "a-renamed" })
    const [updated] = await listConfigs()
    expect(updated?.label).toBe("a-renamed")
  })

  test("deleteConfig removes the matching entry", async () => {
    const c = await addConfig({
      label: "a",
      origin: "https://a.example",
      projectKey: "rp_pk_aaaaaaaaaaaaaaaaaaaaaaaa",
      intakeEndpoint: "https://repro.example.com",
    })
    await deleteConfig(c.id)
    expect(await listConfigs()).toEqual([])
  })
})
