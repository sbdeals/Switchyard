# C1 · automatic port fix-up redeploys the image it built (follow-up to #53)

- **Stack:** local Dokploy v0.30.10 (bridge) on this VM; throwaway dashboard container `sy-c1` on 127.0.0.1:3002 with `BRIDGE_REPO_PORT_POLL_MS=60000` so there's a window to push a new commit before the watcher fires. Repo = local dumb-HTTP Git on :8765 (`c1-pin.git`, nginx Dockerfile that prints FIRST/SECOND).
- **Before** = #53 head `e99e763` (image `switchyard-dash:c1-before`). **After** = this PR `8f3b751` (`switchyard-dash:c1-after`). Same script for both: [c1pin.mjs](c1pin.mjs) (setup: [runc1.sh](runc1.sh)).
- Script: New service → repo URL (head = FIRST) → first deploy done → **push SECOND** → wait for the watcher's "Automatic port fix-up" deploy → curl the public URL.

| | Before (#53) | After (this PR) |
|---|---|---|
| Fix-up deploy | rebuilds from branch head | redeploys a temporary tag of the first build's image ID |
| Public URL after fix-up | **SECOND** (a commit nobody deployed) | **FIRST** (the release that was deployed) |
| Container image | 5029fee… ≠ first build 7c1f540… | 5bf8e35… = first build 5bf8e35… |
| Port label | server.port=80 | server.port=80 |

- Files: [before-result.txt](before-result.txt), [after-result.txt](after-result.txt), [before.mp4](before.mp4), [after.mp4](after.mp4), [before-deploys.png](before-deploys.png), [after-deploys.png](after-deploys.png).
- Note on "compose file now has build: 0 line(s)" in after-result.txt: that line greps the **on-disk** compose Dokploy wrote for the fix-up deploy (pinned image, no build). Checked at 01:10 EDT: Dokploy's stored composeFile was restored to the build compose (`build: context: …c1-pin.git#main`, `image: …-app:latest`), so the next Redeploy builds the branch head as normal. The temporary `sy-…` tag was pruned afterwards; the running container keeps its image ID.
