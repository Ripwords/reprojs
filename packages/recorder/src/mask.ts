export type MaskingMode = "strict" | "moderate" | "minimal"

export interface MaskConfig {
  masking: MaskingMode
  maskSelectors?: string[]
  blockSelectors?: string[]
}

export interface Mask {
  shouldMaskInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean
  shouldBlock(el: Element): boolean
  maskValue(value: string): string
}

const MODERATE_MASKED_TYPES = new Set(["password", "email", "tel", "number"])

function hasMaskedAncestor(el: Element): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.hasAttribute?.("data-feedback-mask")) return true
    cur = cur.parentElement
  }
  return false
}

function hasBlockedAncestor(el: Element): boolean {
  let cur: Element | null = el
  while (cur) {
    if (cur.hasAttribute?.("data-feedback-block")) return true
    cur = cur.parentElement
  }
  return false
}

function matchesAny(el: Element, selectors: string[]): boolean {
  for (const sel of selectors) {
    try {
      if (el.matches(sel)) return true
    } catch {
      // invalid selector — ignore
    }
  }
  return false
}

export function createMask(config: MaskConfig): Mask {
  const { masking } = config
  const maskSelectors = config.maskSelectors ?? []
  const blockSelectors = config.blockSelectors ?? []

  return {
    shouldMaskInput(el) {
      if (hasMaskedAncestor(el)) return true
      if (matchesAny(el, maskSelectors)) return true
      if (masking === "strict") return true
      const tag = el.tagName
      if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type?.toLowerCase() ?? "text"
        if (type === "password") return true
        if (masking === "moderate" && MODERATE_MASKED_TYPES.has(type)) return true
      }
      return false
    },
    shouldBlock(el) {
      if (hasBlockedAncestor(el)) return true
      return matchesAny(el, blockSelectors)
    },
    maskValue(value) {
      return "*".repeat(value.length)
    },
  }
}
