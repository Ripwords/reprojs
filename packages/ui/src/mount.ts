// packages/ui/src/mount.ts
import { h, render } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
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
    dwellMs: number
    honeypot: string
  }) => Promise<ReporterSubmitResult>
  // Fired when the wizard opens (launcher click or programmatic open()).
  // Core uses this to pause the rolling replay buffer so the recording
  // captures pre-click activity, not the user's annotation work inside
  // the wizard.
  onOpen?: () => void
  // Fired when the wizard closes (cancel, submit-success auto-close, or
  // programmatic close()). Core uses this to resume the replay buffer.
  onClose?: () => void
}

let _setOpenExternal: ((v: boolean) => void) | null = null
let _setOpenedAtExternal: ((v: number) => void) | null = null
let _openedAt = 0
let _capture: () => Promise<Blob | null> = async () => null
let _onSubmit: MountOptions["onSubmit"] = async () => ({
  ok: false,
  message: "not mounted",
})
let _onOpen: (() => void) | undefined
let _onClose: (() => void) | undefined
let _position: MountOptions["config"]["position"] = "bottom-right"
let _launcher = true
let _root: ShadowRoot | null = null
let _container: HTMLElement | null = null

function App() {
  const [isOpen, setOpen] = useState(false)
  const [openedAt, setOpenedAt] = useState(0)
  _setOpenExternal = setOpen
  _setOpenedAtExternal = setOpenedAt

  // Fire onOpen/onClose on every transition. useEffect on the boolean
  // means a single source of truth regardless of which path triggered the
  // change (launcher click, programmatic open(), Reporter cancel button,
  // or post-submit auto-close). Skip the initial mount so we don't fire
  // onClose before the user has done anything — that would resume a
  // recording the user never paused, defeating any future "start paused"
  // flow.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    if (isOpen) _onOpen?.()
    else _onClose?.()
  }, [isOpen])

  function handleLauncherClick() {
    const now = performance.now()
    _openedAt = now
    setOpenedAt(now)
    setOpen(true)
  }

  return h(
    "div",
    null,
    _launcher ? h(Launcher, { position: _position, onClick: handleLauncherClick }) : null,
    isOpen
      ? h(Reporter, {
          onClose: () => setOpen(false),
          onCapture: _capture,
          onSubmit: _onSubmit,
          openedAt,
        })
      : null,
  )
}

export function mount(opts: MountOptions) {
  _position = opts.config.position
  _launcher = opts.config.launcher
  _capture = opts.capture
  _onSubmit = opts.onSubmit
  _onOpen = opts.onOpen
  _onClose = opts.onClose
  _root = createShadowHost()
  injectStyles(_root, cssText)
  _container = document.createElement("div")
  _root.appendChild(_container)
  render(h(App, null), _container)
}

export function open() {
  _openedAt = performance.now()
  _setOpenedAtExternal?.(_openedAt)
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
  _setOpenedAtExternal = null
  _openedAt = 0
  _capture = async () => null
  _onSubmit = async () => ({ ok: false, message: "not mounted" })
  _onOpen = undefined
  _onClose = undefined
  _position = "bottom-right"
  _launcher = true
}
