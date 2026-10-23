# PR #55: onboarding, "Deploy your first service"

Live on the bridge stack, logged in as a fresh Dokploy **member** (`onboarding-demo@switchyard.local`, created via `demo-tools/mk-member.mjs`) who can create projects/services but has no existing projects, so the dashboard shows its real first-run empty state.

## Before (`switchyard-dash:bridge-git-deploys`): `before.mp4`, `before-1-empty.png`, `before-2-menu.png`, `before-result.txt`
- The heading is "No services yet", with one generic **New service** menu: no samples and no host-specific guidance.

## After (`switchyard-dash:onboarding`): `after.mp4`, `after-1..4-*.png`, `after-result.txt`
- The heading is **Deploy your first service**, with three cards: Git repository, Docker image and Database.
- The Git card's bridge hint reads: "Public repos with a Dockerfile. GitHub App / private repos need Swarm."
- The Git card opens a focused dialog with repo URL + branch (`after-2-git-flow.png`).
- **Try a sample** buttons for `welcome-to-docker` and `traefik/whoami` are keyboard reachable (`after-3-sample-focused.png`: focus, then Enter).
- The whoami sample deploys and opens its drawer with the public URL. The new **copy** button copies it; the clipboard read-back matched.

## Caveat found by this demo (fixed separately)
The first run's `curl` on the whoami URL returned **502**. The bridge auto-URL in #52 picks the port before the image is pulled, so for an uncached image it fell back to 3000 (whoami listens on 80). That's a #52 bug, not an onboarding bug; the fix commit on #52 is noted in PROGRESS.md.
