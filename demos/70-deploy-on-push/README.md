# #70: push-to-deploy webhooks

Playwright run against a throwaway dashboard (`sy-f`, 127.0.0.1:3005) on the local Dokploy, using a service created this session from the public `heroku/node-js-getting-started` repo.
- **before:** `5e66b3e` (#52)
- **after:** `fc60e90`

- `after.mp4` and `after-result.txt` cover: Settings → Deploy on push (enabled: Payload URL, masked secret, instructions), then a locally signed GitHub `push`:
  - unsigned → 403
  - bad sig → 403
  - signed → 202 "deployment queued"
  - replay → 200 "duplicate or disabled"
  - Deploys tab → new row `Deploy 8b8dec1 · Bump express (#418)`, Succeeded
- `before.mp4` and `before-result.txt` show no Deploy-on-push panel, and the hook path returns 401 (no such public route).

  The before Deploys screenshot shows the titled rows too, because they are stored in Dokploy (created by the after run). Only the pre-F row reads "Manual deployment".
- `codex-terminal-proof.txt`: Codex's own curl run, including the case where the hook still deploys after owner sign-out (202). Its early unsigned attempts lacked the `sha256=` prefix, which is expected.
- Repro: `runsy.sh sy-f 3005 f-after`, then `BASE=http://127.0.0.1:3005 OUT=/tmp/fdemo/after node f-hook.mjs`.
