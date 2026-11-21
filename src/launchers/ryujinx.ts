import { createHash } from "crypto"
import path from "path"
import { errorDetails } from "../errors"
import { applyGameIcon } from "../files"
import { createGame } from "../game"
import { dedupePaths } from "../paths"
import { shortcutTargets } from "../shortcut"
import { emptyScan, GameLauncher, InstalledGame, ScanDeps } from "../types"

const DEFAULT_FILE_TYPES = ["nsp", "xci", "nca", "nro", "nso", "pfs0"]

/** Image formats accepted for a user-supplied game icon. */
export const ICON_EXTENSIONS = ["png", "jpg", "jpeg", "ico"]

export interface RyujinxConfig {
  gameDirs: string[]
  autoloadDirs: string[]
  fileTypes: string[]
}

export interface RyujinxInstall {
  executable: string
  configPath: string
  /** Folder that holds Config.json, `games`, `system` and the other emulator data. */
  dataDir: string
}

export interface RyujinxCache {
  /** Title id to the display name Ryujinx stored when the game was last opened. */
  titles: Map<string, string>
  /** Normalized game path to the title id that path was opened as. */
  paths: Map<string, string>
}

function parseJson(text: string): Record<string, unknown> {
  const source = String(text || "").replace(/^\uFEFF/, "")
  try {
    const parsed = JSON.parse(source) as unknown
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    try {
      // A hand-edited portable config may keep comments or a trailing comma.
      const relaxed = source.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1")
      const parsed = JSON.parse(relaxed) as unknown
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
}

/** `game_dirs` holds strings, but newer builds also accept `{ "Path": ... }` entries. */
function directoryList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const dirs: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      dirs.push(item.trim())
      continue
    }
    if (!item || typeof item !== "object") continue
    const record = item as Record<string, unknown>
    for (const key of ["Path", "path", "Directory", "directory"]) {
      const entry = record[key]
      if (typeof entry === "string" && entry.trim()) {
        dirs.push(entry.trim())
        break
      }
    }
  }
  return dirs
}

export function parseRyujinxConfig(text: string): RyujinxConfig {
  const data = parseJson(text)
  const fileTypes = new Set(DEFAULT_FILE_TYPES)
  const shown = data.shown_file_types
  if (shown && typeof shown === "object") {
    const enabled = Object.entries(shown as Record<string, unknown>)
      .filter(([, value]) => value === true)
      .map(([key]) => key.toLowerCase())
    if (enabled.length) {
      fileTypes.clear()
      for (const type of enabled) fileTypes.add(type)
    }
  }
  return {
    gameDirs: directoryList(data.game_dirs ?? data.GameDirs),
    autoloadDirs: directoryList(data.autoload_dirs ?? data.AutoloadDirs),
    fileTypes: [...fileTypes]
  }
}

export function romTitleId(file: string): string {
  const match = /(?:^|[^0-9a-z])(0100[0-9a-f]{12})(?![0-9a-f])/i.exec(String(file || ""))
  return match ? match[1].toLowerCase() : ""
}

const METADATA_GROUP = /^(?:v?\d+(?:\.\d+)*[a-z]?|\d+[a-z](?:\+\d+[a-z])*|[0-9a-f]{16}|[a-z]{2,3}(?:-[a-z]{2,3})?|[a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i

/** ROM names carry ids, versions, regions and release tags. Keep only the title. */
export function romDisplayName(file: string): string {
  const base = path.win32.basename(String(file || ""), path.win32.extname(String(file || "")))
  // A release named only through tags still has its title inside one of the bracket groups.
  const titled = [...base.matchAll(/\[([^\]]+)\]/g)].map(match => match[1].trim()).filter(group => group && !METADATA_GROUP.test(group))
  let name = base
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[（(]([^)）]*)[)）]/g, (whole, inner: string) => (METADATA_GROUP.test(inner.trim()) ? " " : whole))
    .replace(/\b0100[0-9a-f]{12}\b/gi, " ")
    .replace(/\bv\d+(?:\.\d+)+[a-z]?\b/gi, " ")
    .replace(/[\s._-]+\d{4,}$/g, " ")
  name = name
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim()
  return name || titled[0] || base
}

function normalized(file: string): string {
  return path.win32.normalize(String(file || "")).toLowerCase()
}

async function readdirOrEmpty(deps: ScanDeps, dir: string): Promise<string[]> {
  try {
    return await deps.readdir(dir)
  } catch {
    return []
  }
}

async function existing(deps: ScanDeps, file: string): Promise<boolean> {
  try {
    return await deps.exists(file)
  } catch {
    return false
  }
}

async function readTextOrEmpty(deps: ScanDeps, file: string): Promise<string> {
  try {
    return await deps.readFile(file)
  } catch {
    return ""
  }
}

