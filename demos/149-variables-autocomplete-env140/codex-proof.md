# Variables autocomplete on env140: local proof

Passed against the throwaway dashboard at `http://127.0.0.1:3080` on 2026-10-26.

Command: `BASE=http://127.0.0.1:3080 node /workspace/sy-codex-notes/fix/variables-autocomplete-env140-proof/proof.mjs` (exit 0).

`report.json` records 17 passing checks and cleanup. `flow.mp4` records the authenticated feature flow (43.6 seconds); login is excluded. The ten numbered PNGs capture the key stages.

Additional checks: `node --check /workspace/sy-codex-notes/fix/variables-autocomplete-env140-proof/proof.mjs` passed; `ffprobe -v error -show_entries format=duration,size -of json /workspace/sy-codex-notes/fix/variables-autocomplete-env140-proof/flow.mp4` reports 43.6 seconds and 2,466,352 bytes.

- Unique synthetic values from both created services are absent from authenticated HTML and RSC before opening Variables and after saving/reloading. Every serialized service has `env: null`, every serialized database has `databasePassword: null`, and sibling metadata includes only `SOURCE_KEY`.
- Opening Overview requests no environment. Variables loads only the current service; the loaded table/raw editors start clean.
- Typing `${{SOURCE_` offers the sibling key and Enter inserts the template. An unsaved local key is suggested and Tab inserts its template. No browser action loads sibling env, and validation responses never contain its value.
- Table/raw edits preserve comments and references. Details masks values; edits remain unsaved and do not deploy before clicking Deploy. The review screenshot captures the brief validation-in-progress state; the script waits until validation enables Deploy.
- One UI deployment saves all edits. A command through the dashboard's exec API checks the running throwaway container received the resolved sibling and local references and returns only `reference-flow-ok`.
- Reload restores editable reference templates with a clean baseline. Editing and reverting a saved value clears staging.
- Both compose resources and their project were deleted through dashboard API actions; fresh RSC confirms their names are absent. An additional read-only authenticated RSC GET at 12:04:28 UTC confirmed the entire `variables-autocomplete-env140-` prefix is absent, covering earlier attempts too (`cleanup-check.json`). Fixtures used public `alpine:3.20` with no ports or domains.

No repository files were changed by this proof. Setup used `applyStagedChangesAction` because individual env/file setters are not registered as standalone client actions; setup deployments are excluded from the single additional UI-deployment assertion.

Limitation: live interaction and runtime resolution were exercised with compose fixtures only. The global page-prop assertions include existing application/database entries, but this proof did not edit those resources.
