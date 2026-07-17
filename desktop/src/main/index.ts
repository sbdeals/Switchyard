/**
 * Electron main entry: one window that swaps between the local status/wizard
 * view (file://) and the dashboard itself (http://127.0.0.1:<port>) once the
 * stack is healthy. A tray icon keeps the app alive when the window is closed;
 * quitting the app never stops the stack (containers restart unless-stopped).
 *
 * Smoke mode (SWITCHYARD_DESKTOP_SMOKE=1): no window — run the orchestrator,
 * print state transitions as JSON lines, exit 0 once the dashboard is healthy
 * and the auto-login cookie verifies end to end. Exit codes: 1 error, 2 user
 * interaction required, 3 timeout.
 */
import { join } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";

import { establishDashboardSession } from "./autologin.js";
import { initLogging, log, logFilePath } from "./logging.js";
import type { ReadyInfo, UiState } from "./orchestrator.js";
import { Orchestrator } from "./orchestrator.js";
import { augmentPath, DOCKER_INSTALL_DOCS_URL, DOCKER_LICENSE_URL } from "./prereqs.js";
import { loadSettings, saveSettings } from "./settings.js";
import { createTray, refreshTray, TrayDeps } from "./tray.js";
import { checkForUpdatesInteractive, initUpdater } from "./updater.js";

const SMOKE = process.env.SWITCHYARD_DESKTOP_SMOKE === "1";
const SMOKE_TIMEOUT_MS = 12 * 60_000;

/** Links the status view may open in the system browser. */
const EXTERNAL_URL_ALLOWLIST = [DOCKER_LICENSE_URL, DOCKER_INSTALL_DOCS_URL];

let win: BrowserWindow | null = null;
let currentView: "status" | "dashboard" = "status";
let quitting = false;

const orchestrator = new Orchestrator();
const settings = loadSettings();

// Smoke mode runs windowless (often in headless/sandboxed environments where
// no GPU exists); --gpu-safe / SWITCHYARD_DISABLE_GPU cover machines and
// remote-desktop sessions where Chromium's GPU process fatally fails to start.
const GPU_SAFE =
  SMOKE || process.argv.includes("--gpu-safe") || process.env.SWITCHYARD_DISABLE_GPU === "1";
if (GPU_SAFE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  // Without this the viz compositor still runs as a separate "GPU process",
  // which fatally crashes in session-0/service contexts (STATUS_BREAKPOINT).
  app.commandLine.appendSwitch("in-process-gpu");
}

// After repeated GPU-process crashes Chromium gives up and kills the whole app
// ("GPU process isn't usable") — relaunch in software rendering before that.
let gpuCrashes = 0;
app.on("child-process-gone", (_e, details) => {
  if (details.type !== "GPU") return;
  gpuCrashes++;
  if (!GPU_SAFE && gpuCrashes >= 2) {
    app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== "--gpu-safe"), "--gpu-safe"] });
    app.exit(0);
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  void main();
}

async function main(): Promise<void> {
  await app.whenReady();
  app.setAppUserModelId("dev.switchyard.desktop");
  initLogging();
  augmentPath();

  if (SMOKE) {
    runSmoke();
    return;
  }

  if (app.isPackaged && process.platform !== "darwin") Menu.setApplicationMenu(null);
  applyLoginItem();

  const hiddenLaunch =
    process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAtLogin;

  createWindow(!hiddenLaunch);
  createTray(trayDeps());
  initUpdater();
  wireOrchestrator();
  wireIpc();

  app.on("activate", () => showWindow()); // macOS dock click
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("window-all-closed", () => {
    /* keep running in the tray on every platform */
  });

  void orchestrator.run();
}

// ---- window ------------------------------------------------------------------

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    show,
    backgroundColor: "#0b101c",
    icon: join(__dirname, "window.png"),
    title: "Switchyard",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Closing the window minimizes to the tray; the stack (and the app) live on.
  win.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  // Only the local status view and the dashboard render inside the app —
  // everything else (deployed app URLs, GitHub, Dokploy) opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isInternalUrl(url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (currentView === "dashboard") {
      log(`Dashboard window failed to load (${code} ${desc} at ${url}) — showing status view.`);
      void loadStatusView();
    }
  });

  void loadStatusView();
}

function isInternalUrl(url: string): boolean {
  if (url.startsWith("file:")) return true;
  const dash = orchestrator.snapshot().dashboardUrl;
  return Boolean(dash && url.startsWith(dash));
}

async function loadStatusView(): Promise<void> {
  if (!win) return;
  currentView = "status";
  await win.loadFile(join(__dirname, "index.html")).catch(() => {});
}

async function loadDashboard(url: string): Promise<void> {
  if (!win) return;
  currentView = "dashboard";
  await win.loadURL(url).catch(() => {});
}

function showWindow(): void {
  if (!win) return;
  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}

// ---- orchestrator wiring --------------------------------------------------------

