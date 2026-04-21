import type { Mirror } from "../mirror"
import { EventType, IncrementalSource, type IncrementalSnapshotEvent } from "../types"

/**
 * Capture CSS-rule mutations made via CSSOM methods so replays don't drop
 * styles that were injected after the FullSnapshot. This matters most for:
 *   - styled-components / Emotion / Stitches / vanilla-extract: each dynamic
 *     component insertion calls `sheet.insertRule(...)` at runtime.
 *   - Tailwind JIT in dev mode, which rewrites the stylesheet live.
 *   - Animation frameworks that programmatically add keyframe rules.
 * Without this observer, the FullSnapshot's `_cssText` freezes whatever was
 * there at recording start; every new rule is invisible to the replay and
 * the page looks progressively more broken as replay advances.
 *
 * Implementation patches `CSSStyleSheet.prototype.insertRule/deleteRule/
 * replace/replaceSync`. The `ownerNode` of a CSSStyleSheet is the `<style>`
 * or `<link rel="stylesheet">` element it came from — we look up the Mirror
 * id off that. Constructable stylesheets (no `ownerNode`, used via
 * `document.adoptedStyleSheets`) are handled by the adopted-stylesheet
 * observer.
 */
export interface StyleSheetRuleObserverOptions {
  doc: Document
  mirror: Mirror
  emit(ev: IncrementalSnapshotEvent): void
  now: () => number
}

export function createStyleSheetRuleObserver(opts: StyleSheetRuleObserverOptions): {
  start(): void
  stop(): void
} {
  const win = opts.doc.defaultView as (Window & typeof globalThis) | null
  const restores: Array<() => void> = []

  function idForSheet(sheet: CSSStyleSheet): number | undefined {
    const owner = sheet.ownerNode as Node | null
    if (!owner) return undefined
    return opts.mirror.getId(owner)
  }

  function emit(
    sheet: CSSStyleSheet,
    payload: {
      replace?: string
      adds?: Array<{ rule: string; index?: number }>
      removes?: Array<{ index: number }>
    },
  ): void {
    const id = idForSheet(sheet)
    if (id === undefined) return // constructable sheet — let AdoptedStyleSheet handle it
    opts.emit({
      type: EventType.IncrementalSnapshot,
      data: { source: IncrementalSource.StyleSheetRule, id, ...payload },
      timestamp: opts.now(),
    })
  }

  function patch(
    key: string,
    factory: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown,
  ): void {
    if (!win) return
    const proto = win.CSSStyleSheet.prototype as unknown as Record<string, unknown>
    // Walk up the prototype chain — some DOM implementations hang the
    // method on a shared ancestor (StylesheetBase, AbstractStyleSheet) and
    // `getOwnPropertyDescriptor` on the exact prototype returns undefined.
    let target: object | null = proto
    let desc: PropertyDescriptor | undefined
    while (target && !desc) {
      desc = Object.getOwnPropertyDescriptor(target, key)
      if (!desc) target = Object.getPrototypeOf(target)
    }
    if (!target || !desc || typeof desc.value !== "function") return
    const original = desc.value as (...args: unknown[]) => unknown
    try {
      Object.defineProperty(target, key, {
        ...desc,
        writable: true,
        configurable: true,
        value: factory(original),
      })
    } catch {
      return
    }
    const hostObj = target
    restores.push(() => {
      try {
        Object.defineProperty(hostObj, key, desc)
      } catch {
        /* best-effort */
      }
    })
  }

  return {
    start() {
      if (!win || !win.CSSStyleSheet) return

      patch(
        "insertRule",
        (original) =>
          function patchedInsertRule(this: CSSStyleSheet, ...args: unknown[]): unknown {
            const out = original.apply(this, args)
            const rule = args[0] as string
            const index = args[1] as number | undefined
            try {
              emit(this, { adds: [{ rule, ...(index !== undefined ? { index } : {}) }] })
            } catch {
              /* swallow — never break host */
            }
            return out
          },
      )

      patch(
        "deleteRule",
        (original) =>
          function patchedDeleteRule(this: CSSStyleSheet, ...args: unknown[]): unknown {
            const out = original.apply(this, args)
            const index = args[0] as number
            try {
              emit(this, { removes: [{ index }] })
            } catch {
              /* swallow */
            }
            return out
          },
      )

      // `replace()` returns Promise<CSSStyleSheet>; `replaceSync()` is
      // synchronous. Both take the full text and blow away prior rules —
      // emit as a `replace` payload so rrweb-player reloads the sheet text
      // wholesale. Some DOMs only implement one of the two.
      patch(
        "replace",
        (original) =>
          function patchedReplace(this: CSSStyleSheet, ...args: unknown[]): unknown {
            const out = original.apply(this, args)
            try {
              emit(this, { replace: args[0] as string })
            } catch {
              /* swallow */
            }
            return out
          },
      )
      patch(
        "replaceSync",
        (original) =>
          function patchedReplaceSync(this: CSSStyleSheet, ...args: unknown[]): unknown {
            const out = original.apply(this, args)
            try {
              emit(this, { replace: args[0] as string })
            } catch {
              /* swallow */
            }
            return out
          },
      )
    },
    stop() {
      for (const restore of restores) restore()
      restores.length = 0
    },
  }
}
