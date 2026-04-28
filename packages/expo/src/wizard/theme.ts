/**
 * The wizard's color/radius/hit tokens. The values now live in
 * @reprojs/sdk-utils so the web SDK can render the same palette via CSS
 * custom properties. This file is a thin re-export so existing call sites
 * (`theme.color.primary` etc.) keep working.
 */
export { tokens as theme } from "@reprojs/sdk-utils"
export type { Tokens as Theme } from "@reprojs/sdk-utils"