/** Ryujinx keeps per-title state under `<data>/games/<title id>`. */
export async function readRyujinxCache(deps: ScanDeps, dataDir: string): Promise<RyujinxCache> {
  const titles = new Map<string, string>()
  const paths = new Map<string, string>()
  const gamesDir = path.win32.join(dataDir, "games")
  for (const id of await readdirOrEmpty(deps, gamesDir)) {
    const titleId = id.toLowerCase()
    if (!/^[0-9a-f]{16}$/.test(titleId)) continue
    const dir = path.win32.join(gamesDir, id)
    const metadata = parseJson(await readTextOrEmpty(deps, path.win32.join(dir, "gui", "metadata.json")))
    const title = typeof metadata.title === "string" ? metadata.title.trim() : ""
    if (title) titles.set(titleId, title)
    // updates.json records the file the title was opened from, which is the only path-to-id link.
    const updates = parseJson(await readTextOrEmpty(deps, path.win32.join(dir, "updates.json")))
    const updatePaths: unknown[] = Array.isArray(updates.paths) ? (updates.paths as unknown[]) : []
    if (typeof updates.selected === "string") updatePaths.push(updates.selected)
    for (const candidate of updatePaths) {
      if (typeof candidate === "string" && candidate.trim()) paths.set(normalized(candidate), titleId)
    }
    const dlcText = await readTextOrEmpty(deps, path.win32.join(dir, "dlc.json"))
    try {
      const entries = JSON.parse(dlcText) as unknown
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (entry && typeof entry === "object") {
            const file = (entry as Record<string, unknown>).path
            if (typeof file === "string" && file.trim()) paths.set(normalized(file), titleId)
          }
        }
      }
    } catch {
      /* A malformed dlc.json only loses path hints. */
    }
  }
  return { titles, paths }
}

export interface RyujinxArtwork {
  iconPath: string
  iconType: string
}

/**
 * Ryujinx stores no game art: `games/<title id>/gui` only holds metadata, and the icon inside the
 * ROM is encrypted. Icons are therefore supplied by the user, named after the stable title id or
 * after the ROM file, either in the game directory's `icons` folder or beside the ROM.
 */
export async function ryujinxArtwork(deps: ScanDeps, dataDir: string, rom: string, titleId: string): Promise<RyujinxArtwork | null> {
  const romDir = path.win32.dirname(rom)
  const base = path.win32.basename(rom, path.win32.extname(rom))
  const iconsDir = path.win32.join(romDir, "icons")
  const candidates: string[] = []
  if (titleId) {
    for (const extension of ICON_EXTENSIONS) candidates.push(path.win32.join(iconsDir, `${titleId}.${extension}`))
  }
  for (const extension of ICON_EXTENSIONS) candidates.push(path.win32.join(iconsDir, `${base}.${extension}`))
  for (const extension of ICON_EXTENSIONS) candidates.push(path.win32.join(romDir, `${base}.${extension}`))
  if (titleId) {
    for (const extension of ICON_EXTENSIONS) candidates.push(path.win32.join(dataDir, "games", titleId, "gui", `icon.${extension}`))
  }
  for (const candidate of candidates) {
    if (await existing(deps, candidate)) return { iconPath: candidate, iconType: /\.ico$/i.test(candidate) ? "fileicon" : "absolute" }
  }
  return null
}

