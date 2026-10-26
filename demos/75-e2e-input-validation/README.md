# #75 — input validation (E2E-018/022/010/008)

Local test stack only; uses the throwaway app `nginx-g9se`. The rows created by the before run were deleted before the after run.

- `before.mp4`, `before-*.png`, `before.txt` — main 1fc46d5
- `after.mp4`, `after-*.png`, `after.txt` — codex/e2e-input-validation da0ebfb
- `iv.mjs` — the Playwright script; `env-fixture.txt` — the pasted env

| Input | Before | After |
|---|---|---|
| Env fixture | "7 variables" | "4 variables" |
| `+ BROKEN_LINE` | Saved | `Variables line 8: use KEY=value.` |
| Port 70000 | Stored | Rejected |
| Cron `not-a-cron` | Stored | Rejected |
| Cron `0 0 L * *` | Stored | Stored |
| Mount at `data` | Stored | Rejected |
