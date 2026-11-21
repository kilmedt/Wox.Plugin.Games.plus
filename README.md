# Wox.Plugin.Games

Search installed games from Steam, Epic, GOG, Ubisoft Connect, EA, Battle.net, WeGame, Xbox, itch.io, the local Ryujinx Switch emulator, and a local games folder.

![](screenshot.png)

# Install

```
wpm install Games
```

# Supported launchers

Every source is discovered from the files it already keeps on disk. Nothing has to be configured.

| Source          | How games are found                                                                                          | How a game starts                             |
| --------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Steam           | `libraryfolders.vdf` and `appmanifest_*.acf`                                                                 | `steam://rungameid/<appid>`                   |
| Epic            | `ProgramData/Epic/EpicGamesLauncher/Data/Manifests`                                                          | `com.epicgames.launcher://` protocol          |
| GOG             | `GOG.com\Games` registry                                                                                     | Executable, or `goggalaxy://`                 |
| Ubisoft Connect | `Ubisoft\Launcher\Installs` registry                                                                         | `uplay://launch/<id>`                         |
| EA              | `EA Games`/`Origin Games` registry, installer manifests and install folders                                  | `origin2://` after the EA App window is ready |
| Battle.net      | Battle.net aggregate manifests                                                                               | Battle.net client with the launch code        |
| WeGame          | `WeGameApps\rail_apps\<name>(<game id>)` next to the client, plus older installs directly under `WeGameApps` | `wegame://action=StartFor&game_id=<game id>`  |
| Xbox            | `MicrosoftGame.config` in `XboxGames` and registered packages                                                | `shell:AppsFolder\...`                        |
| itch.io         | `%APPDATA%\itch\db\butler.db`                                                                                | `itch://caves/<id>/launch`                    |
| Ryujinx         | `game_dirs` from `Config.json`, including the portable `portable` folder                                     | `Ryujinx.exe <rom>`                           |
| Local           | Every game folder under `E:\ElectronicGame`, except platform folders and installs a launcher already owns    | The discovered game executable                |

## WeGame notes

WeGame is a closed client, so the plugin reads the layout the client writes instead of its encrypted
catalog:

- the client directory comes from `HKLM\SOFTWARE\WOW6432Node\Tencent\WeGame\InstallPath`,
  `HKLM\SOFTWARE\Tencent\WeGame` and `HKCU\Software\Tencent\WeGame`;
- the library is the `WeGameApps` folder beside the client, and a `WeGameApps` folder on each drive is
  also checked because the library can be moved;
- a rail game is identified by its folder name, `DeltaForce(2001918)`, or by
  `rail_files/rail_game_identify.json` when the folder name carries no id;
- the game icon is `WeGameLauncher/game/game.png`, then the game executable's icon;
- `Launch` hands the game back to WeGame, which keeps updates, login and anti-cheat in charge.
  An older install without a game id starts its own executable instead.

A library moved to a folder that is not named `WeGameApps` is not discovered, because WeGame keeps
its own catalog encrypted.

## Ryujinx notes

- `Config.json` is read from the portable `portable` folder when present, otherwise from
  `%APPDATA%\Ryujinx`. The emulator executable is located through the `Ryujinx` Start menu or desktop
  shortcut, the usual install folders, or the same folder as a portable config;
- only the file types enabled in `shown_file_types` are indexed (`.nsp`, `.xci`, `.nca`, `.nro`,
  `.nso`, `.pfs0` by default);
- display names come from the title Ryujinx cached in `games/<title id>/gui/metadata.json`, so a game
  that was opened at least once shows its real title. Otherwise the plugin cleans the file name;
- `Launch` starts `Ryujinx.exe` with the ROM as its argument;
- game art is never read from the ROM (see below), so icons are optional files you supply.

### How to configure Ryujinx icons

Ryujinx does not cache cover art: `games/<title id>/gui` only holds metadata, and the icon inside a
ROM is encrypted, so the plugin never decrypts games. Icons are files you provide:

1. create an `icons` folder inside a Ryujinx game directory, for example
   `E:\ElectronicGame\switch_game\icons`;
2. save a square image there — `.png`, `.jpg`, `.jpeg` or `.ico`, 256×256 or larger works best;
3. name it after the game's 16-digit title id (`010074F013262000`, any case) or after the ROM file
   name without its extension (`Metroid Dread [010093801237C000][v1.0]`);
4. let the plugin rescan: it scans in the background at startup, or run **Rescan Games** on any result.

The first file that exists wins:

| #   | Location                               | File name         |
| --- | -------------------------------------- | ----------------- |
| 1   | `<game dir>\icons\`                    | `<title id>`      |
| 2   | `<game dir>\icons\`                    | `<rom file name>` |
| 3   | `<game dir>\` (beside the ROM)         | `<rom file name>` |
| 4   | `<ryujinx data>\games\<title id>\gui\` | `icon`            |

Extensions are `.png`, `.jpg`, `.jpeg` and `.ico`. `<game dir>` is a folder from Ryujinx's game
directories, `<ryujinx data>` is the folder holding `Config.json` (`portable` or `%APPDATA%\Ryujinx`),
and `<rom file name>` keeps the original brackets and tags. Windows matches the names
case-insensitively; a `.ico` is converted into the plugin icon cache and other images are used as they
are.

Example for `E:\ElectronicGame\switch_game\Metroid Dread [010093801237C000][v1.0].xci` — any one of:

```
E:\ElectronicGame\switch_game\icons\010093801237C000.png
E:\ElectronicGame\switch_game\icons\Metroid Dread [010093801237C000][v1.0].png
E:\ElectronicGame\switch_game\Metroid Dread [010093801237C000][v1.0].png
```

The plugin rescans in the background at startup, so a new image appears without restarting Wox.

<details>
<summary>中文：Ryujinx 图标配置方法</summary>

Ryujinx 本身不保存游戏封面，ROM 里的图标是加密的，插件不会解密游戏本体，所以图标由你手动放：

1. 在 Ryujinx 的游戏目录里新建 `icons` 文件夹，例如 `E:\ElectronicGame\switch_game\icons`；
2. 放一张正方形图片（`.png` / `.jpg` / `.jpeg` / `.ico`，建议 256×256 以上）；
3. 文件名用游戏的 16 位 title id（如 `010074F013262000`，大小写皆可），或 ROM 文件名去掉扩展名
   （如 `Metroid Dread [010093801237C000][v1.0]`）；
4. 让插件重扫：启动 Wox 时会在后台扫描，或在任意结果上执行 **Rescan Games**。

查找顺序（第一个存在即用）：

| 序号 | 位置                                       | 文件名                  |
| ---- | ------------------------------------------ | ----------------------- |
| 1    | `<游戏目录>\icons\`                        | `<title id>.png`        |
| 2    | `<游戏目录>\icons\`                        | `<ROM 文件名>.<扩展名>` |
| 3    | `<游戏目录>\`（与 ROM 同级）               | `<ROM 文件名>.<扩展名>` |
| 4    | `<Ryujinx 数据目录>\games\<title id>\gui\` | `icon.<扩展名>`         |

支持的扩展名：`.png`、`.jpg`、`.jpeg`、`.ico`。`<Ryujinx 数据目录>` 是放 `Config.json` 的目录
（`portable` 或 `%APPDATA%\Ryujinx`）。Windows 文件名不区分大小写；`.ico` 会转成插件缓存里的
PNG，其它图片直接使用。

例：`E:\ElectronicGame\switch_game\Metroid Dread [010093801237C000][v1.0].xci` 的图标可以放在

```
E:\ElectronicGame\switch_game\icons\010093801237C000.png
E:\ElectronicGame\switch_game\icons\Metroid Dread [010093801237C000][v1.0].png
```

</details>

## Local games folder

`E:\ElectronicGame` (`LOCAL_GAME_ROOTS` in `src/launchers/local.ts`) holds unpacked games that no store
client manages. Every direct subfolder is treated as one game install:

- **platform folders are skipped**: a folder whose own executable is a known client or emulator
  (`wegame.exe`, `Ryujinx.exe`, `steam.exe`, …) or that carries a launcher marker (`rail_apps`,
  `rail_user_data`, `steamapps`, `portable/Config.json`) is the platform itself, not a game;
- **games a launcher already indexed are skipped**: the local row is dropped when another launcher
  indexed the same folder, or a folder that nests it;
- the entry point is searched in the install folder and one level below it, because unpacked builds
  often keep the game in a versioned subfolder (`palu\Palworld.v1.0.2\Palworld.exe`). The executable
  named after the install folder, or after that subfolder, wins; two equally plausible executables
  are reported instead of launching the wrong one;
- the display name comes from the folder that really holds the game, so `palu` is listed as
  `Palworld` and `stelllarblade` as `Stellar Blade`;
- `Launch` runs the executable directly and `Open Install Folder` opens the install folder.

Add more folders by editing `LOCAL_GAME_ROOTS`; `make build` picks the change up.