/** Ryujinx is usually installed as a portable folder that only a shortcut points at. */
export async function ryujinxExecutables(deps: ScanDeps): Promise<string[]> {
  const candidates: string[] = []
  for (const dir of [
    path.win32.join(deps.appData || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.win32.join(deps.programData || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.win32.join(deps.publicDir || "", "Desktop"),
    path.win32.join(deps.homedir || "", "Desktop")
  ]) {
    for (const name of await readdirOrEmpty(deps, dir)) {
      if (!/^ryujinx.*\.lnk$/i.test(name) || !deps.readBinary) continue
      try {
        candidates.push(...shortcutTargets(await deps.readBinary(path.win32.join(dir, name))))
      } catch (err) {
        void deps.report?.("shortcut_read_failed", { file: path.win32.join(dir, name), ...errorDetails(err) }, "Debug")
      }
    }
  }
  const localAppData = /[\\/]Roaming$/i.test(deps.appData || "") ? path.win32.join(path.win32.dirname(deps.appData), "Local") : ""
  candidates.push(path.win32.join(deps.programFiles || "C:\\Program Files", "Ryujinx", "Ryujinx.exe"))
  candidates.push(path.win32.join(deps.programFilesX86 || "C:\\Program Files (x86)", "Ryujinx", "Ryujinx.exe"))
  if (localAppData) candidates.push(path.win32.join(localAppData, "Programs", "Ryujinx", "Ryujinx.exe"))
  candidates.push(path.win32.join(deps.homedir || "", "Ryujinx", "Ryujinx.exe"))
  let drives: string[] = []
  try {
    drives = typeof deps.windowsInventory === "function" ? (await deps.windowsInventory()).drives || [] : []
  } catch (err) {
    void deps.report?.("windows_inventory_failed", errorDetails(err), "Warning")
  }
  for (const drive of drives) candidates.push(path.win32.join(drive, "Ryujinx", "Ryujinx.exe"))
  const found: string[] = []
  for (const candidate of dedupePaths(candidates, "win32")) {
    if (await existing(deps, candidate)) found.push(candidate)
  }
  return found
}

/** Portable installs keep Config.json inside `portable`; non-portable ones use AppData. */
export async function findRyujinx(deps: ScanDeps): Promise<RyujinxInstall | null> {
  const executables = await ryujinxExecutables(deps)
  for (const executable of executables) {
    const dir = path.win32.dirname(executable)
    for (const configPath of [path.win32.join(dir, "portable", "Config.json"), path.win32.join(dir, "portable", "Config.jsonc"), path.win32.join(dir, "Config.json")]) {
      if (await existing(deps, configPath)) return { executable, configPath, dataDir: path.win32.dirname(configPath) }
    }
  }
  const roaming = path.win32.join(deps.appData || "", "Ryujinx", "Config.json")
  if (await existing(deps, roaming)) return { executable: executables[0] || "", configPath: roaming, dataDir: path.win32.dirname(roaming) }
  const portable = path.win32.join(deps.appData || "", "Ryujinx", "portable", "Config.json")
  if (await existing(deps, portable)) return { executable: executables[0] || "", configPath: portable, dataDir: path.win32.dirname(portable) }
  return null
}

export class RyujinxLauncher implements GameLauncher {
  readonly id = "ryujinx"
  readonly label = "Ryujinx"

  async scan(deps: ScanDeps) {
    if (deps.platform !== "win32") return emptyScan()
    const install = await findRyujinx(deps)
    if (!install) {
      void deps.report?.("source_unavailable", { reason: "ryujinx_configuration_not_found" }, "Debug")
      return emptyScan()
    }
    const configText = await readTextOrEmpty(deps, install.configPath)
    if (!configText) {
      void deps.report?.("source_unavailable", { reason: "ryujinx_configuration_unreadable", configPath: install.configPath }, "Warning")
      return emptyScan()
    }
    const config = parseRyujinxConfig(configText)
    const cache = await readRyujinxCache(deps, install.dataDir)
    const gameDirs = dedupePaths([...config.gameDirs, ...config.autoloadDirs], "win32")
    const types = new Set(config.fileTypes)
    void deps.report?.("ryujinx_config", { configPath: install.configPath, executable: install.executable, gameDirs, fileTypes: [...types] })
    const games: InstalledGame[] = []
    const watchDirs: string[] = []
    let skipped = 0
    for (const dir of gameDirs) {
      const names = await readdirOrEmpty(deps, dir)
      if (!names.length) {
        skipped += 1
        void deps.report?.("ryujinx_game_directory_unavailable", { dir }, "Debug")
        continue
      }
      watchDirs.push(dir)
      for (const name of names) {
        const extension = path.win32.extname(name).replace(/^\./, "").toLowerCase()
        if (!extension || !types.has(extension)) continue
        const rom = path.win32.join(dir, name)
        const titleId = cache.paths.get(normalized(rom)) || romTitleId(name)
        const cachedTitle = titleId ? cache.titles.get(titleId) || "" : ""
        const appid = titleId || `path-${createHash("sha1").update(normalized(rom)).digest("hex").slice(0, 16)}`
        const artwork = await ryujinxArtwork(deps, install.dataDir, rom, titleId)
        const game = createGame("ryujinx", {
          appid,
          name: cachedTitle || romDisplayName(name),
          installDir: dir,
          launchUrl: install.executable || rom,
          launchArgs: install.executable ? [rom] : [],
          discoveryPath: rom,
          launchError: install.executable ? "" : "The Ryujinx executable was not found",
          iconPath: artwork?.iconPath || "",
          iconType: artwork?.iconType || ""
        })
        if (!game) continue
        if (artwork) await applyGameIcon(deps, game)
        void deps.report?.("ryujinx_artwork", { titleId, iconPath: game.iconPath, iconType: game.iconType }, "Debug")
        games.push(game)
      }
    }
    void deps.report?.("ryujinx_scan_done", { gameDirs: gameDirs.length, unavailable: skipped, games: games.length })
    return { games, watchDirs }
  }
}
