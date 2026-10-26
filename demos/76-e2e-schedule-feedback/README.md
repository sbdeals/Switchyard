# #76 — schedule Run now feedback (E2E-019)

Local test stack only. Uses the throwaway app `nginx-g9se` (not running) and a temporary schedule `demo-run-now`, deleted after each run.

- `before.mp4`, `before-run-now.png`, `before.txt` — main: Run now is enabled and a click shows nothing, yet Dokploy recorded an `error` execution.
- `after.mp4`, `after-run-now.png`, `after.txt` — 05dc784: Run now is disabled with "Start the service first", and nothing runs.
- `verifier-output.txt` — 23 checks covering the running-app success/failure/history paths. These can't run live here because the host Docker isn't a swarm manager, so image apps can't start.
