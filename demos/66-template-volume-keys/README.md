# 66 — template-volume-keys (PR #66, S-P2-23)

`rewrite-demo.cjs` runs the real `rewriteDataBindsToVolumes` from main (before) or the branch (after) on `template.yml`. That template has two Postgres services whose bind sources differ only by `_` vs `-`. The script then passes the output to `docker compose config`.

- **before.txt:** both services become `data-volumes-db-data`, which means a duplicate root key **and** two databases sharing one volume. Compose fails with `mapping key "data-volumes-db-data" already defined`.
- **after.txt:** `data-volumes-db-data` and `data-volumes-db-data-559c77`, and Compose reports `OK`. The first name is unchanged, so existing stacks keep their data.

Unit verifier: 15/15 cases, including byte-identical output for non-colliding templates.