function wireOrchestrator(): void {
  orchestrator.on("state", (state: UiState) => {
    refreshTray(trayDeps());
    if (state.phase !== "ready" && currentView === "dashboard") {
      void loadStatusView(); // a restart/stop/error pulls the window back to status
    } else if (currentView === "status") {
      win?.webContents.send("state", state);
    }
    // Anything that needs the user should surface even after a hidden launch.
    if (
      (state.phase === "wizard" || state.phase === "credentials" || state.phase === "error") &&
      win &&
      !win.isVisible()
    ) {
      showWindow();
    }
  });

  orchestrator.on("ready", (info: ReadyInfo) => {
    void (async () => {
      await establishDashboardSession(session.defaultSession, info.cfg);
      await loadDashboard(info.dashboardUrl);
    })();
  });
}

// ---- IPC (status view → main) -----------------------------------------------------

function wireIpc(): void {
  ipcMain.handle("getState", (e) => {
    if (!e.senderFrame?.url.startsWith("file:")) return null;
    return orchestrator.snapshot();
  });
  ipcMain.handle("action", async (e, id: unknown, payload: unknown) => {
    // The dashboard is web content — only the bundled status view may drive the app.
    if (!e.senderFrame?.url.startsWith("file:")) return;
    if (typeof id !== "string") return;
    await dispatchAction(id, payload);
  });
}

async function dispatchAction(id: string, payload?: unknown): Promise<void> {
  switch (id) {
    case "logs": {
      const file = logFilePath();
      if (file) shell.showItemInFolder(file);
      return;
    }
    case "openUrl": {
      const url = typeof payload === "string" ? payload : "";
      if (EXTERNAL_URL_ALLOWLIST.includes(url)) void shell.openExternal(url);
      return;
    }
    case "openDashboard": {
      const dash = orchestrator.snapshot().dashboardUrl;
      if (dash) await loadDashboard(dash);
      return;
    }
    case "quit":
      app.quit();
      return;
    default:
      await orchestrator.handleAction(id, payload);
  }
}

// ---- tray ---------------------------------------------------------------------------

function trayDeps(): TrayDeps {
  return {
    getPhase: () => orchestrator.currentPhase(),
    showWindow: () => showWindow(),
    openDokploy: () => {
      const url = orchestrator.snapshot().dokployUrl;
      if (url) void shell.openExternal(url);
    },
    startStack: () => void orchestrator.run(),
    stopStack: () => void orchestrator.stopStack(),
    resetStack: () => void confirmReset(),
    openLogs: () => {
      const file = logFilePath();
      if (file) shell.showItemInFolder(file);
    },
    checkForUpdates: () => void checkForUpdatesInteractive(),
    getOpenAtLogin: () => settings.openAtLogin,
    setOpenAtLogin: (value: boolean) => {
      settings.openAtLogin = value;
      saveSettings(settings);
      applyLoginItem();
    },
    quit: () => app.quit(),
  };
}

async function confirmReset(): Promise<void> {
  showWindow();
  const r = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Delete everything", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Reset Switchyard",
    message: "Delete ALL Dokploy data and start fresh?",
    detail:
      "Every project, deployment, database, and the admin account will be permanently deleted. The stack is then reinstalled from scratch.",
  });
  if (r.response === 0) void orchestrator.resetAll();
}

/** Auto-launch at login (packaged builds only), hidden into the tray. */
function applyLoginItem(): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    args: ["--hidden"],
  });
}

// ---- smoke mode -----------------------------------------------------------------------

function runSmoke(): void {
  const emit = (obj: Record<string, unknown>): void => {
    console.log(`SMOKE ${JSON.stringify(obj)}`);
  };
  const timeout = setTimeout(() => {
    emit({ result: "timeout" });
    app.exit(3);
  }, SMOKE_TIMEOUT_MS);

  orchestrator.on("state", (state: UiState) => {
    emit({ phase: state.phase, steps: state.steps.map((s) => `${s.id}:${s.status}`) });
    if (state.phase === "wizard" || state.phase === "credentials") {
      emit({ result: "needs-user", detail: state.wizard?.kind ?? "credentials" });
      app.exit(2);
    }
    if (state.phase === "error") {
      emit({ result: "error", title: state.error?.title, message: state.error?.message });
      app.exit(1);
    }
  });

  orchestrator.on("ready", (info: ReadyInfo) => {
    void (async () => {
      const loggedIn = await establishDashboardSession(session.defaultSession, info.cfg);
      // End-to-end proof: the minted cookie must get past the /login gate.
      let rootStatus = 0;
      try {
        const cookies = await session.defaultSession.cookies.get({
          url: info.dashboardUrl,
          name: "switchyard_session",
        });
        const res = await fetch(info.dashboardUrl + "/", {
          redirect: "manual",
          headers: cookies.length ? { Cookie: `switchyard_session=${cookies[0]!.value}` } : {},
        });
        rootStatus = res.status;
      } catch {
        rootStatus = -1;
      }
      clearTimeout(timeout);
      const ok = loggedIn && rootStatus === 200;
      emit({
        result: ok ? "ready" : "ready-degraded",
        dashboardUrl: info.dashboardUrl,
        dokployUrl: info.dokployUrl,
        autologin: loggedIn,
        rootStatus,
      });
      app.exit(ok ? 0 : 1);
    })();
  });

  void orchestrator.run();
}
