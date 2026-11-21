import path from "path"

export function dedupePaths(paths: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of paths) {
    const pathApi = platform === "win32" ? path.win32 : path
    let cleaned = pathApi.normalize(
      String(raw || "")
        .trim()
        .replace(/^"|"$/g, "")
    )
    if (cleaned !== pathApi.parse(cleaned).root) cleaned = cleaned.replace(/[\\/]+$/, "")
    if (!cleaned || cleaned === ".") continue
    const key = platform === "win32" ? cleaned.toLowerCase() : cleaned
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(cleaned)
  }
  return unique
}

/** Comparable form of a directory path: normalized, without a trailing separator, case-folded on Windows. */
export function pathKey(value: string, platform: NodeJS.Platform): string {
  const pathApi = platform === "win32" ? path.win32 : path
  const cleaned = String(value || "")
    .trim()
    .replace(/^"|"$/g, "")
  if (!cleaned) return ""
  const normalized = pathApi.normalize(cleaned).replace(/[\\/]+$/, "")
  return platform === "win32" ? normalized.toLowerCase() : normalized
}

/** True when `child` is `parent` itself or a directory below it. */
export function pathContains(parent: string, child: string, platform: NodeJS.Platform): boolean {
  const parentKey = pathKey(parent, platform)
  const childKey = pathKey(child, platform)
  if (!parentKey || !childKey) return false
  if (childKey === parentKey) return true
  const separator = platform === "win32" ? "\\" : "/"
  return childKey.startsWith(parentKey.endsWith(separator) ? parentKey : `${parentKey}${separator}`)
}
