# #63: bridge deploys without a Dockerfile (Node, Python, Go, static autodetect)

Live proof on the local VM: Dokploy v0.30.10 + Traefik, with a throwaway dashboard container `sy-a` on 127.0.0.1:3003.
Each repo is deployed by pasting its public URL into **New service** (Playwright drives the real UI). Then the app is curled through Traefik with its sslip.io Host header.

| | before: #52 head `5e66b3e` | after: `a068d9b` |
|---|---|---|
| heroku/nodejs-getting-started | deploy **error** | done · port 3000 · **200** |
| render-examples/flask-hello-world | error | done · port 8000 · **200** |
| heroku/go-getting-started | error | done · port 8080 · **200** |
| mdn/beginner-html-site-styled | error | done · port 80 · **200** |

The before error, from the Dokploy deployment log: `failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory`.

- `before.mp4` / `after.mp4`: the full UI runs.
- `before-result.txt` / `after-result.txt`: timings, Dokploy deployment status, the Traefik port label, the curl status and page title, and the Overview text.
- `screenshots/after-<repo>-overview.png`: Overview shows **Built with: Node / Python / Go / Static (nginx) (auto-detected)** and **Detected port**.
- `screenshots/after-live-build-logs-8s.png`: the Deploys tab log for a Redeploy of the Flask app, showing the generated Dockerfile steps (`pip install gunicorn`).
- `screenshots/before-<repo>-deploys.png`: the failed deploys.
- Repro: `runa.sh before|after`, then `BASE=http://127.0.0.1:3003 node a1demo.mjs <label> <outdir>` (demo-tools `lib.mjs`).
