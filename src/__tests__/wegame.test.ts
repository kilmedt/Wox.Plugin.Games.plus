import path from "path"
import { encodePng } from "../ico"
import { WeGameLauncher, wegameFolderIdentity, wegameGameId, wegameLaunchUrl } from "../launchers/wegame"
import { ScanDeps } from "../types"

function memoryDeps(files: Record<string, string>, dirs: Record<string, string[]>, reg: Record<string, string> = {}, drives: string[] = [], regTree: Record<string, string> = {}): ScanDeps {
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
    regQuery: async (key, name) => reg[`${key}|${name}`] || "",
    regQueryTree: async key => regTree[key] || "",
    windowsInventory: async () => ({ apps: [], drives, errors: [] })
  }
}

test("wegame folder identities split the app id from the display name", () => {
  expect(wegameFolderIdentity("DeltaForce(2001918)")).toEqual({ name: "DeltaForce", appid: "2001918" })
  expect(wegameFolderIdentity("无畏契约（2001715）")).toEqual({ name: "无畏契约", appid: "2001715" })
  expect(wegameFolderIdentity("英雄联盟")).toEqual({ name: "英雄联盟", appid: "" })
  expect(wegameGameId('{"game_id":2001918}')).toBe("2001918")
  expect(wegameGameId("not json")).toBe("")
  expect(wegameLaunchUrl("2001918")).toBe("wegame://action=StartFor&game_id=2001918")
})

test("wegame scan indexes rail games and starts them through the WeGame client", async () => {
  const root = "E:\\ElectronicGame\\WeGameApps"
  const rail = path.win32.join(root, "rail_apps")
  const delta = path.win32.join(rail, "DeltaForce(2001918)")
  const valorant = path.win32.join(rail, "无畏契约(2001715)")
  const deltaArt = path.win32.join(delta, "WeGameLauncher", "game", "game.png")
  const deltaIdentify = path.win32.join(delta, "rail_files", "rail_game_identify.json")
  const deps = memoryDeps(
    {
      [deltaIdentify]: '{"game_id":2001918}',
      [deltaArt]: "png",
      [path.win32.join(delta, "DeltaForceClient.exe")]: "",
      [path.win32.join(delta, "三角洲行动卸载.exe")]: "",
      [path.win32.join(valorant, "无畏契约卸载.exe")]: "",
      [path.win32.join(valorant, "live", "VALORANT.exe")]: ""
    },
    {
      [root]: ["common_apps", "downloading", "rail_apps", "rail_user_data"],
      [rail]: ["DeltaForce(2001918)", "无畏契约(2001715)"],
      [delta]: ["DeltaForceClient.exe", "三角洲行动卸载.exe", "rail_files", "WeGameLauncher"],
      [path.win32.join(delta, "rail_files")]: ["rail_game_identify.json"],
      [path.win32.join(delta, "WeGameLauncher")]: ["game"],
      [path.win32.join(delta, "WeGameLauncher", "game")]: ["game.png"],
      [valorant]: ["无畏契约卸载.exe", "live"],
      [path.win32.join(valorant, "live")]: ["VALORANT.exe"]
    },
    { "HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeGame|InstallPath": "E:\\ElectronicGame\\WeGame" },
    ["C:\\", "E:\\"]
  )
  const found = await new WeGameLauncher().scan(deps)
  expect(found.games.map(game => game.id).sort()).toEqual(["wegame:2001715", "wegame:2001918"])
  const deltaGame = found.games.find(game => game.id === "wegame:2001918")
  expect(deltaGame?.name).toBe("DeltaForce")
  expect(deltaGame?.launchUrl).toBe("wegame://action=StartFor&game_id=2001918")
  expect(deltaGame?.installDir).toBe(delta)
  expect(deltaGame?.iconPath).toBe(deltaArt)
  expect(deltaGame?.iconType).toBe("absolute")
  const valorantGame = found.games.find(game => game.id === "wegame:2001715")
  expect(valorantGame?.name).toBe("无畏契约")
  expect(valorantGame?.launchUrl).toBe("wegame://action=StartFor&game_id=2001715")
  // The uninstall helper is not the game entry point; the launcher under live is.
  expect(valorantGame?.iconPath).toMatch(/[\\/]icons[\\/]/)
  expect(valorantGame?.iconType).toBe("absolute")
  expect(found.watchDirs).toContain(rail)
})

test("wegame scan keeps classic installs that only ship their own launcher", async () => {
  const root = "E:\\WeGameApps"
  const game = path.win32.join(root, "英雄联盟")
  const client = path.win32.join(game, "TCLS", "client.exe")
  const deps = memoryDeps({ [client]: "" }, { [root]: ["rail_apps", "英雄联盟"], [path.win32.join(game, "TCLS")]: ["client.exe"] }, {}, ["E:\\"])
  const found = await new WeGameLauncher().scan(deps)
  expect(found.games.map(item => item.id)).toEqual(["wegame:英雄联盟"])
  expect(found.games[0].launchUrl).toBe(client)
  expect(found.watchDirs).toContain(root)
})

test("wegame client is found through its protocol handler when the Tencent keys are missing", async () => {
  const root = "E:\\ElectronicGame\\WeGameApps"
  const rail = path.win32.join(root, "rail_apps")
  const game = path.win32.join(rail, "DeltaForce(2001918)")
  const deps = memoryDeps({}, { [root]: ["rail_apps"], [rail]: ["DeltaForce(2001918)"], [game]: [] }, {}, [], {
    "HKCR\\wegame\\shell\\open\\command": 'HKEY_CLASSES_ROOT\\wegame\\shell\\open\\command\n    (Default)    REG_SZ    "E:\\ElectronicGame\\WeGame\\wegame.exe" "%1"\n\n'
  })
  const found = await new WeGameLauncher().scan(deps)
  expect(found.games.map(item => item.id)).toEqual(["wegame:2001918"])
  expect(found.games[0].launchUrl).toBe("wegame://action=StartFor&game_id=2001918")
})
