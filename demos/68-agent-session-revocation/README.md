# #68: re-validate the Dokploy session on agent routes (S-P1-2, pending Eli)

Terminal before/after against the local Dokploy v0.30.10. Throwaway dashboard container `sy-b2` on 127.0.0.1:3005.
The script signs in the throwaway **member** `b1-member@switchyard.local` in a browser and calls the agent routes. It then revokes that member's Dokploy sessions server-side by deleting only their `session` rows in Dokploy's DB (admin sessions are untouched), and calls the routes again.

| after the revocation | before (`82b6d0b`, #60) | after (`0314301`) |
|---|---|---|
| config / models / changes | 200 | **401** |
| chat | 503 "not configured" (past auth) | **401** |
| session cookie | kept | **cleared** |
| navigate to / | ERR_TOO_MANY_REDIRECTS (pre-existing loop) | **/login** |

- `before.txt` / `after.txt`: the raw output.
- Repro: `runb2.sh b1-after|b2-after`, then `BASE=http://127.0.0.1:3005 LABEL=… node b2demo.mjs` (demo-tools; needs `.onboard-pass`).
