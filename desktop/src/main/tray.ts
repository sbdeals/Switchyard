import { join } from "node:path";

import { Menu, nativeImage, Tray } from "electron";

import type { Phase } from "./orchestrator.js";

export interface TrayDeps {
  getPhase(): Phase;
  showWindow(): void;
  openDokploy(): void;
  startStack(): void;
  stopStack(): void;
  resetStack(): void;
  openLogs(): void;
  checkForUpdates(): void;
  getOpenAtLogin(): boolean;
  setOpenAtLogin(value: boolean): void;
  quit(): void;
}

let tray: Tray | null = null;

export function createTray(deps: TrayDeps): void {
  const image = nativeImage.createFromPath(join(__dirname, "tray.png"));
  tray = new Tray(image);
  tray.setToolTip("Switchyard");
  tray.on("click", () => deps.showWindow());
  refreshTray(deps);
}

/** Rebuild the context menu to match the current phase. */
export function refreshTray(deps: TrayDeps): void {
  if (!tray) return;
  const phase = deps.getPhase();
  const idle = phase === "ready" || phase === "error" || phase === "stopped";
  tray.setToolTip(
    phase === "ready" ? "Switchyard — running" : phase === "stopped" ? "Switchyard — stopped" : "Switchyard",
  );
  const menu = Menu.buildFromTemplate([
    {
      label: phase === "ready" ? "Open dashboard" : "Show Switchyard",
      click: () => deps.showWindow(),
    },
    {
      label: "Open Dokploy in browser",
      enabled: phase === "ready",
      click: () => deps.openDokploy(),
    },
    { type: "separator" },
    {
      label: phase === "stopped" ? "Start stack" : "Restart / converge",
      enabled: idle,
      click: () => deps.startStack(),
    },
    {
      label: "Stop stack",
      enabled: phase === "ready" || phase === "error",
      click: () => deps.stopStack(),
    },
    {
      label: "Reset everything…",
      enabled: idle,
      click: () => deps.resetStack(),
    },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: deps.getOpenAtLogin(),
      click: (item) => deps.setOpenAtLogin(item.checked),
    },
    { label: "View logs", click: () => deps.openLogs() },
    { label: "Check for updates…", click: () => deps.checkForUpdates() },
    { type: "separator" },
    { label: "Quit (stack keeps running)", click: () => deps.quit() },
  ]);
  tray.setContextMenu(menu);
}
