import path from "path"
import { RyujinxLauncher, parseRyujinxConfig, romDisplayName, romTitleId, ryujinxArtwork } from "../launchers/ryujinx"
import { shortcutTargets } from "../shortcut"
import { ScanDeps } from "../types"

/** Minimal .lnk with a LinkInfo block, matching the layout Windows writes for a shortcut. */
function shortcut(target: string, unicode: boolean): Buffer {
  const header = Buffer.alloc(0x4c)
  header.writeUInt32LE(0x4c, 0)
  header.writeUInt32LE(0x02, 0x14)
  const encoded = unicode ? Buffer.from(`${target}\u0000`, "utf16le") : Buffer.from(`${target}\u0000`, "latin1")
  const headerSize = unicode ? 0x24 : 0x1c
  const info = Buffer.alloc(headerSize + encoded.length)
  info.writeUInt32LE(info.length, 0)
  info.writeUInt32LE(headerSize, 4)
  info.writeUInt32LE(0, 8)
  info.writeUInt32LE(0, 0x0c)
  if (unicode) {
    info.writeUInt32LE(0, 0x10)
    info.writeUInt32LE(0, 0x14)
    info.writeUInt32LE(0, 0x18)
    info.writeUInt32LE(headerSize, 0x1c)
    info.writeUInt32LE(0, 0x20)
  } else {
    info.writeUInt32LE(headerSize, 0x10)
    info.writeUInt32LE(0, 0x14)
    info.writeUInt32LE(0, 0x18)
  }
  encoded.copy(info, headerSize)
  return Buffer.concat([header, info])
}

