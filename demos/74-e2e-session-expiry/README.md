# #74 — session expiry recovery (E2E-028)

Local test stack only. The throwaway app `nginx-g9se` was created for this run. Each scenario types a draft into Variables, expires the session, and clicks **Save variables**.

- `before.mp4` / `before-s*.png` / `before.txt` — main 1fc46d5
- `after.mp4` / `after-s*.png` / `after.txt` — codex/e2e-session-expiry f6c829d
- `se.mjs` — the Playwright script (`BASE=… node se.mjs <label> <out>`)

| Scenario | Before | After |
|---|---|---|
| 1. `switchyard_session` deleted | "This page couldn't load", draft lost | Banner, draft kept |
| 2. Cookie garbage | Redirected to /login, draft lost | Banner, draft kept |
| 3. Dokploy session row deleted | Draft lost; `/` → ERR_TOO_MANY_REDIRECTS | Banner, draft kept; `/` → `/login?expired=1` |
