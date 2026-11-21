import path from "path"
import { applyGameIcon, isHelperExecutable } from "../files"
import { createGame } from "../game"
import { emptyScan, GameLauncher, InstalledGame, ScanDeps, ScanReport } from "../types"

/**
 * Folders with unpacked games that no store client manages. Every direct subfolder is a game
 * install; platform folders and games owned by another launcher are skipped.
 */
export const LOCAL_GAME_ROOTS = ["E:\\ElectronicGame"]

/** Client and emulator executables. Their folders are the platforms themselves, not games. */
const PLATFORM_CLIENTS = /^(wegame|wegameservice|steam|epicgameslauncher|galaxyclient|ubisoftconnect|uplay|eadesktop|battle\.net|itch|ryujinx)\.exe$/i

/** Folders that prove a directory belongs to a launcher instead of a game install. */
const PLATFORM_MARKERS = ["rail_apps", "rail_user_data", "steamapps", path.win32.join("portable", "Config.json")]

/** Install subfolders that describe packaging rather than a title. */
const GENERIC_DIRS = new Set([
  "bin",
  "binaries",
  "x64",
  "win64",
  "win32",
  "x86",
  "game",
  "data",
  "content",
  "engine",
  "system",
  "build",
  "release",
  "dist",
  "app",
  "client",
  "launcher",
  "runtime",
  "support"
])

function foldName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
}

function sharesPrefix(left: string, right: string): boolean {
  if (left.length < 3 || right.length < 3) return false
  return left.startsWith(right) || right.startsWith(left)
}

/** `Palworld.v1.0.2`, `HMCL-3.5.3.exe` and `Stellar Blade` become readable titles. */
export function cleanLocalTitle(value: string): string {
  const base = path.win32.basename(String(value || "").replace(/[\\/]+$/, ""))
  const name = base
    .replace(/\.(exe|app|bin|lnk)$/i, "")
    .replace(/[\s._-]+v?\d+(?:\.\d+)+[a-z]?\s*$/i, "")
    .replace(/[\s._-]+$/, "")
    .trim()
  return name || base
}

