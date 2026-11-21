import path from "path"
import { errorDetails } from "../errors"
import { applyGameIcon, isHelperExecutable } from "../files"
import { createGame } from "../game"
import { dedupePaths } from "../paths"
import { parseRegTree } from "../registry"
import { emptyScan, GameLauncher, InstalledGame, ScanDeps, ScanReport } from "../types"

/** WeGame keeps these folders beside the games inside a library root. */
const LIBRARY_INFRASTRUCTURE = ["common_apps", "downloading", "rail_apps", "rail_user_data"]

/** Machine-wide keys are what wegame.exe itself reads. Older clients also write per-user values. */
const CLIENT_KEYS = ["HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeGame", "HKLM\\SOFTWARE\\Tencent\\WeGame", "HKCU\\Software\\Tencent\\WeGame"]

/** The protocol handler names the client executable even when the Tencent keys were lost. */
const PROTOCOL_KEYS = ["HKCR\\wegame\\shell\\open\\command", "HKCR\\wegames\\shell\\open\\command", "HKCU\\Software\\Classes\\wegame\\shell\\open\\command"]

/** Subdirectories a WeGame install keeps its game entry point in, most specific first. */
const EXECUTABLE_DIRS = ["TCLS", "live", "Game", path.win32.join("Binaries", "Win64"), "bin", path.win32.join("ACLOS", "Launcher")]

/** WeGame starts a rail title through its own client so versions, updates and anti-cheat stay in charge. */
export function wegameLaunchUrl(appid: string): string {
  return `wegame://action=StartFor&game_id=${encodeURIComponent(appid)}`
}

/** `DeltaForce(2001918)` is the layout WeGame uses for an installed rail title. */
export function wegameFolderIdentity(folder: string): { name: string; appid: string } {
  const base = path.win32.basename(String(folder || "").replace(/[\\/]+$/, ""))
  const match = /^(.*?)\s*[（(]\s*(\d{4,12})\s*[)）]\s*$/.exec(base)
  if (match) return { name: match[1].trim() || base, appid: match[2] }
  return { name: base, appid: "" }
}

/** rail_files/rail_game_identify.json holds `{"game_id":2001918}`. */
export function wegameGameId(text: string): string {
  const match = /"game_id"\s*:\s*"?(\d+)"?/i.exec(String(text || ""))
  return match ? match[1] : ""
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

/** Client directories, including the default install locations of a pristine machine. */
export async function wegameClientDirs(deps: ScanDeps): Promise<string[]> {
  const found: string[] = []
  for (const key of CLIENT_KEYS) {
    for (const valueName of ["InstallPath", "InstallDir"]) {
      try {
        found.push(await deps.regQuery(key, valueName))
      } catch (err) {
        void deps.report?.("wegame_registry_unavailable", { key, valueName, ...errorDetails(err) }, "Debug")
      }
    }
  }
  if (typeof deps.regQueryTree === "function") {
    for (const key of PROTOCOL_KEYS) {
      try {
        for (const entry of parseRegTree(await deps.regQueryTree(key))) {
          for (const value of Object.values(entry.values)) {
            const executable = /^"?([^"]+?wegame\.exe)"?/i.exec(String(value || "").trim())
            if (executable) found.push(path.win32.dirname(executable[1]))
          }
        }
      } catch (err) {
        void deps.report?.("wegame_protocol_unavailable", { key, ...errorDetails(err) }, "Debug")
      }
    }
  }
  found.push(path.win32.join(deps.programFilesX86 || "C:\\Program Files (x86)", "WeGame"))
  found.push(path.win32.join(deps.programFiles || "C:\\Program Files", "WeGame"))
  return dedupePaths(found, "win32")
}

/**
 * WeGame installs its library into a `WeGameApps` folder that sits next to the client by default.
 * Users can move it, so every drive root is checked for the same folder name.
 */
export async function wegameLibraryRoots(deps: ScanDeps, clients: string[]): Promise<string[]> {
  const roots: string[] = []
  for (const client of clients) {
    roots.push(path.win32.join(path.win32.dirname(client), "WeGameApps"))
    roots.push(path.win32.join(client, "WeGameApps"))
  }
  const drives = new Set<string>(["C:\\", "D:\\", "E:\\"])
  try {
    const inventory = typeof deps.windowsInventory === "function" ? await deps.windowsInventory() : undefined
    for (const drive of inventory?.drives || []) drives.add(drive)
  } catch (err) {
    void deps.report?.("wegame_inventory_failed", errorDetails(err), "Warning")
  }
  for (const drive of drives) {
    roots.push(path.win32.join(drive, "WeGameApps"))
    roots.push(path.win32.join(drive, "Program Files", "WeGameApps"))
  }
  return dedupePaths(roots, "win32")
}

