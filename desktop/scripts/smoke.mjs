// Headless end-to-end check: boots the app in smoke mode (no window), which
// converges the real local stack and exits 0 only when the dashboard is
// healthy AND the minted auto-login cookie gets a 200 past the /login gate.
// Exit codes: 0 ready, 1 error/degraded, 2 needs user interaction, 3 timeout.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electron = require("electron"); // resolves to the electron binary path

const child = spawn(electron, ["."], {
  env: { ...process.env, SWITCHYARD_DESKTOP_SMOKE: "1" },
  stdio: ["ignore", "inherit", "inherit"],
});

const killTimer = setTimeout(() => {
  console.error("smoke: hard timeout (15 min), killing electron");
  child.kill();
  process.exitCode = 3;
}, 15 * 60_000);

child.on("close", (code) => {
  clearTimeout(killTimer);
  console.log(`smoke: electron exited with code ${code}`);
  process.exitCode = code ?? 1;
});
