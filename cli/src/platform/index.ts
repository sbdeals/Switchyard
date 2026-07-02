import type { Platform } from "../core/config.js";
import { dockerDesktopPlatform } from "./docker-desktop.js";
import { linuxPlatform } from "./linux.js";
import type { PlatformModule } from "./types.js";

export function platformFor(platform: Platform): PlatformModule {
  return platform === "linux" ? linuxPlatform : dockerDesktopPlatform;
}
