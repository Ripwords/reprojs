function originPattern(origin: string): string {
  return `${origin}/*`
}

export async function hasOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [originPattern(origin)] })
}

export async function requestOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [originPattern(origin)] })
}

export async function removeOriginPermission(origin: string): Promise<boolean> {
  return chrome.permissions.remove({ origins: [originPattern(origin)] })
}

// Request permission for multiple origins in a single native prompt so the
// user sees one consent dialog when adding a config (page origin + intake
// endpoint origin) instead of two.
export async function requestOriginPermissions(origins: readonly string[]): Promise<boolean> {
  if (origins.length === 0) return true
  return chrome.permissions.request({ origins: origins.map(originPattern) })
}
