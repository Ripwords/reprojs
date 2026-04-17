// packages/ui/src/shadow.ts
export function createShadowHost(): ShadowRoot {
  let host = document.getElementById("feedback-tool-host")
  if (!host) {
    host = document.createElement("div")
    host.id = "feedback-tool-host"
    document.body.appendChild(host)
  }
  if ((host as HTMLElement).shadowRoot) {
    return (host as HTMLElement).shadowRoot as ShadowRoot
  }
  return (host as HTMLElement).attachShadow({ mode: "open" })
}

export function injectStyles(root: ShadowRoot, css: string) {
  const style = document.createElement("style")
  style.textContent = css
  root.appendChild(style)
}

export function unmountShadowHost() {
  const host = document.getElementById("feedback-tool-host")
  host?.remove()
}
