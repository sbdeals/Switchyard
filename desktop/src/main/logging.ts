/**
 * Desktop-app logging: a ring buffer (streamed into the status UI) plus an
 * append-only file under userData/logs for postmortems. Every converge log
 * line from the cli core modules flows through here.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

import { DESKTOP_VERSION } from "./version.js";

const RING_MAX = 300;
const ring: string[] = [];
const listeners: Array<(line: string) => void> = [];
let file: string | null = null;

export function initLogging(): void {
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    file = join(dir, "switchyard-desktop.log");
  } catch {
    file = null; // logging must never take the app down
  }
  log(`--- Switchyard Desktop v${DESKTOP_VERSION} starting (pid ${process.pid}, ${process.platform}) ---`);
}

export function logFilePath(): string | null {
  return file;
}

export function onLog(cb: (line: string) => void): void {
  listeners.push(cb);
}

export function log(msg: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  ring.push(line);
  if (ring.length > RING_MAX) ring.shift();
  if (file) {
    try {
      appendFileSync(file, line + "\n");
    } catch {
      /* disk full / permissions — keep running */
    }
  }
  if (!app.isPackaged || process.env.SWITCHYARD_DESKTOP_SMOKE) console.log(line);
  for (const cb of listeners) cb(line);
}

export function recentLogs(): string[] {
  return [...ring];
}
