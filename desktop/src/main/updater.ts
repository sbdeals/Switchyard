/**
 * Auto-update from GitHub Releases (electron-builder writes latest.yml next to
 * the installers; the release workflow publishes both). Windows works unsigned;
 * macOS works on release builds, which are signed + notarized in CI (Squirrel.Mac
 * rejects unsigned apps). An unsigned mac build — a local `npm run dist`, or a
 * fork release without the signing secrets — fails the periodic check, which is
 * logged and otherwise silent; the tray's manual check still tells the user a
 * newer version exists.
 */
import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

import { log } from "./logging.js";

let initialized = false;

export function initUpdater(): void {
  if (!app.isPackaged || initialized) return;
  initialized = true;
  autoUpdater.logger = {
    info: (m: unknown) => log(`updater: ${m}`),
    warn: (m: unknown) => log(`updater: ${m}`),
    error: (m: unknown) => log(`updater: ${m}`),
    debug: () => {},
  };
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", (info) => {
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: `Switchyard ${info.version} has been downloaded.`,
        detail: "Restart the app to apply it. The stack keeps running either way.",
      })
      .then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
  });
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((e) => log(`updater: check failed (${e.message})`));
  };
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

/** Tray-triggered check with visible feedback. */
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ message: "Updates only apply to the packaged app.", type: "info" });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const next = result?.updateInfo.version;
    if (!next || next === app.getVersion()) {
      await dialog.showMessageBox({
        type: "info",
        message: `You're on the latest version (${app.getVersion()}).`,
      });
    }
    // A newer version triggers the update-downloaded dialog from initUpdater.
  } catch (e) {
    await dialog.showMessageBox({
      type: "warning",
      message: "Could not check for updates.",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}
