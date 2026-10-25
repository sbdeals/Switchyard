# 67 — ci-pinning (PR #67, CI-P2-2)

`audit.sh <label> <checkout>` runs a read-only supply-chain audit of `.github/workflows`. **Watch:** `before.txt` (main 1fc46d5), then `after.txt` (branch).

| | main | branch |
|---|---|---|
| action refs pinned to SHA | 0 / 27 | 27 / 27 |
| `curl … \| sudo bash` | 1 (e2e-domain) | 0, release asset + `sha256sum --check` |
| unversioned `Install-Module` | 1 | 0 (TrustedSigning 0.5.8) |
| top-level permissions | ci/e2e: default token; release: `packages: write` + `id-token: write` workflow-wide | `contents: read` everywhere; writes granted per job |

The lead checked every pinned SHA independently with `git ls-remote` (9/9 match). The installer SHA was recomputed from the v0.30.10 release asset. The workflows were not executed.
