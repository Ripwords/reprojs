export type MeasureFn = (text: string) => { width: number }

export function wrapText(measure: MeasureFn, text: string, maxWidth: number): string[] {
  if (text.length === 0) return []

  const lines: string[] = []
  const paragraphs = text.split("\n")

  for (const para of paragraphs) {
    if (para.length === 0) {
      lines.push("")
      continue
    }

    const words = para.split(" ")
    let current = ""

    for (const word of words) {
      const candidate = current.length > 0 ? `${current} ${word}` : word
      if (measure(candidate).width <= maxWidth) {
        current = candidate
        continue
      }

      if (current.length > 0) {
        lines.push(current)
        current = ""
      }

      if (measure(word).width <= maxWidth) {
        current = word
        continue
      }

      let piece = ""
      for (const ch of word) {
        const cand = piece + ch
        if (measure(cand).width <= maxWidth) {
          piece = cand
        } else {
          if (piece.length > 0) lines.push(piece)
          piece = ch
        }
      }
      current = piece
    }

    lines.push(current)
  }

  return lines
}
