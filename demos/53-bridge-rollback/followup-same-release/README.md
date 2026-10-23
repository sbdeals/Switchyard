# #53 Round Q: the automatic port fix-up deploy is the same release (commit e99e763)

**Question (from #52 follow-up 5e66b3e):** in path (b), a new local or non-GitHub repo app gets one automatic follow-up `compose.deploy` from the post-build watcher once the built image's real port is known. Should that follow-up add a rollback-history entry?

**Decision: no. It is the same release, so it is labelled, not recorded.**
- The follow-up only re-applies the detected port to the public URL for the code that was just deployed.
- Recording it would snapshot the first build with the **wrong port**. That would put a duplicate "previous deploy" in Rollback, and picking it would bring the 502 back.
- History entries stay one per explicit deploy or redeploy, as on main.

**Change:** commit [e99e763](https://github.com/sbdeals/Switchyard/commit/e99e763) on `codex/bridge-rollback`. It sits on merge 598c2dc, which brings 5e66b3e from #52 into #53. No history was rewritten.
- The watcher's follow-up now passes a Dokploy deploy `title` of **"Automatic port fix-up"** and a description saying it is the same release and records no rollback entry. It still never snapshots.
- The Overview → Previous deploys "Current" row keeps the timestamp of the release itself, not the fix-up's. It adds the note **"Includes an automatic port fix-up (same release)."**
- Tests:
  - For ports 80 and 8080: the fix-up records 0 history entries and takes no snapshot.
  - The next explicit redeploy records exactly 1 entry.
  - 7 unit tests cover `repoReleaseTiming`.

**Live run** (image `switchyard-dash:integration-roundq` = local integration 202f5c6 = 3e52166 + e99e763; fresh app via New service → `http://127.0.0.1:8765/repo-port.git`, nginx EXPOSE 80, no manual Redeploy):

| Step | Evidence |
|---|---|
| **before** (integration-52port) | [before-result.txt](before-result.txt): live-proof app `repo-port-mdj6` shows 2 Dokploy deployments, both "Manual deployment", so the follow-up can't be told apart from a user deploy. |
| **after: first deploy** | [after.mp4](after.mp4) and [after-result.txt](after-result.txt): 502 on port 3000 at t+2s, then **200 on port 80 at t+10s**. Deployments: "Manual deployment" at 08:21:49 EDT, then **"Automatic port fix-up"** at 08:21:55 EDT. **0 history entries, 0 snapshot images.** |
| **after: Overview** | [after-1-overview-previous-deploys.png](after-1-overview-previous-deploys.png): the Current row shows 8:21:49 (the release time) plus "Includes an automatic port fix-up (same release)." |
| **after: Deploys** | [after-2-deploys.png](after-2-deploys.png): "Automatic port fix-up" sits above "Manual deployment". |
| **explicit redeploy** | [redeploy.mp4](redeploy.mp4), [redeploy-result.txt](redeploy-result.txt) and [redeploy-1-overview-history.png](redeploy-1-overview-history.png). The script clicked Redeploy twice (no confirm dialog), giving 4 deployments: first + fix-up + 2 explicit. That produced **2 history entries, one per explicit redeploy**, with none for the fix-up. |

- **Tests:** [vitest-focused.txt](vitest-focused.txt).
- **QC on codex/bridge-rollback:** lint 0, tsc 0, vitest 12 files / 401 passed.
- **QC on local integration 202f5c6:** lint 0, tsc 0, vitest 19 files / 543 passed.
- **Recorders:** [rq.mjs](rq.mjs) and [rqr.mjs](rqr.mjs).
- **Cleanup:** the throwaway app `repo-port-wu4m-4vzaqw` was deleted with `compose.delete` (deleteVolumes), and its 3 images were removed.

**Residual / caveats**
- The follow-up still runs a normal `compose.deploy`, which rebuilds from the **branch head**. If a commit is pushed during the watcher window (up to 15 min after the first deploy), the fix-up could build newer code than the first deploy. The label would then overstate "same release". The cache makes this a no-op rebuild in the common case.
  - Proper fix (next step): re-apply only the Traefik label / `up -d` without `--build`, or pin the first build's image for the follow-up.
- History timestamps are the time each snapshot was taken (just before the next deploy), not the original release time. This is #53's existing behaviour and is unchanged.
