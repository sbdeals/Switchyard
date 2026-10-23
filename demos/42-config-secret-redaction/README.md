# #42: `switchyard config` redacts `storePassword`

PR: https://github.com/sbdeals/Switchyard/pull/42 · branch `codex/config-secret-redaction` · finding C-P2-1

The real built CLIs (`dist/cli.js`) ran against throwaway configs via `SWITCHYARD_CONFIG=/tmp/sy-demo-<label>.json`, with `--no-restart` so nothing converges. The "before" build is the same tree with `origin/main`'s two config sources. The output is filtered to the `#`, `Password`, and `Skipped` lines; all other keys are unchanged.

- **before (main):** `config set storePassword …` echoes `storePassword = St0re-demo-pass`, and `config list` prints it in clear text. `adminPassword` is redacted.
- **after:** both print `********  (use --show-secrets)`, and `--show-secrets` still reveals them.

**Files:** `before.txt` and `after.txt`.
`cli/test/config-redaction.test.mjs` has 13 tests. The full `npm test` passes (50/50) when run by the lead outside the Codex sandbox.

Lead note: a first attempt without `--no-restart` made the CLI converge and recreate the local `switchyard` dashboard container. I restored it with `stack/run-dash.sh` right away. That is expected `config set` behaviour, not part of this fix.
