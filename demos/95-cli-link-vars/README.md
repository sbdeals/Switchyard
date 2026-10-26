# #95 switchyard link + variables, with .env excluded from deploy

- `before.txt`: CLI help on #89 (1c959e9). There is no `link` or `variables` command, and `deploy` uploads `.env`.
- `after.txt`: CLI help on this branch, showing `link` and `variables` and `deploy --include-env`.
- `after-proof.txt`: Codex's live transcript against the local Dokploy (:3000) with a throwaway `clv-*` project, since removed. It covers link, masked/revealed list, set/unset, and deploy, plus a ZIP listing showing `.env` excluded and `.env.example` kept.

Local test stack only.
