# #46: bridge-mode quick deploys get a working public URL (Traefik)

PR: https://github.com/sbdeals/Switchyard/pull/46 · branch `codex/bridge-public-urls` · **stacked on #32** (base `claude/railway-dx-r1-r3`) · hardening track item: "Traefik public URLs"

**Stack:** live bridge-mode Dokploy (no Swarm/overlay) with `dokploy-traefik` on :80/:443 and the dashboard. Script: `bpu.mjs`. Steps:
1. New service → `nginx:alpine` → Enter.
2. Wait about 30s, then open Networking.
3. Inspect the new container's labels and open the URL.

The VM's public IP isn't reachable from inside the VM, so the browser maps `*.sslip.io` to `127.0.0.1`. That still goes through the real Traefik entrypoint `web` on :80.

- **before (#32 head, `1997341`):** the compose stack deploys and runs, but Networking says "No domains attached" and the container has **no `traefik.*` labels**, so there's no URL to open.
- **after:** an automatic `http://<app>-<rand>-<ip>.sslip.io` domain is saved before the first deploy. Dokploy injects the Traefik labels: `entrypoints=web`, the Host rule, `loadbalancer.server.port=80`, and `traefik.docker.network=dokploy-network`, while keeping the `dokploy-network` alias. `curl -H "Host: …" http://127.0.0.1/` returns **200**, and the browser shows the nginx welcome page (`after-4-public-url.png`).
- **port inference (`port-probe.txt`):** a local image with `EXPOSE 9090/tcp 8080/tcp 53/udp` gets port **8080**, and the probe answers through Traefik.

**Files:**
- `before.mp4`, `after.mp4`
- `*-1-menu/2-deployed/3-networking.png`, `after-4-public-url.png`
- `*-routing.txt` (labels + curl), `port-probe.txt`
- `vitest-output.txt` (80 tests)

**Not exercised live:**
- Networking edit/delete triggering a redeploy, and custom domains with Let's Encrypt (no public ingress here). These are covered by `bridge-domains.test.ts`.
- The `SWITCHYARD_HOST_IP`-unset path.
