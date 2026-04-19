import { onMounted, onBeforeUnmount } from "vue"

export interface ShortcutMap {
  [key: string]: (event: KeyboardEvent) => void
}

/**
 * Registers document-level keyboard shortcuts. Keys are lowercase single chars
 * or the special values `"escape"`, `"enter"`. Shortcuts are suppressed when
 * the event target is an editable element (input, textarea, contenteditable).
 */
export function useKeyboardShortcuts(map: ShortcutMap): void {
  function handler(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (target.isContentEditable) return
    }
    const key = event.key.toLowerCase()
    const fn = map[key]
    if (!fn) return
    fn(event)
  }

  onMounted(() => document.addEventListener("keydown", handler))
  onBeforeUnmount(() => document.removeEventListener("keydown", handler))
}
