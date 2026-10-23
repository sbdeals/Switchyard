# #57: launcher data volume + legacy agent-key migration (C-P2-5)

PR: https://github.com/sbdeals/Switchyard/pull/57. Non-UI change, so the proof is a terminal before/after. Captured 07:10 EDT, 2026-10-23.

Fixture: a disposable `docker:27-dind` daemon (never the host daemon). The fixture images `localhost/switchyard-cp25-live:before` and `:after` are built from the dashboard image.

- **before-terminal.txt / before.sh**: main CLI (origin/main 1fc46d5). The container only gets the socket mount. A saved agent key is **lost** after `switchyard config set imageTag after` recreates the container.
- **after-terminal.txt / live-check.sh**: this branch, 6 steps, **ALL STEPS PASSED**:
  1. Fresh up.
  2. A forced migration failure keeps the data and restarts the old container.
  3. Legacy settings migrate byte-for-byte with mode 0600.
  4. Unchanged config is idempotent; settings and backup files survive replacement.
  5. Plain `down` keeps the data; `down --purge` removes `switchyard-data`, and a repeat purge is a no-op.
  6. Purge while the volume is in use fails explicitly and keeps the config; it succeeds after release.

The live check caught two real bugs, both fixed in the PR:
- a missing `}` in the inspect template;
- Docker 27's `volume … not found` wording, which made purge falsely fail.

Caveats:
- Fixture-only quirks of nested dind: `dokploy-network` is a bridge, and the health-check wait is about 2–3 min.
- The Linux-platform purge path is covered by unit tests only.

Tests: CLI `npm test` 60/60, `tsc --noEmit` clean.
