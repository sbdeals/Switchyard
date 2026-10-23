# #40: Data tab read-only mode enforced by PostgreSQL

PR: https://github.com/sbdeals/Switchyard/pull/40 · branch `codex/postgres-readonly` @ 9e048c7 · finding S-P1-4

**Stack:** live bridge-mode Dokploy and the Switchyard dashboard.
- Postgres service `db` was created through the Dokploy API (`postgres.create`, appName `db-demo-bzmvfm`).
- Its container (`postgres:16`, named like a swarm task `db-demo-bzmvfm.1.localdemo`) was started by hand, because the native swarm deploy can't run on bridge.
- It was seeded with `todos` (3 rows).

Script: `demo-tools/pgro.mjs`. Steps: db → Data → SQL, with **Allow writes OFF**, then run `SELECT * INTO todos_backup FROM todos;`, then list the public tables.

- **before (main):** returns `SELECT 3`. The table list shows `todos` **and `todos_backup`**, so a table was created while writes were disabled.
- **after:** returns `ERROR: cannot execute SELECT INTO in a read-only transaction`, and the table list shows only `todos`.

**Files:**
- `before.mp4` and `after.mp4`
- `*-select-into.png` and `*-tables.png`
- `*-panel.txt`: the captured result panels
- `harness-output.txt`: the unit harness (11 groups, real TS modules with a fake Docker transport) and the live harness against a real postgres:16. The live harness covers SELECT/SHOW running read-only, SELECT INTO and nextval rejected, hidden batches and psql meta-commands neutralised, CSV/NULL handling intact, and explicit write mode still working.

The harness scripts are in the notes dir: `fix/verify-postgres-readonly.cjs` and `fix/verify-postgres-readonly-live.cjs`.
