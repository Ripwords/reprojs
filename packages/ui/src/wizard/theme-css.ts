import { tokens as defaultTokens, type Tokens } from "@reprojs/sdk-utils"

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
}

/**
 * Render the token object as a `:host { … }` block of CSS custom properties.
 * The widget's stylesheet uses `var(--ft-color-*)` etc., which resolve at
 * runtime against whatever this function emits. Single source of truth lives
 * in @reprojs/sdk-utils — call sites pass the default `tokens` constant.
 */
export function themeToCssVars(theme: Tokens = defaultTokens): string {
  const lines: string[] = [":host {"]
  for (const [name, value] of Object.entries(theme.color)) {
    lines.push(`  --ft-color-${kebab(name)}: ${value};`)
  }
  for (const [name, value] of Object.entries(theme.radius)) {
    lines.push(`  --ft-radius-${name}: ${value}px;`)
  }
  lines.push(`  --ft-hit: ${theme.hit}px;`)
  lines.push("}")
  return lines.join("\n")
}
