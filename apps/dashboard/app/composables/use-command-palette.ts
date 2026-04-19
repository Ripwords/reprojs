import { readonly, ref } from "vue"

const open = ref(false)

export function useCommandPalette() {
  function openPalette() {
    open.value = true
  }
  function closePalette() {
    open.value = false
  }
  function toggle() {
    open.value = !open.value
  }
  return {
    open: readonly(open),
    openPalette,
    closePalette,
    toggle,
  }
}

// Internal API for the host component.
export function _useCommandPaletteHost() {
  return { open }
}
