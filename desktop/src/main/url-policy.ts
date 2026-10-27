import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isHttpUrl(url: URL | null): url is URL {
  return Boolean(
    url &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password,
  );
}

/** Only the bundled document, with no query or fragment, may drive the app. */
export function isStatusViewUrl(url: string, statusFilePath: string): boolean {
  try {
    const target = new URL(url);
    const targetPath = resolve(fileURLToPath(target));
    return (
      targetPath === resolve(statusFilePath) &&
      target.href === pathToFileURL(targetPath).href
    );
  } catch {
    return false;
  }
}

export function navigationDecision(
  url: string,
  statusFilePath: string,
  dashboardUrl?: string,
): "allow" | "external" | "deny" {
  if (isStatusViewUrl(url, statusFilePath)) return "allow";
  const target = parseUrl(url);
  if (!isHttpUrl(target)) return "deny";
  const dashboard = dashboardUrl ? parseUrl(dashboardUrl) : null;
  return isHttpUrl(dashboard) && target.origin === dashboard.origin ? "allow" : "external";
}

/** Copy buttons may write plain text; all other browser permissions stay denied. */
export function permissionDecision(
  permission: string,
  requestingUrl: string,
  statusFilePath: string,
  dashboardUrl?: string,
): boolean {
  return (
    permission === "clipboard-sanitized-write" &&
    navigationDecision(requestingUrl, statusFilePath, dashboardUrl) === "allow"
  );
}

/** Frame identity prevents other windows and subframes from using privileged IPC. */
type FrameLike = { url: string; processId?: number; routingId?: number };

function sameFrame(a: FrameLike, b: FrameLike): boolean {
  if (a === b) return true;
  // Electron normally hands out one WebFrameMain wrapper per frame; fall back to
  // its stable identifiers rather than relying on object identity alone.
  return (
    typeof a.processId === "number" &&
    typeof a.routingId === "number" &&
    a.processId === b.processId &&
    a.routingId === b.routingId
  );
}

export function isTrustedIpcSender(
  senderFrame: FrameLike | null | undefined,
  mainFrame: FrameLike | undefined,
  statusFilePath: string,
): boolean {
  return Boolean(
    senderFrame &&
      mainFrame &&
      sameFrame(senderFrame, mainFrame) &&
      isStatusViewUrl(senderFrame.url, statusFilePath),
  );
}
