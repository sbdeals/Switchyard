# #56: release only moves `latest` for the newest stable (CI-P2-1)

This is a non-UI change, so the proof is a terminal before/after.
- `before-terminal.txt`: on `origin/main`, every tag push gets `type=raw,value=latest` plus `make_latest=true`, and there is no concurrency group.
- `after-terminal.txt`: the output of `proof.sh`, run offline on `codex/release-latest-guard` @ `7faa4f8`. It contains:
  - 19/19 helper tests
  - an 8-row before/after decision table (older/delayed and rc tags no longer move `latest`)
  - the CLI true/false results, with invalid history exiting 1
  - YAML assertions on both workflows (concurrency groups, `flavor: latest=false`, gated promote and `make_latest`, CI job)

Not run against live GitHub: no tag was pushed.
