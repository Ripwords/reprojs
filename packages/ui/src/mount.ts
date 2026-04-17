// packages/ui/src/mount.ts
import { h, render } from "preact"
import { useState } from "preact/hooks"
import { Launcher } from "./launcher"
import { Reporter, type ReporterSubmitResult } from "./reporter"
import { createShadowHost, injectStyles, unmountShadowHost } from "./shadow"
import cssText from "./styles-inline"

export interface MountOptions {
  config: {
    position: "bottom-right" | "bottom-left" | "top-right" | "top-left"
    launcher: boolean
  }
  capture: () => Promise<Blob | null>
  onSubmit: (payload: {
    title: string
    description: string
    screenshot: Blob | null
  }) => Promise<ReporterSubmitResult>
}

let _setOpenExternal: ((v: boolean) => void) | null = null
let _capture: () => Promise<Blob | null> = async () => null
let _onSubmit: MountOptions["onSubmit"] = async () => ({
  ok: false,
  message: "not mounted",
})
let _position: MountOptions["config"]["position"] = "bottom-right"
let _launcher = true
let _root: ShadowRoot | null = null
let _container: HTMLElement | null = null

function App() {
  const [isOpen, setOpen] = useState(false)
  _setOpenExternal = setOpen
  return h(
    "div",
    null,
    _launcher ? h(Launcher, { position: _position, onClick: () => setOpen(true) }) : null,
    isOpen
      ? h(Reporter, {
          onClose: () => setOpen(false),
          onCapture: _capture,
          onSubmit: _onSubmit,
        })
      : null,
  )
}

export function mount(opts: MountOptions) {
  _position = opts.config.position
  _launcher = opts.config.launcher
  _capture = opts.capture
  _onSubmit = opts.onSubmit
  _root = createShadowHost()
  injectStyles(_root, cssText as unknown as string)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
}

export function open() {
  _setOpenExternal?.(true)
}

export function close() {
  _setOpenExternal?.(false)
}

export function unmount() {
  if (_container) render(null, _container)
  unmountShadowHost()
  _container = null
  _root = null
  _setOpenExternal = null
}
