# #64: never show S3 secrets in backup errors (E2E-023)
PR: https://github.com/sbdeals/Switchyard/pull/64 · branch `codex/s3-error-redaction` · recorded 01:29–01:30 EDT Oct 25

This is a live run on the local stack. Before used `switchyard-dash:main-1fc46d5` and after used `switchyard-dash:s3-after`; each ran as the throwaway container `sy-s3` on :3002 (`runsy.sh`) against the local Dokploy. It used a throwaway Postgres (`postgres-d4rm`) → Backups → Add destination, with **synthetic** keys only (`SYNTHETIC-AK-e2e023` / `SYNTHETIC-SECRET-do-not-show-e2e023`). Script: `s3demo.mjs`.

| case | before | after |
|---|---|---|
| endpoint `not-a-url` → Test | raw rclone argv incl. `--s3-secret-access-key=SYNTHETIC-SECRET-…` | "Enter a full HTTP(S) endpoint URL without credentials…" |
| endpoint `http://127.0.0.1:9` → Test | same leak, cut at 300 chars before the actual cause | "Couldn't reach the S3 endpoint…" + **Show details** with `********` keys and the real `connection refused` |
| secret visible on page | **true** | **false** |

Watch: `before.mp4`, `after.mp4`. Screenshots: `before-case2.png` (leak), `after-case2.png` (redacted details).