/** Prefers the executable named after the install folder or its own subfolder. */
export function localExecutableScore(file: string, gameDir: string): number {
  const base = foldName(path.win32.basename(file, path.win32.extname(file)))
  const folder = foldName(path.win32.basename(String(gameDir || "").replace(/[\\/]+$/, "")))
  const parent = foldName(path.win32.basename(path.win32.dirname(file)))
  let score = 0
  if (base && folder) {
    if (base === folder) score += 6
    else if (sharesPrefix(base, folder)) score += 4
  }
  if (base && parent && parent !== folder) {
    if (base === parent) score += 5
    else if (sharesPrefix(base, parent)) score += 3
  }
  return score
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

/** A directory can be listed; a file cannot. The scan deps expose no stat call. */
async function isDirectory(deps: ScanDeps, dir: string): Promise<boolean> {
  try {
    await deps.readdir(dir)
    return true
  } catch {
    return false
  }
}

async function isFile(deps: ScanDeps, file: string): Promise<boolean> {
  if (!(await existing(deps, file))) return false
  return !(await isDirectory(deps, file))
}

async function executablesIn(deps: ScanDeps, dir: string): Promise<string[]> {
  const files: string[] = []
  for (const name of await readdirOrEmpty(deps, dir)) {
    if (name.startsWith(".") || !/\.exe$/i.test(name) || isHelperExecutable(name)) continue
    const file = path.win32.join(dir, name)
    if (await isFile(deps, file)) files.push(file)
  }
  return files
}

/** Reason a folder is a launcher or library, empty for a plain game install. */
export async function platformDirectory(deps: ScanDeps, dir: string, executables: string[]): Promise<string> {
  for (const file of executables) {
    const name = path.win32.basename(file)
    if (PLATFORM_CLIENTS.test(name)) return `client:${name}`
  }
  for (const marker of PLATFORM_MARKERS) {
    if (await existing(deps, path.win32.join(dir, marker))) return `marker:${marker}`
  }
  return ""
}

export interface LocalExecutable {
  file: string
  dir: string
}

/**
 * Picks the game entry point from the install folder and one level below it, because unpacked
 * builds often keep the game in a versioned subfolder. A tie between equally convincing
 * executables is reported instead of launching the wrong one.
 */
export async function localExecutable(deps: ScanDeps, gameDir: string, report?: ScanReport): Promise<LocalExecutable | null> {
  const candidates = [...(await executablesIn(deps, gameDir))]
  for (const name of await readdirOrEmpty(deps, gameDir)) {
    if (name.startsWith(".") || name.startsWith("$")) continue
    const dir = path.win32.join(gameDir, name)
    if (!(await isDirectory(deps, dir))) continue
    candidates.push(...(await executablesIn(deps, dir)))
  }
  if (!candidates.length) {
    void report?.("candidate_skipped", { installDir: gameDir, reason: "no_local_executable" })
    return null
  }
  const depth = (file: string) => file.split(/[\\/]/).length
  const scored = candidates
    .map(file => ({ file, dir: path.win32.dirname(file), score: localExecutableScore(file, gameDir) }))
    .sort((left, right) => right.score - left.score || depth(left.file) - depth(right.file) || left.file.localeCompare(right.file))
  const best = scored[0]
  const tied = scored.filter(candidate => candidate.score === best.score)
  if (best.score === 0 && tied.length > 1) {
    void report?.("candidate_skipped", { installDir: gameDir, candidates: candidates, reason: "ambiguous_local_executable" }, "Warning")
    return null
  }
  void report?.("local_executable_selection", { installDir: gameDir, candidates, selected: best.file, score: best.score, reason: best.score > 0 ? "name_match" : "only_executable" })
  return { file: best.file, dir: best.dir }
}

/** Title of the folder that actually holds the game, not the wrapper folder the user created. */
export function localGameName(installDir: string, executableDir: string): string {
  const folder = path.win32.basename(String(executableDir || "").replace(/[\\/]+$/, "")).toLowerCase()
  const useExecutableDir = executableDir && path.win32.normalize(executableDir).toLowerCase() !== path.win32.normalize(installDir).toLowerCase() && !GENERIC_DIRS.has(folder)
  return cleanLocalTitle(path.win32.basename(useExecutableDir ? executableDir : installDir))
}

export class LocalLauncher implements GameLauncher {
  readonly id = "local"
  readonly label = "Local"
  /** Platform launchers own folders this scan also walks, so their rows win. */
  readonly fallback = true

  async scan(deps: ScanDeps) {
    if (deps.platform !== "win32") return emptyScan()
    const games: InstalledGame[] = []
    const watchDirs: string[] = []
    for (const root of LOCAL_GAME_ROOTS) {
      if (!(await existing(deps, root))) continue
      watchDirs.push(root)
      for (const name of await readdirOrEmpty(deps, root)) {
        if (name.startsWith(".") || name.startsWith("$")) continue
        const installDir = path.win32.join(root, name)
        if (!(await isDirectory(deps, installDir))) continue
        const platform = await platformDirectory(deps, installDir, await executablesIn(deps, installDir))
        if (platform) {
          void deps.report?.("candidate_skipped", { installDir, reason: "platform_directory", detail: platform })
          continue
        }
        const executable = await localExecutable(deps, installDir, deps.report)
        if (!executable) continue
        const game = createGame("local", {
          appid: name,
          name: localGameName(installDir, executable.dir),
          installDir,
          launchUrl: executable.file,
          discoveryPath: executable.file,
          iconPath: executable.file
        })
        if (!game) continue
        await applyGameIcon(deps, game)
        games.push(game)
      }
    }
    void deps.report?.("local_scan_done", { roots: LOCAL_GAME_ROOTS, games: games.length })
    return { games, watchDirs }
  }
}