/** The game icon WeGame stores beside a rail install, when the title ships one. */
export async function wegameArtwork(deps: ScanDeps, installDir: string): Promise<string> {
  const artDir = path.win32.join(installDir, "WeGameLauncher", "game")
  for (const name of ["game.png", "game.jpg", "game.ico", "logo.png"]) {
    const file = path.win32.join(artDir, name)
    if (await existing(deps, file)) return file
  }
  for (const name of await readdirOrEmpty(deps, artDir)) {
    if (/\.(png|jpe?g|ico)$/i.test(name)) return path.win32.join(artDir, name)
  }
  return ""
}

/**
 * WeGame has no manifest that names a game executable, so the entry point is looked up in the
 * folders its rail installs use. The uninstall helper and crash reporters are skipped.
 */
export async function wegameExecutable(deps: ScanDeps, installDir: string, report?: ScanReport): Promise<string> {
  const rootExes = (await readdirOrEmpty(deps, installDir)).filter(name => /\.exe$/i.test(name) && !isHelperExecutable(name))
  const candidates: Array<{ files: string[]; reason: string }> = []
  for (const sub of EXECUTABLE_DIRS) {
    const dir = path.win32.join(installDir, sub)
    const files = (await readdirOrEmpty(deps, dir)).filter(name => /\.exe$/i.test(name) && !isHelperExecutable(name)).map(name => path.win32.join(dir, name))
    if (files.length) candidates.push({ files, reason: `subdirectory:${sub}` })
  }
  if (rootExes.length) candidates.push({ files: rootExes.map(name => path.win32.join(installDir, name)), reason: "install_root" })
  const first = candidates[0]
  const selected = first ? first.files[0] : ""
  void report?.("wegame_executable_selection", {
    installDir,
    candidates: candidates.flatMap(entry => entry.files),
    selected,
    reason: selected ? first.reason : "no_executable"
  })
  return selected
}

async function railGame(deps: ScanDeps, installDir: string, folderName: string, report?: ScanReport): Promise<InstalledGame | null> {
  const identity = wegameFolderIdentity(folderName)
  const identifyPath = path.win32.join(installDir, "rail_files", "rail_game_identify.json")
  let appid = identity.appid
  if (!appid) {
    try {
      appid = wegameGameId(await deps.readFile(identifyPath))
    } catch {
      appid = ""
    }
  }
  const executable = await wegameExecutable(deps, installDir, report)
  if (!appid && !executable) {
    void report?.("candidate_skipped", { installDir, reason: "wegame_game_without_id_or_executable" })
    return null
  }
  const artwork = await wegameArtwork(deps, installDir)
  const game = createGame("wegame", {
    appid: appid || folderName,
    name: identity.name,
    installDir,
    // Keep WeGame in charge of starting the title. Without an id the install can only run directly.
    launchUrl: appid ? wegameLaunchUrl(appid) : executable,
    discoveryPath: identifyPath,
    iconPath: artwork || executable
  })
  if (game) await applyGameIcon(deps, game)
  return game
}

/** Pre-rail installs sit directly under the library root and only expose their own launcher. */
async function classicGame(deps: ScanDeps, installDir: string, folderName: string, report?: ScanReport): Promise<InstalledGame | null> {
  const executable = await wegameExecutable(deps, installDir, report)
  if (!executable) return null
  const artwork = await wegameArtwork(deps, installDir)
  const game = createGame("wegame", {
    appid: folderName,
    name: folderName,
    installDir,
    launchUrl: executable,
    discoveryPath: installDir,
    iconPath: artwork || executable
  })
  if (game) await applyGameIcon(deps, game)
  return game
}

export class WeGameLauncher implements GameLauncher {
  readonly id = "wegame"
  readonly label = "WeGame"

  async scan(deps: ScanDeps) {
    if (deps.platform !== "win32") return emptyScan()
    const clients = await wegameClientDirs(deps)
    const roots = await wegameLibraryRoots(deps, clients)
    const games: InstalledGame[] = []
    const watchDirs: string[] = []
    const seen = new Set<string>()
    const collect = (game: InstalledGame | null) => {
      if (!game) return
      if (seen.has(game.id)) {
        void deps.report?.("candidate_skipped", { id: game.id, reason: "duplicate_game_id" })
        return
      }
      seen.add(game.id)
      games.push(game)
    }
    for (const root of roots) {
      if (!(await existing(deps, root))) continue
      const railDir = path.win32.join(root, "rail_apps")
      if (await existing(deps, railDir)) {
        watchDirs.push(railDir)
        for (const name of await readdirOrEmpty(deps, railDir)) {
          collect(await railGame(deps, path.win32.join(railDir, name), name, deps.report))
        }
      }
      watchDirs.push(root)
      for (const name of await readdirOrEmpty(deps, root)) {
        if (LIBRARY_INFRASTRUCTURE.includes(name.toLowerCase())) continue
        const installDir = path.win32.join(root, name)
        collect(await classicGame(deps, installDir, name, deps.report))
      }
    }
    void deps.report?.("wegame_scan_done", { roots: roots.length, games: games.length, watchDirs })
    return { games, watchDirs }
  }
}
