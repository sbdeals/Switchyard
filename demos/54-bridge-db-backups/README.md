# PR #54: bridge database backups (back up / download / restore)

Live run on the bridge stack: one-click PostgreSQL through the dashboard (Playwright), with data written and checked through `psql` inside the DB container.

## Before (`switchyard-dash:bridge-git-deploys`): `before.mp4`, `before-1-db-drawer.png`, `before-result.txt`
- The bridge Postgres drawer tabs are Overview, Data, Variables, Networking, Deploys, Compose, Volumes, Metrics, Logs, Console and Settings.
- There is **no Backups tab**, and Dokploy's native backups don't cover compose stacks.

## After (`switchyard-dash:bridge-db-backups`, run with `-v sy-demo-backups:/app/data`): `after.mp4`, `after-*.png`, `after-result.txt`
1. Write the row `v1-precious`, then click **Back up now**. This creates `/app/data/backups/<app>/<ISO>.dump` with mode `-rw-------`.
2. Simulate an accident: replace the row with `v2-oops`.
3. Click **Restore** and confirm. `psql` shows `v1-precious` again.
4. **Download** delivers a 1314-byte file that starts with `PGDMP` (a valid pg_dump custom archive).

Backup filenames are UTC (10:02Z = 06:02 ET).
