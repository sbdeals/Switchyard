interface LogPollingOptions<T> {
  load: (signal: AbortSignal) => Promise<T>;
  onData: (data: T) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
  live?: boolean;
}

/** Poll bounded snapshots without overlapping requests or publishing stale results. */
export function startLogPolling<T>(options: LogPollingOptions<T>) {
  let live = options.live ?? true;
  let closed = false;
  let queued = false;
  let active: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  async function refresh() {
    if (closed) return;
    clearTimer();
    if (active) {
      queued = true;
      return;
    }

    const controller = new AbortController();
    active = controller;
    try {
      const data = await options.load(controller.signal);
      if (!closed && !controller.signal.aborted) options.onData(data);
    } catch (error) {
      if (!closed && !controller.signal.aborted) options.onError(error);
    } finally {
      active = null;
      if (!closed) {
        if (queued) {
          queued = false;
          void refresh();
        } else if (live) {
          timer = setTimeout(() => void refresh(), options.intervalMs ?? 3000);
        }
      }
    }
  }

  void refresh();

  return {
    setLive(value: boolean) {
      if (closed || value === live) return;
      live = value;
      if (live) {
        void refresh();
      } else {
        clearTimer();
        queued = false;
        active?.abort();
      }
    },
    refresh() {
      void refresh();
    },
    close() {
      closed = true;
      queued = false;
      clearTimer();
      active?.abort();
    },
  };
}
