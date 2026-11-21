import path from "path"
import { encodePng } from "../ico"
import { LocalLauncher, cleanLocalTitle, localExecutableScore, localGameName } from "../launchers/local"
import { installDirsOverlap, scanAll } from "../scan"
import { createGame } from "../game"
import { GameLauncher, ScanDeps } from "../types"

function memoryDeps(files: Record<string, string>, dirs: Record<string, string[]>): ScanDeps {
  const missing = (file: string) => Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT", path: file })
  const binary = new Map<string, Buffer>()
  return {
    platform: "win32",
    homedir: "C:\\Users\\me",
    appData: "C:\\Users\\me\\AppData\\Roaming",
    publicDir: "C:\\Users\\Public",
    programData: "C:\\ProgramData",
    programFiles: "C:\\Program Files",
    programFilesX86: "C:\\Program Files (x86)",
    cacheDir: "C:\\cache",
    fileVersion: async () => "100:1",
    exists: async file => binary.has(file) || Object.prototype.hasOwnProperty.call(files, file) || Object.prototype.hasOwnProperty.call(dirs, file),
    readBinary: async file => {
      const data = binary.get(file)
      if (!data) throw missing(file)
      return data
    },
    writeBinary: async (file, data) => {
      binary.set(file, data)
    },
    extractWindowsIcon: jest.fn(async () => encodePng(1, 1, Buffer.from([255, 0, 0, 255]))),
    readFile: async file => {
      if (!Object.prototype.hasOwnProperty.call(files, file)) throw missing(file)
      return files[file]
    },
    readdir: async dir => {
      if (!Object.prototype.hasOwnProperty.call(dirs, dir)) throw missing(dir)
      return dirs[dir]
    },
    regQuery: async () => "",
    regQueryTree: async () => "",
    windowsInventory: async () => ({ apps: [], drives: [], errors: [] })
  }
}

const root = "E:\\ElectronicGame"

function localTree(): { files: Record<string, string>; dirs: Record<string, string[]> } {
  const hmcl = path.win32.join(root, "HMCL")
  const hmclVersion = path.win32.join(hmcl, "HMCL-3.5.3.exe")
  const palu = path.win32.join(root, "palu")
  const palworld = path.win32.join(palu, "Palworld.v1.0.2")
  const snow = path.win32.join(root, "Snow")
  const stellar = path.win32.join(root, "stelllarblade")
  const stellarGame = path.win32.join(stellar, "Stellar Blade")
  const switchGame = path.win32.join(root, "switch_game")
  const wegame = path.win32.join(root, "WeGame")
  const library = path.win32.join(root, "WeGameApps")
  return {
    files: {
      [path.win32.join(hmclVersion, "HMCL-3.14.1.exe")]: "",
      [path.win32.join(palworld, "Palworld.exe")]: "",
      [path.win32.join(snow, "snow_launcher.exe")]: "",
      [path.win32.join(snow, "binary_patch.exe")]: "",
      [path.win32.join(snow, "uninst.exe")]: "",
      [path.win32.join(snow, "steam_appid.txt")]: "1234",
      [path.win32.join(stellarGame, "SB.exe")]: "",
      [path.win32.join(stellarGame, "crs-handler.exe")]: "",
      [path.win32.join(stellarGame, "crs-uploader.exe")]: "",
      [path.win32.join(switchGame, "Xenoblade.xci")]: "",
      [path.win32.join(wegame, "wegame.exe")]: "",
      [path.win32.join(wegame, "uninst.exe")]: ""
    },
    dirs: {
      [root]: ["HMCL", "palu", "Snow", "stelllarblade", "switch_game", "WeGame", "WeGameApps", "notes.txt"],
      [hmcl]: ["HMCL-3.5.3.exe"],
      [hmclVersion]: ["HMCL-3.14.1.exe"],
      [palu]: ["Palworld.v1.0.2"],
      [palworld]: ["Palworld.exe"],
      [snow]: ["snow_launcher.exe", "binary_patch.exe", "uninst.exe", "steam_appid.txt"],
      [stellar]: ["Stellar Blade"],
      [stellarGame]: ["SB.exe", "crs-handler.exe", "crs-uploader.exe"],
      [switchGame]: ["Xenoblade.xci"],
      [wegame]: ["wegame.exe", "uninst.exe"],
      [library]: ["rail_apps"],
      [path.win32.join(library, "rail_apps")]: []
    }
  }
}

