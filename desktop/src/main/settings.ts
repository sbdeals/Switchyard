/**
 * Desktop-only preferences, stored NEXT TO the CLI's config.json (same
 * %APPDATA%/switchyard folder) but in a separate file so the CLI's
 * config-hash/idempotence story is untouched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../../../cli/src/core/config.js";

export interface DesktopSettings {
  /** Launch the app (hidden, tray-only) when the user logs in. */
  openAtLogin: boolean;
}

const DEFAULTS: DesktopSettings = { openAtLogin: true };

export function desktopSettingsPath(): string {
  return join(dirname(configPath()), "desktop.json");
}

export function loadSettings(): DesktopSettings {
  const path = desktopSettingsPath();
  if (!existsSync(path)) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...(JSON.parse(readFileSync(path, "utf8")) as Partial<DesktopSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: DesktopSettings): void {
  const path = desktopSettingsPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch {
    /* preferences are best-effort */
  }
}
