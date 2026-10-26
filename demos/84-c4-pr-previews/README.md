# C4: opt-in GitHub PR previews on the signed deploy hook

Branch `codex/bridge-pr-previews` (base `codex/bridge-deploy-on-push`, #70). Local test stack only: dashboard image on
:3005, local Dokploy :3000, and the throwaway app `nodejs-getting-started-u7cf`.

| File | Shows |
|---|---|
| before.mp4 / before-1-settings.png / before.txt | #70: no PR preview controls; a signed `pull_request` → `200 ignored event` |
| after.mp4 / after-1-settings.png / after-2-preview-listed.png / after-4-after-close.png / after.txt | Settings > Deploy on push > **PR previews** (+ fork opt-in). Bad signature → 403. Signed `opened` → 202 and exactly one Dokploy compose owned by marker `switchyard-preview:<parent>:<uuid>`. Same action+SHA → 200 duplicate. Preview listed with its URL. Signed `closed` → 202, so the compose is deleted and the list is empty. Dokploy API keys go **0 → 1** (enable) → **0** (disable) |
| after-preview-build.log | the preview build in my run **failed**, and this log is the evidence. The parent was created by #63 auto-detect (`buildKind: node`, `dockerfile_inline`), but this branch predates #63, so the preview used a plain Dockerfile build and that repo has none. That's a stacking gap (see caveats) |
| codex-proof-transcript.txt | Codex's local proof with `docker/welcome-to-docker` (which has a Dockerfile) on :3007, using a throwaway owner, org and project: opened → build OK → **HTTP 200**; synchronize → same service, rebuilt pinned SHA → 200; closed → 0 containers, 0 volumes, URL unreachable; reopen + close mid-build → async cleanup with no late container; everything cleaned up |
| after-vitest.txt | 67 preview tests (full suite 552/552) |
