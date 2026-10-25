# 65 — store-retry (PR #65, S-P2-1)

Metrics persistence used to switch off for good the first time a write failed transiently, for example while Postgres was still booting.

**How to watch:** read `before.txt`, then `after.txt` (about 45 s of real time each).

- `run-live.sh` starts a throwaway `postgres:16` called `sy-store-demo-pg` on 127.0.0.1:55432 with the synthetic password `demo-throwaway`. The container starts **3 s after** the first store write and is removed when the run ends.
- `live-store.cjs` transpiles the real `dashboard/src/lib/metrics/store.ts` from main (before) or the branch (after) and drives it with real `pg`.

| | main | branch |
|---|---|---|
| first write (DB down) | `disabled after error: ECONNREFUSED` | `backing off 5s` |
| DB comes up at t+3s | still disabled | `[store] recovered` at t+5s |
| rows at t+45s | 0 ("needs dashboard restart") | 3, and still persisting |

Unit verifier (fake Pool + clock): 12/12 groups pass. Permanent errors (auth, missing DB, permissions, bad URL) still latch disabled.
