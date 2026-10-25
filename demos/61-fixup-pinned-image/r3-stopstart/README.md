# #61 round 3: Stop/Start after the fix-up (commit 6b6d5d6)

**Bug found in the round-2 live proof.** The fix-up restored Dokploy's DB compose and pruned the temporary tag. But the on-disk compose, which Dokploy's Stop/Start reads, still referenced that tag. Stop → Start then failed with "No such image" and the app went to 404.

**Fix.** The fix-up tag is now `<app>-app:sy-<ts>-portfix`. It is kept after the fix-up and pruned only after a later explicit deploy or rollback finishes. Running images and history references are excluded from pruning.

Live run: dashboard container `sy-c1r3` on 127.0.0.1:3004, local dumb-HTTP git repo, everything driven through the UI.
- `fixup.mp4`: deploy FIRST, push SECOND before the watcher runs, then the fix-up serves **FIRST** from the same image `cd6151d29dd4` (`…-portfix`).
- `r3-stopstart-redeploy.mp4`: Stop → 0 containers. Start → **FIRST [200]** from the `-portfix` image. Explicit Redeploy → **SECOND [200]** with 1 history entry, and the `-portfix` tag is pruned.
- `result.txt`: the full transcript. `try1/` isn't included; that run double-clicked Redeploy because of a demo-script bug.