test("local titles drop packaging suffixes", () => {
  expect(cleanLocalTitle("Palworld.v1.0.2")).toBe("Palworld")
  expect(cleanLocalTitle("HMCL-3.5.3.exe")).toBe("HMCL")
  expect(cleanLocalTitle("Stellar Blade")).toBe("Stellar Blade")
  expect(cleanLocalTitle("Snow")).toBe("Snow")
  expect(cleanLocalTitle("Game v1.0")).toBe("Game")
  expect(cleanLocalTitle("2077")).toBe("2077")
})

test("local game names prefer the folder that actually holds the game", () => {
  expect(localGameName(path.win32.join(root, "palu"), path.win32.join(root, "palu", "Palworld.v1.0.2"))).toBe("Palworld")
  expect(localGameName(path.win32.join(root, "stelllarblade"), path.win32.join(root, "stelllarblade", "Stellar Blade"))).toBe("Stellar Blade")
  expect(localGameName(path.win32.join(root, "Snow"), path.win32.join(root, "Snow"))).toBe("Snow")
  // A generic packaging folder keeps the name the user gave the install.
  expect(localGameName(path.win32.join(root, "MyGame"), path.win32.join(root, "MyGame", "bin"))).toBe("MyGame")
})

test("local executable scoring prefers the folder's own executable", () => {
  expect(localExecutableScore("E:\\ElectronicGame\\Snow\\snow_launcher.exe", "E:\\ElectronicGame\\Snow")).toBeGreaterThan(
    localExecutableScore("E:\\ElectronicGame\\Snow\\binary_patch.exe", "E:\\ElectronicGame\\Snow")
  )
  expect(localExecutableScore("E:\\ElectronicGame\\palu\\Palworld.v1.0.2\\Palworld.exe", "E:\\ElectronicGame\\palu")).toBeGreaterThan(0)
})

test("local scan indexes unpacked games and skips platforms", async () => {
  const tree = localTree()
  const found = await new LocalLauncher().scan(memoryDeps(tree.files, tree.dirs))
  expect(found.games.map(game => game.id).sort()).toEqual(["local:HMCL", "local:Snow", "local:palu", "local:stelllarblade"])
  const byId = new Map(found.games.map(game => [game.id, game]))
  expect(byId.get("local:palu")?.name).toBe("Palworld")
  expect(byId.get("local:palu")?.launchUrl).toBe(path.win32.join(root, "palu", "Palworld.v1.0.2", "Palworld.exe"))
  expect(byId.get("local:stelllarblade")?.name).toBe("Stellar Blade")
  expect(byId.get("local:stelllarblade")?.launchUrl).toBe(path.win32.join(root, "stelllarblade", "Stellar Blade", "SB.exe"))
  expect(byId.get("local:Snow")?.launchUrl).toBe(path.win32.join(root, "Snow", "snow_launcher.exe"))
  expect(byId.get("local:HMCL")?.launchUrl).toBe(path.win32.join(root, "HMCL", "HMCL-3.5.3.exe", "HMCL-3.14.1.exe"))
  expect(byId.get("local:Snow")?.iconPath).toMatch(/[\\/]icons[\\/]/)
  expect(found.watchDirs).toEqual([root])
})

test("a platform game already indexed wins over the same local folder", async () => {
  const tree = localTree()
  const local = createGame("local", { appid: "palu", name: "Palworld", installDir: path.win32.join(root, "palu"), launchUrl: "E:\\palu\\Palworld.exe" })
  const platform = createGame("wegame", { appid: "2001918", name: "DeltaForce", installDir: path.win32.join(root, "palu"), launchUrl: "wegame://action=StartFor&game_id=2001918" })
  expect(local && platform).toBeTruthy()
  expect(installDirsOverlap(platform!, local!, "win32")).toBe(true)
  const wegame: GameLauncher = { id: "wegame", label: "WeGame", scan: async () => ({ games: [platform!], watchDirs: [] }) }
  const found = await scanAll(memoryDeps(tree.files, tree.dirs), [wegame, new LocalLauncher()])
  expect(found.games.map(game => game.id)).toEqual(["wegame:2001918", "local:HMCL", "local:Snow", "local:stelllarblade"])
})
