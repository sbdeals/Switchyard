import type { ActivityEntry } from "./activity";

/** Poll only while the Activity panel is mounted, with no overlapping requests. */
export function watchActivity(
  onUpdate: (entries: ActivityEntry[]) => void,
  onError: (message: string) => void
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController;

  async function refresh() {
    request = new AbortController();
    let message = "Could not load activity. Retrying in 10 seconds.";
    try {
      const response = await fetch("/api/activity", { signal: request.signal });
      if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/login")) {
        message = "Your session has expired. Sign in again to view activity.";
        throw new Error("Session expired");
      }
      if (!response.ok) throw new Error("Activity request failed");
      const data = await response.json();
      if (!data || !Array.isArray(data.entries)) throw new Error("Invalid activity response");
      if (!stopped) onUpdate(data.entries);
    } catch {
      if (!stopped) onError(message);
    } finally {
      if (!stopped) timer = setTimeout(refresh, 10_000);
    }
  }

  void refresh();
  return () => {
    stopped = true;
    clearTimeout(timer);
    request.abort();
  };
}
