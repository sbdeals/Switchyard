# macOS verification checklist

On macOS the CLI and the desktop app run the **same Docker Desktop code path
as Windows Path B** ([`cli/src/platform/docker-desktop.ts`](../cli/src/platform/docker-desktop.ts)),
which was hand-tested end-to-end on a real Windows 11 machine — see
[getting-started.md](getting-started.md#path-b-windows-11-with-docker-desktop).
macOS has **not** been verified end-to-end. This is the procedure for doing
that on a real Apple silicon Mac, including the specific assumptions that were
proven on Windows but are only *presumed* to hold on macOS.

**Last verified:** _never — replace this line with the date, macOS version,
and hardware (e.g. "2026-XX-XX, macOS 15.x, M2 MacBook Air") after a real
end-to-end run._

## What's assumed but unverified on macOS

These three things are the point of the run — each was confirmed on Docker
Desktop's WSL2 backend, and macOS uses a different VM (LinuxKit) whose kernel
and port-forwarding plumbing could differ:

1. **Swarm VIP routing without `dnsrr`.** The Linux path forces
   `--endpoint-mode dnsrr` because kernels without IPVS make service VIPs
   hang. On Docker Desktop we deliberately use default VIP mode, on the
   assumption that the VM kernel ships IPVS. Verified for WSL2; assumed for
   the LinuxKit VM on macOS.
2. **The `/etc/dokploy` pre-create trick inside the VM.** Swarm rejects tasks
   whose bind source is missing, so `ensureEtcDokploy` creates `/etc/dokploy`
   inside the VM with a throwaway `alpine` container (`-v` auto-creates the
   path). Verified on WSL2; assumed to work the same on the macOS VM.
3. **Ingress-mode port publishing reaching `localhost`.** Dokploy publishes
   in ingress mode (host-mode ports don't reliably forward to Windows
   `localhost`). Ingress publishing must be forwarded by Docker Desktop's VM
   to the Mac's `localhost`/`127.0.0.1`.

Targeted checks for each are in
[step 4](#4-check-the-three-unverified-assumptions) below.

## Prerequisites

- A real Apple silicon Mac (M1 or later) with an admin account.
- macOS 14 (Sonoma) or 15 (Sequoia) — note which one in the date stamp.
- Node.js 20+ and `npm` (for the CLI route and the smoke test).
- Internet access (image pulls, installer downloads).
- No existing Dokploy/Switchyard install — or run `switchyard down --purge`
  first so you're testing a fresh converge.

## 1. Route A: the CLI

1. Install Docker Desktop for Mac (Apple silicon build) and start it. Wait
   until the whale icon reports "Docker Desktop is running".
2. Run:

   ```bash
   npx switchyard-cli up
   ```

3. Watch the converge — you should see, in order: Swarm init, the
   `dokploy-network` overlay network, the two secrets, "Preparing
   /etc/dokploy inside the Docker Desktop VM ...", the three `dokploy*`
   services plus `switchyard-metrics`, then convergence (first image pulls
   take a while).
4. Enter the admin email and password when prompted in the terminal.
5. On success the CLI prints where everything lives: Dokploy on
   **http://localhost:3000** (default) and the dashboard on
   **http://127.0.0.1:3001**.
6. Open http://127.0.0.1:3001 — you're redirected to `/login`; sign in with
   the admin credentials and confirm the workspace canvas loads.
7. Re-run `npx switchyard-cli up` — it must be a no-op (idempotency; the
   dashboard container's config-hash fingerprint should report unchanged).

## 2. Route B: the desktop app

Test this on a machine (or after a `switchyard down --purge` plus removing
Docker Desktop) where Docker is **not** yet installed, so the wizard path gets
exercised.

1. Download the macOS DMG (arm64) from the GitHub release and drag
   Switchyard.app into Applications.
2. **Gatekeeper:** builds are unsigned, so the first launch is blocked.
   - macOS 15 (Sequoia): the dialog offers no bypass. Go to **System
     Settings → Privacy & Security**, scroll to the blocked-app notice, click
     **Open Anyway**, then launch again and confirm.
   - macOS 14 and earlier: right-click the app → **Open** → **Open**.
3. First-run wizard: with Docker Desktop missing, the app should offer to
   install it — it downloads the official `Docker.dmg` and tries a silent
   attach-and-copy into `/Applications`; if that fails it opens the DMG in
   Finder for a manual drag. **Record which of the two paths happened.**
4. Docker Desktop's own first launch needs its license acceptance and
   privileged-helper approval — complete those when macOS/Docker prompt.
5. The app then waits for the engine, converges the stack (same steps as the
   CLI, with generated admin credentials), and **auto-logs in**: the window
   must open straight into the workspace at 127.0.0.1 — no `/login` page.
   (Auto-login mints the session cookie in
   [`desktop/src/main/autologin.ts`](../desktop/src/main/autologin.ts).)
6. Spot-check the tray menu: open dashboard, open Dokploy, restart stack.

## 3. Smoke test (contributor route)

With Docker Desktop running and the repo cloned:

```bash
cd desktop
npm install
npm run smoke     # exit 0 = converge + auto-login proof passed
```

Also confirm the fail-fast: quit Docker Desktop and re-run `npm run smoke` —
it must exit nonzero immediately with "Docker engine not reachable — start
Docker Desktop and re-run", not fail partway through the Electron run.

## 4. Check the three unverified assumptions

Run these after either route has converged.

### 4a. Swarm VIP routing (IPVS in the LinuxKit VM kernel)

Symptom of missing IPVS: service names *resolve* but connections *hang* — see
[troubleshooting](troubleshooting.md#service-names-resolve-but-connections-hang-no-ipvs).

```bash
# Behavioral check (authoritative): reach a service by name over the VIP.
# Must answer promptly — a multi-second hang then timeout means no IPVS.
docker run --rm --network dokploy-network postgres:16 pg_isready -h dokploy-postgres

# Kernel check (informative): inspect the VM kernel's IPVS config, if exposed.
docker run --rm --privileged alpine sh -c 'zcat /proc/config.gz | grep IP_VS' || true
```

`pg_isready` should print `dokploy-postgres:5432 - accepting connections`
within a couple of seconds, and Dokploy's own logs
(`docker service logs dokploy`) should show it reached Postgres (migrations
ran, no connection-timeout loops). If VIP routing hangs, that's a finding:
the macOS provisioner needs `--endpoint-mode dnsrr` like Linux — file it
against `cli/src/platform/docker-desktop.ts`.

### 4b. The `/etc/dokploy` pre-create inside the VM

```bash
# The directory must exist inside the VM after `up`:
docker run --rm -v /etc/dokploy:/mnt alpine ls -la /mnt

# And no dokploy task may have been rejected over the bind mount:
docker service ps dokploy --no-trunc
```

No task should show *Rejected* with
`invalid mount config for type "bind": bind source path does not exist`.
Dokploy also writes its Traefik config there — a non-empty listing after a
few minutes of uptime is a stronger pass than an empty directory.

### 4c. Ingress-mode publishing reaches localhost

```bash
curl -sI http://localhost:3000 | head -1
curl -sI http://127.0.0.1:3000 | head -1
```

Both must return an HTTP response from Dokploy (a redirect to `/register` or
`/login` counts), not a connection refusal or hang. If you changed
`dokployPort`, substitute it.

## 5. Verification checklist (adapted from getting-started.md)

Work through these in order; each has a [troubleshooting](troubleshooting.md)
entry if it fails.

1. **Services converged.** `docker service ls` shows `dokploy`,
   `dokploy-postgres`, `dokploy-redis`, and `switchyard-metrics` at `1/1`.
2. **Dokploy answers.** Open http://localhost:3000 (or the `dokployPort` in
   your config): you get the Dokploy login (or `/register` on a manual first
   run) and can sign in as the admin.
3. **Switchyard loads.** Open http://127.0.0.1:3001: after signing in at
   `/login` (skipped by the desktop app's auto-login) you see the workspace
   canvas — *not* a red "Couldn't reach Dokploy" card.
4. **End to end.** Create a database from Switchyard: it appears on the
   canvas, reaches a running state, and its Logs and Metrics tabs stream live
   data. Unlike Windows, no `DOCKER_SOCKET` override is needed — macOS has
   `/var/run/docker.sock`, the default.
5. **Config landed.** `cat ~/Library/Application\ Support/switchyard/config.json`
   exists, holds the admin credentials and ports, and has `0600` permissions
   (`ls -l` shows `-rw-------`).

## After the run

- Fill in the **Last verified** line at the top of this file.
- Anything that failed: add a [troubleshooting.md](troubleshooting.md) entry
  and file the fix against `cli/src/platform/docker-desktop.ts` (both the CLI
  and the desktop app inherit it).
