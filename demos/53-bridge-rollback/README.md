# PR #53: bridge rollback / redeploy-previous

Live run on the bridge stack (Dokploy + Traefik on this box), captured with Playwright via the Switchyard dashboard.

## Before (`switchyard-dash:bridge-git-deploys`): `before.mp4`, `before-*.png`, `before-result.txt`
- An image app deployed as nginx:1.27-alpine, then changed to 1.28 in the Compose tab and saved/deployed.
- The Overview has **0** "Roll back" buttons, and the old ref is gone from the compose file, so the dashboard can't go back.

## After (`switchyard-dash:bridge-rollback`): `after.mp4`, `after-*.png`, `after-result.txt`
- Same flow. The Overview now shows **Previous deploys** (1.28 Current, 1.27 with Roll back).
- Clicking Roll back and confirming redeploys `nginx:1.27-alpine`. `docker ps` confirms it.

## After, Git repo app: `repo-after.mp4`, `repo-*.png`, `repo-result.txt`
- Redeploying `welcome-to-docker` first snapshots the running image as `<app>-app:sy-<ms>`. The snapshot's image ID equals the pre-redeploy running ID.
- Roll back runs that snapshot. The compose has **no `build:`**, sets `pull_policy: never` and records `pinnedTag`.
- The lifecycle button changes to **"Redeploy latest from main"**, which unpins on click. The public URL returns 200.
- Note: the branch head didn't change during the demo, so old and new image IDs are identical. That doesn't affect the mechanism shown: the tag is pinned and nothing is rebuilt.
