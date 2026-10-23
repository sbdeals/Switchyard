# #39 — no redirect loop when the Dokploy session expires

PR: https://github.com/sbdeals/Switchyard/pull/39 · branch `codex/login-session-recovery` @ 226c76e · finding S-P1-3

**Stack:** live bridge-mode Dokploy and dashboard. The run (`demo-tools/lsr.mjs`) goes against `switchyard-dash:main`, then `switchyard-dash:login-session-recovery`:
1. Sign in to Switchyard.
2. Revoke the admin's Dokploy sessions upstream with `POST /api/auth/revoke-sessions`. This is what a Dokploy session expiry or a sign-out-everywhere does.
3. Reload `/`.

| | navigation chain | result | cookie |
|---|---|---|---|
| before | `307 / → 307 /login → 307 / → …` (38 navigations) | `ERR_TOO_MANY_REDIRECTS` ("Try deleting your cookies") | still set |
| after | `307 / → 307 /api/session/expired → 200 /login?expired=1` | "Your session expired. Sign in again." | deleted |

**Files:**
- `before.mp4`, `after.mp4` (plus .webm)
- `*-1-signed-in.png`, `*-2-after-reload.png`
- `*-result.json`
