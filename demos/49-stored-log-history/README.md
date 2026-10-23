# #49 — Logs tab shows persisted history when the container is not running

PR: https://github.com/sbdeals/Switchyard/pull/49 · branch `codex/stored-log-history` (stacked on #45)

This ran on the live bridge stack. The dashboard uses a Postgres log store (`sy-demo-store` on `dokploy-network`) with the collector every 5s (`SY_STORE_URL=… SY_COLLECT_MS=5000 sh stack/run-dash.sh <image>`).

Flow (`lsh.mjs`):
1. `logdemo-container.sh` creates a fresh registry-app task container that prints a start line and tick 1–5.
2. Log in and open the workspace, which starts the collector, then wait 15s.
3. Count the persisted rows: 6 in both runs.
4. `docker stop` the container, then open registry-app's Logs tab.

| | Result |
|---|---|
| **before** (`switchyard-dash:sse-text-decoding`, #45) | Only `— container is not running —`, even though 6 lines are in the store. See `before.mp4`, `before-logs-after-stop.png`, `before-logs.txt`. |
| **after** (`switchyard-dash:stored-log-history`) | "from history" separator, then the 6 dimmed persisted lines (UTF-8 intact), then the stopped marker. See `after.mp4`, `after-logs-after-stop.png`, `after-logs.txt`. |

The unit harness `verify-stored-log-history.cjs` passes 11/11 (`harness-output.txt`).

**Limitation:** history is the collector's sample (up to 100 lines per tick). Output printed after the last tick and before the crash isn't included.
