# #51 purge-honesty (C-P1-2)

**PR:** https://github.com/sbdeals/Switchyard/pull/51

**What it shows:** `switchyard down --purge` runs against a fake `docker` on PATH (so no real Docker or root is needed) across 5 scenarios. All credentials are synthetic.

| Scenario | main (before.txt / before.cast) | branch (after.txt / after.cast) |
|---|---|---|
| postgres + metrics volumes stay in use | exit 0, "fresh slate", all creds wiped | exit 1, "Still present: volume dokploy-postgres / switchyard-metrics", all creds kept |
| only `dokploy` volume stuck | exit 0, creds wiped | exit 1, admin creds kept, store password cleared (its volume is really gone) |
| volume busy for 2 attempts, then free | exit 0 (survivor silently left) | exit 0 after retries, creds cleared |
| full removal | exit 0 | exit 0 |
| already absent (re-run) | exit 0 | exit 0 (idempotent) |

**Replay:** `asciinema play after.cast`, or re-run `bash purge-honesty-demo.sh <cli/dist>`.
