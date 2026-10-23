# #38 — URI-encode database connection strings

PR: https://github.com/sbdeals/Switchyard/pull/38 · branch `codex/encode-database-uris` @ 48ddb9a · finding S-P2-21

**Setup:** a live `postgres:16` container `pgdemo` (network `pgdemo-net`) with user `app`, db `appdb` and password **`p@ss:w/rd#1`**. `url.cjs` transpiles the *real* `connection.ts` (from `main/`, i.e. origin/main, or from the branch) and prints the string the dashboard shows and copies. `run.sh` then runs `psql "<that url>"` from a postgres:16 container.

| | connection string | psql |
|---|---|---|
| before | `postgresql://app:p@ss:w/rd#1@pgdemo:5432/appdb` | `invalid integer value "w" for connection option "port"` |
| after | `postgresql://app:p%40ss%3Aw%2Frd%231@pgdemo:5432/appdb` | connected: `app` / `appdb` |

**Files:**
- `demo.cast`: asciinema recording
- `before-after.txt`: transcript
- `url.cjs`, `run.sh`: the scripts
