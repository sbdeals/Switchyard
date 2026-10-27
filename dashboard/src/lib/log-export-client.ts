import { formatVisibleLogs, logDownloadFilename } from "./log-export";

export async function copyVisibleLogs(lines: { ts: number; text: string }[]): Promise<void> {
  await navigator.clipboard.writeText(formatVisibleLogs(lines));
}

/** Fetch first so authorization and daemon errors stay visible in the drawer. */
export async function downloadServiceLogs(app: string, lines: number, format: "log" | "json"): Promise<void> {
  const query = new URLSearchParams({ app, lines: String(lines), format });
  const response = await fetch(`/api/services/logs/download?${query}`);
  if (!response.ok) throw new Error(`Could not download logs (${response.status}). Try again.`);
  const contentType = format === "json" ? "application/json" : "text/plain";
  if (!response.headers.get("Content-Type")?.startsWith(contentType)) {
    throw new Error("Could not download logs. Sign in and try again.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
    ?? logDownloadFilename(app, format);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start reading the blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
