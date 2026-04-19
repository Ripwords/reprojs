import { ref, shallowRef } from "vue"

export type ConfirmColor = "primary" | "error" | "warning" | "neutral"

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: ConfirmColor
  icon?: string
}

interface ConfirmState extends Required<Omit<ConfirmOptions, "description" | "icon">> {
  description: string | undefined
  icon: string | undefined
}

const DEFAULT_STATE: ConfirmState = {
  title: "",
  description: undefined,
  confirmLabel: "Confirm",
  cancelLabel: "Cancel",
  confirmColor: "primary",
  icon: undefined,
}

// Module-scope singleton — the host component mounted by default.vue reads
// from these refs, and call sites write to them via `confirm()`. Client-only
// by nature: `confirm()` is triggered from user events, so SSR never touches
// this module's reactive state.
const open = ref(false)
const state = ref<ConfirmState>({ ...DEFAULT_STATE })
const resolver = shallowRef<((value: boolean) => void) | null>(null)

function settle(value: boolean) {
  const fn = resolver.value
  resolver.value = null
  open.value = false
  fn?.(value)
}

export function useConfirm() {
  function confirm(options: ConfirmOptions): Promise<boolean> {
    // If a previous dialog is still open (unlikely, but possible if the user
    // triggers two at once), resolve it as `false` before replacing.
    if (resolver.value) settle(false)
    state.value = { ...DEFAULT_STATE, ...options }
    open.value = true
    return new Promise<boolean>((resolve) => {
      resolver.value = resolve
    })
  }

  return { confirm }
}

// Internal API for the host component.
export function _useConfirmHost() {
  function accept() {
    settle(true)
  }
  function cancel() {
    settle(false)
  }
  return { open, state, accept, cancel }
}
