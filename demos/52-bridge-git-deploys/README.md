# #52 — Bridge mode: deploy a public Git repo (Dockerfile) as a managed compose stack

PR: https://github.com/sbdeals/Switchyard/pull/52 · branch `codex/bridge-git-deploys` (stacked on #46 `codex/bridge-public-urls`)

This ran on the live bridge stack (no Swarm overlay, kernel lacks VXLAN). Flow (`bgd.mjs`, Playwright): log in, **New service → Git repository URL** = `https://github.com/docker/welcome-to-docker`, Enter, wait for the build, open Deploys and Networking, then check `docker ps`, the Traefik labels, `curl -H Host:` through Traefik on :80, and a screenshot of the public URL.

| | Result |
|---|---|
| **before** (`switchyard-dash:bridge-public-urls`, #46) | A native Dokploy application is created; the image builds, but the deploy fails: `network dokploy-network cannot be used with services` (Swarm). No container, no URL. See `before.mp4`, `before-3-after-build.png`, `before-result.txt`. |
| **after** (`switchyard-dash:bridge-git-deploys`) | Managed compose stack, BuildKit Git context (`…/welcome-to-docker.git#main`). Container `welcome-to-docker-…-app-1` is Up, Traefik router on `*.sslip.io` → **port 3000** (detected from the image), `curl` → **200**, and the public URL renders the app. See `after.mp4`, `after-1..5-*.png`, `after-result.txt`. |


## Follow-up (07:47 EDT): first deploy gets the right port

Commit 5e66b3e fixes the residual issue where a new repo app started on port 3000 until its first Redeploy. Before/after demo: [first-deploy-port/](first-deploy-port/README.md).
