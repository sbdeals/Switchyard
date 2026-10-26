# #77 — compose-declared volumes (E2E-017)

Local test stack only. `compose-5ntm` is a throwaway compose stack (never deployed) with `data:/var/lib/postgresql/data`, anonymous `/tmp/cache` and bind `./site:/usr/share/nginx/html:ro`. `postgres-d4rm` is a native Dokploy Postgres, shown to confirm it is unchanged.

- `before.mp4`, `before-*.png`, `before.txt` — main: compose-5ntm shows "No mounts attached."
- `after.mp4`, `after-*.png`, `after.txt` — 487b668: three read-only "Declared in compose" rows with badges.
- `verifier-output.txt` — 17 parser/render cases.
