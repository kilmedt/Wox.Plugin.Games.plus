import { GameLauncher } from "../types"
import { BattleNetLauncher } from "./battlenet"
import { EaLauncher } from "./ea"
import { EpicLauncher } from "./epic"
import { GogLauncher } from "./gog"
import { ItchLauncher } from "./itch"
import { LocalLauncher } from "./local"
import { RyujinxLauncher } from "./ryujinx"
import { SteamLauncher } from "./steam"
import { UbisoftLauncher } from "./ubisoft"
import { WeGameLauncher } from "./wegame"
import { XboxLauncher } from "./xbox"

export function createLaunchers(): GameLauncher[] {
  return [
    new SteamLauncher(),
    new EpicLauncher(),
    new GogLauncher(),
    new UbisoftLauncher(),
    new EaLauncher(),
    new BattleNetLauncher(),
    new WeGameLauncher(),
    new XboxLauncher(),
    new ItchLauncher(),
    new RyujinxLauncher(),
    // The local folder is walked last: platform launchers already claimed their own installs.
    new LocalLauncher()
  ]
}
