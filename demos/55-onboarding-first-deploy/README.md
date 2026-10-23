# PR #55: onboarding, "Deploy your first service"

Live on the bridge stack, logged in as a fresh Dokploy **member** (`onboarding-demo@switchyard.local`, created via `demo-tools/mk-member.mjs`) who can create projects/services but has no existing projects, so the dashboard shows its real first-run empty state.

## Before (`switchyard-dash:bridge-git-deploys`): `before.mp4`, `before-1-empty.png`, `before-2-menu.png`, `before-result.txt`
- The heading is "No services yet", with one generic **New service** menu: no samples and no host-specific guidance.

## After v1 (`switchyard-dash:onboarding`, recorded before the #52 port fix; kept as the 502 "before"): `after.mp4`, `after-1..4-*.png`, `after-result.txt`
- The heading is **Deploy your first service**, with three cards: Git repository, Docker image and Database.
- The Git card's bridge hint reads: "Public repos with a Dockerfile. GitHub App / private repos need Swarm."
- The Git card opens a focused dialog with repo URL + branch (`after-2-git-flow.png`).
- **Try a sample** buttons for `welcome-to-docker` and `traefik/whoami` are keyboard reachable (`after-3-sample-focused.png`: focus, then Enter).
- The whoami sample deploys and opens its drawer with the public URL. The new **copy** button copies it; the clipboard read-back matched.

## Caveat found by v1 (fixed by de1eeec on #52; see the re-record below)
The first run's `curl` on the whoami URL returned **502**. The bridge auto-URL in #52 picks the port before the image is pulled, so for an uncached image it fell back to 3000 (whoami listens on 80). That's a #52 bug, not an onboarding bug; the fix commit on #52 is noted in PROGRESS.md.

## After, re-recorded on the fixed build (07:24 EDT): `after-fixed.mp4`, `after-fixed-1..5-*.png`, `after-fixed-result.txt`
- Build: the live integration image `switchyard-dash:integration-52fix-53-54-55`, which includes #52's port fix de1eeec, #55, #53 and #54.
- `traefik/whoami` was **deleted from the host image cache first**, so this exercises the uncached path that 502'd in v1.
- It runs the same flow as v1, using the same member and empty workspace: Git dialog → sample focused by keyboard → Enter → drawer with public URL → copy.
- The public URL answered **200 on the first curl** (t+0s after the drawer opened). There was no Redeploy, and the container label is `loadbalancer.server.port=80`.
- Recorder: `ob2.mjs`. It's `ob.mjs` plus polling the URL until 200 (max 120s) and printing the Traefik port label of the serving container.
