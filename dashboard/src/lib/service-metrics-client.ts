import type { ContainerSample } from "./container-stats";

export const LIVE_METRICS_WINDOW_MS = 5 * 60_000;
export const LIVE_METRICS_INTERVAL_MS = 5_000;
const MAX_LIVE_SAMPLES = LIVE_METRICS_WINDOW_MS / LIVE_METRICS_INTERVAL_MS + 1;

export interface ServiceMetrics {
  status: "running" | "not-running" | "unavailable";
  sample: ContainerSample | null;
  containers: number;
}

/** Cached responses must not duplicate points or make the chart move backwards. */
export function appendLiveSample(
  previous: ContainerSample[],
  sample: ContainerSample,
  now = Date.now(),
): ContainerSample[] {
  const cutoff = now - LIVE_METRICS_WINDOW_MS;
  const recent = previous.filter((point) => point.ts >= cutoff);
  if (sample.ts < cutoff || (recent.length > 0 && sample.ts <= recent[recent.length - 1].ts)) {
    return recent.slice(-MAX_LIVE_SAMPLES);
  }
  return [...recent, sample].slice(-MAX_LIVE_SAMPLES);
}

type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/** Poll only while visible; abort and ignore outstanding work when paused or disposed. */
export function startVisiblePolling<T>({
  load,
  onValue,
  onError,
  visibility,
  intervalMs = LIVE_METRICS_INTERVAL_MS,
}: {
  load: (signal: AbortSignal) => Promise<T>;
  onValue: (value: T) => void;
  onError: () => void;
  visibility: Visibility;
  intervalMs?: number | null;
}): () => void {
  let disposed = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const poll = async () => {
    if (disposed || visibility.hidden || controller) return;
    const request = new AbortController();
    controller = request;
    try {
      const value = await load(request.signal);
      if (!disposed && controller === request && !request.signal.aborted) onValue(value);
    } catch {
      if (!disposed && controller === request && !request.signal.aborted) onError();
    } finally {
      if (controller === request) controller = null;
    }
  };

  const pause = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  const updateVisibility = () => {
    pause();
    if (disposed || visibility.hidden) return;
    void poll();
    if (intervalMs !== null) timer = setInterval(() => void poll(), intervalMs);
  };

  visibility.addEventListener("visibilitychange", updateVisibility);
  updateVisibility();
  return () => {
    disposed = true;
    pause();
    visibility.removeEventListener("visibilitychange", updateVisibility);
  };
}