function memoryDeps(files: Record<string, string>, dirs: Record<string, string[]>, binary: Record<string, Buffer> = {}): ScanDeps {
  const missing = (file: string) => Object.assign(new Error(`ENOENT: ${file}`), { code: "ENOENT", path: file })
  return {
    platform: "win32",
    homedir: "C:\\Users\\me",
    appData: "C:\\Users\\me\\AppData\\Roaming",
    publicDir: "C:\\Users\\Public",
    programData: "C:\\ProgramData",
    programFiles: "C:\\Program Files",
    programFilesX86: "C:\\Program Files (x86)",
    exists: async file => Object.prototype.hasOwnProperty.call(binary, file) || Object.prototype.hasOwnProperty.call(files, file) || Object.prototype.hasOwnProperty.call(dirs, file),
    readFile: async file => {
      if (!Object.prototype.hasOwnProperty.call(files, file)) throw missing(file)
      return files[file]
    },
    readBinary: async file => {
      if (!Object.prototype.hasOwnProperty.call(binary, file)) throw missing(file)
      return binary[file]
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

test("shortcutTargets reads ANSI and UTF-16 shortcut targets", () => {
  expect(shortcutTargets(shortcut("E:\\ElectronicGame\\ryujinx\\Ryujinx.exe", false))).toEqual(["E:\\ElectronicGame\\ryujinx\\Ryujinx.exe"])
  expect(shortcutTargets(shortcut("D:\\Games\\Ryujinx\\Ryujinx.exe", true))).toEqual(["D:\\Games\\Ryujinx\\Ryujinx.exe"])
  expect(shortcutTargets(Buffer.from("not a shortcut"))).toEqual([])
})

test("parseRyujinxConfig reads game directories and shown file types", () => {
  const config = parseRyujinxConfig(
    JSON.stringify({
      version: 70,
      game_dirs: ["E:\\ElectronicGame\\switch_game", { Path: "D:\\Switch" }],
      autoload_dirs: ["E:\\Auto"],
      shown_file_types: { nsp: true, xci: true, nca: false, nro: false }
    })
  )
  expect(config.gameDirs).toEqual(["E:\\ElectronicGame\\switch_game", "D:\\Switch"])
  expect(config.autoloadDirs).toEqual(["E:\\Auto"])
  expect(config.fileTypes.sort()).toEqual(["nsp", "xci"])
  expect(parseRyujinxConfig("").gameDirs).toEqual([])
  expect(parseRyujinxConfig("{ broken").fileTypes).toContain("xci")
})

test("rom titles drop ids, versions, regions and release tags", () => {
  expect(romTitleId("The Legend of Zelda Tears of the Kingdom [v1.2.1] (1G+1U).xci")).toBe("")
  expect(romTitleId("Xenoblade Chronicles 3 010074F013262000 v2.2.0 (1G+1U+4D).xci")).toBe("010074f013262000")
  expect(romDisplayName("The Legend of Zelda Tears of the Kingdom [v1.2.1] (1G+1U).xci")).toBe("The Legend of Zelda Tears of the Kingdom")
  expect(romDisplayName("Xenoblade Chronicles 3 010074F013262000 v2.2.0 (1G+1U+4D)(ns.xlqy8.com).xci")).toBe("Xenoblade Chronicles 3")
  expect(romDisplayName("[XCI][ゼノブレイド２][0100F3400332C000][917504].xci")).toBe("ゼノブレイド２")
  expect(romDisplayName("Some_Game_Name.nsp")).toBe("Some Game Name")
})

test("ryujinx scan merges cached titles with the configured game directories", async () => {
  const install = "E:\\ElectronicGame\\ryujinx"
  const portable = path.win32.join(install, "portable")
  const config = path.win32.join(portable, "Config.json")
  const roms = "E:\\ElectronicGame\\switch_game"
  const zelda = path.win32.join(roms, "The Legend of Zelda Tears of the Kingdom [v1.2.1] (1G+1U).xci")
  const xenoblade = path.win32.join(roms, "Xenoblade Chronicles 3 010074F013262000 v2.2.0 (1G+1U+4D)(ns.xlqy8.com).xci")
  const unknown = path.win32.join(roms, "Unknown Game [XCI][0100ABCDEF123456][v1.0].nsp")
  const zeldaCache = path.win32.join(portable, "games", "0100f2c0115b6000")
  const zeldaIcon = path.win32.join(zeldaCache, "gui", "icon.png")
  const programs = path.win32.join("C:\\Users\\me\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs")
  const exe = path.win32.join(install, "Ryujinx.exe")
  const deps = memoryDeps(
    {
      [config]: JSON.stringify({ version: 70, game_dirs: [roms], shown_file_types: { nsp: true, xci: true, nca: true, nro: true, nso: true, pfs0: true } }),
      [zeldaIcon]: "png",
      [path.win32.join(zeldaCache, "gui", "metadata.json")]: JSON.stringify({ title: "The Legend of Zelda: Tears of the Kingdom", favorite: false }),
      [path.win32.join(zeldaCache, "updates.json")]: JSON.stringify({ selected: zelda, paths: [zelda] }),
      [path.win32.join(portable, "games", "010074f013262000", "gui", "metadata.json")]: JSON.stringify({ title: "Xenoblade Chronicles 3" }),
      [path.win32.join(portable, "games", "010074f013262000", "updates.json")]: JSON.stringify({ selected: xenoblade, paths: [xenoblade] }),
      [path.win32.join(portable, "games", "010074f013262000", "dlc.json")]: JSON.stringify([]),
      [zelda]: "",
      [xenoblade]: "",
      [unknown]: ""
    },
    {
      [programs]: ["Ryujinx.lnk"],
      [portable]: ["Config.json", "games"],
      [path.win32.join(portable, "games")]: ["0100f2c0115b6000", "010074f013262000"],
      [roms]: [path.win32.basename(zelda), path.win32.basename(xenoblade), path.win32.basename(unknown), "notes.txt"]
    },
    { [exe]: Buffer.alloc(8), [path.win32.join(programs, "Ryujinx.lnk")]: shortcut(exe, false) }
  )
  const found = await new RyujinxLauncher().scan(deps)
  expect(found.games.map(game => game.id).sort()).toEqual(["ryujinx:010074f013262000", "ryujinx:0100abcdef123456", "ryujinx:0100f2c0115b6000"])
  const zeldaGame = found.games.find(game => game.id === "ryujinx:0100f2c0115b6000")
  expect(zeldaGame?.name).toBe("The Legend of Zelda: Tears of the Kingdom")
  expect(zeldaGame?.launchUrl).toBe(exe)
  expect(zeldaGame?.launchArgs).toEqual([zelda])
  expect(zeldaGame?.discoveryPath).toBe(zelda)
  expect(zeldaGame?.installDir).toBe(roms)
  expect(zeldaGame?.iconPath).toBe(zeldaIcon)
  expect(zeldaGame?.iconType).toBe("absolute")
  expect(found.games.find(game => game.id === "ryujinx:010074f013262000")?.name).toBe("Xenoblade Chronicles 3")
  const unknownGame = found.games.find(game => game.id === "ryujinx:0100abcdef123456")
  expect(unknownGame?.name).toBe("Unknown Game")
  expect(found.watchDirs).toEqual([roms])
})

test("ryujinx scan reports a missing emulator instead of hiding the games", async () => {
  const roms = "D:\\Switch"
  const rom = path.win32.join(roms, "Metroid Dread [010093801237C000][v1.0].xci")
  const deps = memoryDeps({ [path.win32.join("C:\\Users\\me\\AppData\\Roaming", "Ryujinx", "Config.json")]: JSON.stringify({ game_dirs: [roms] }), [rom]: "" }, { [roms]: [path.win32.basename(rom)] })
  const found = await new RyujinxLauncher().scan(deps)
  expect(found.games).toHaveLength(1)
  expect(found.games[0].id).toBe("ryujinx:010093801237c000")
  expect(found.games[0].name).toBe("Metroid Dread")
  expect(found.games[0].launchUrl).toBe(rom)
  expect(found.games[0].launchError).not.toBe("")
})

test("ryujinx icons use the user supplied names, most specific first", async () => {
  const dataDir = "E:\\ElectronicGame\\ryujinx\\portable"
  const roms = "E:\\ElectronicGame\\switch_game"
  const rom = path.win32.join(roms, "Metroid Dread [010093801237C000][v1.0].xci")
  const base = "Metroid Dread [010093801237C000][v1.0]"
  const titleId = "010093801237c000"
  const byId = path.win32.join(roms, "icons", `${titleId}.png`)
  const byName = path.win32.join(roms, "icons", `${base}.jpg`)
  const sidecar = path.win32.join(roms, `${base}.ico`)
  const cached = path.win32.join(dataDir, "games", titleId, "gui", "icon.png")
  const artwork = (files: Record<string, string>) => ryujinxArtwork(memoryDeps(files, {}), dataDir, rom, titleId)

  expect(await artwork({})).toBeNull()
  // The Ryujinx data folder is the last resort.
  expect(await artwork({ [cached]: "png" })).toEqual({ iconPath: cached, iconType: "absolute" })
  // A plain image beside the ROM works without any folder.
  expect(await artwork({ [sidecar]: "ico", [cached]: "png" })).toEqual({ iconPath: sidecar, iconType: "fileicon" })
  // `icons\<rom file name>.jpg` beats the file beside the ROM.
  expect(await artwork({ [byName]: "jpg", [sidecar]: "ico" })).toEqual({ iconPath: byName, iconType: "absolute" })
  // `icons\<title id>.png` wins over every other name.
  expect(await artwork({ [byId]: "png", [byName]: "jpg", [cached]: "png" })).toEqual({ iconPath: byId, iconType: "absolute" })
  // Without a title id the ROM file name is still usable.
  expect(await ryujinxArtwork(memoryDeps({ [byName]: "jpg" }, {}), dataDir, rom, "")).toEqual({ iconPath: byName, iconType: "absolute" })
})
