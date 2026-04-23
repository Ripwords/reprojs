// Annotation shape IDs are used as React keys and for de-dup only — not security-sensitive.
// `crypto.randomUUID` exists in Node / Bun / browsers but NOT in React Native's Hermes runtime,
// so fall back to a Math.random UUID v4 when the Web Crypto API isn't available.

function uuidv4Fallback(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function newShapeId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  const randomUUID = g.crypto?.randomUUID
  if (typeof randomUUID === "function") {
    try {
      return randomUUID.call(g.crypto)
    } catch {
      // fall through to the Math.random path
    }
  }
  return uuidv4Fallback()
}
