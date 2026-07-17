// Screenshot harness for the status view: renders each UiState the renderer
// knows how to draw and writes PNGs (path via UI_SHOT_DIR). The window is
// briefly visible — capturePage needs a composited surface, and offscreen
// rendering deadlocks in GPU-less sessions.
// Run with: npx electron scripts/ui-shot-main.cjs   (after `npm run build`)
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("in-process-gpu");
// Restricted CI/agent shells can't start Chromium's renderer sandbox at all
// (every load fails ERR_FAILED). Harness-only escape hatch — never the app.
if (process.env.UI_SHOT_NO_SANDBOX === "1") app.commandLine.appendSwitch("no-sandbox");

const outDir = process.env.UI_SHOT_DIR || join(__dirname, "..", "shots");

// Own userData so a concurrently running (or crashed) app instance can't hold
// the cache lock; own exit on failure so the harness never hangs a CI shell.
app.setPath("userData", join(app.getPath("temp"), "switchyard-ui-shot"));
process.on("unhandledRejection", (err) => {
  console.error("ui-shot failed:", err);
  app.exit(1);
});

const STEPS_MID = [
  { id: "engine", label: "Container engine (Docker Desktop)", status: "done" },
  { id: "services", label: "Core services — Dokploy, Postgres, Redis", status: "active", note: "pulling images ..." },
  { id: "dokploy", label: "Dokploy API", status: "pending" },
  { id: "admin", label: "Admin account", status: "pending" },
  { id: "dashboard", label: "Switchyard dashboard", status: "pending" },
];

const BASE = { version: "0.1.0", logTail: ["[00:00:01] Starting Docker Desktop ...", "[00:00:14] Creating service dokploy-postgres ...", "[00:00:15] Waiting for services to converge (first image pulls take a while) ..."] };

const STATES = {
  starting: { ...BASE, phase: "starting", steps: STEPS_MID },
  "wizard-docker-missing": {
    ...BASE,
    phase: "wizard",
    steps: STEPS_MID,
    wizard: { kind: "docker-missing", platform: "win32", licenseUrl: "https://www.docker.com/legal/docker-subscription-service-agreement/" },
  },
  "wizard-downloading": {
    ...BASE,
    phase: "wizard",
    steps: STEPS_MID,
    wizard: { kind: "downloading", progress: 0.62, platform: "win32", licenseUrl: "" },
  },
  credentials: {
    ...BASE,
    phase: "credentials",
    steps: STEPS_MID,
    credentials: { message: "This Dokploy already has an admin — enter its email and password.", email: "admin@example.com" },
  },
  error: {
    ...BASE,
    phase: "error",
    steps: STEPS_MID,
    error: {
      title: "Data from a previous install",
      message: "Found a leftover dokploy-postgres volume from a previous install (its password secret is gone).",
      detail: "[00:00:12] docker volume inspect dokploy-postgres -> exists\n[00:00:12] docker secret inspect dokploy_postgres_password -> missing",
      actions: [
        { id: "forceKeepData", label: "Keep the old data", kind: "primary" },
        { id: "freshStart", label: "Fresh start (deletes it)", kind: "danger" },
        { id: "logs", label: "View logs" },
      ],
    },
  },
  stopped: { ...BASE, phase: "stopped", steps: [] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    show: true,
    backgroundColor: "#0b101c",
    webPreferences: {
      preload: join(__dirname, "..", "dist", "preload.cjs"),
      contextIsolation: true,
    },
  });
  await win.loadFile(join(__dirname, "..", "dist", "index.html"));
  await sleep(400);
  for (const [name, state] of Object.entries(STATES)) {
    win.webContents.send("state", state);
    await sleep(350);
    const image = await win.webContents.capturePage();
    writeFileSync(join(outDir, `${name}.png`), image.toPNG());
    console.log(`shot: ${name}.png`);
  }
  app.exit(0);
});
