# #52 addendum — auto-URL port for uncached images (commit de1eeec)

**Bug (found live while recording #55):** `ensureBridgeAutoDomain` resolved the app port *before* the
deploy, from local image metadata only. Any image not already pulled fell back to port 3000, so a
one-click deploy of e.g. `traefik/whoami` got `loadbalancer.server.port=3000` → Traefik **502**.

**Fix:** pull missing public images (ref-validated, 120 s bounded) before resolving the port; for repo
builds (image only exists after build) reconcile an *untouched* auto-domain on the next deploy.
Explicit Networking edits opt out of reconciliation.

Terminal before/after, live stack, two different never-pulled images each exposing `80/tcp`:

| | image | label | curl |
|---|---|---|---|
| [before](before-result.txt) (fa8baf0) | nginxdemos/hello | port=3000 | **502** |
| [after](after-result.txt) (de1eeec) | kennethreitz/httpbin | port=80 | **200** |

Screenshots: `before-drawer.png`, `after-drawer.png`. QC: tsc, lint, vitest 218/218.
Caveat: repo (Dockerfile) apps whose port differs from the guess still need one Redeploy to correct the URL
(Dokploy has no deploy-completion hook).
