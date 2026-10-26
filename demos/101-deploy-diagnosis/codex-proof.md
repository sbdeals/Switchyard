# Deployment diagnosis local proof

Dashboard: `http://127.0.0.1:3033`. Dokploy API: `http://127.0.0.1:3000`.
Captured 2026-10-26. All fixtures were created in this session in the throwaway
`deploy-diagnosis-proof-1793002852428` project, then deleted through the Dokploy API.
The project's default environment was named `production`; it was only the local
VM test stack. No external deployment or paid API was accessed.

| Throwaway service | Actual deployment failure | Diagnosis rule | Result |
| --- | --- | --- | --- |
| deploy-diagnosis-image | Public nginx image tag does not exist; manifest unknown | image-manifest | Pass |
| deploy-diagnosis-yaml | Unterminated Compose YAML flow sequence | compose-yaml | Pass |
| deploy-diagnosis-exit137 | Inline Dockerfile runs `exit 137` | out-of-memory | Pass |

For each failed deployment the script asserted:

- The live diagnosis API returned the expected rule and at most three log lines.
- The Overview drawer and failed Deploys row displayed the diagnosis.
- The fix link opened and selected the Compose tab.

No browser page errors occurred. Nine PNGs show Overview, Deploys, and the fix
destination for each fixture. `deploy-diagnosis.mp4` is the 16.88-second H.264
screen recording (1440 × 900). `results.json` contains the actual API responses;
the three `.log` files contain the real Dokploy deployment build logs.

Commands (all exited 0):

```sh
node --check /workspace/sy-codex-notes/fix/deploy-diagnosis-proof/proof.mjs
BASE=http://127.0.0.1:3033 node /workspace/sy-codex-notes/fix/deploy-diagnosis-proof/proof.mjs create
BASE=http://127.0.0.1:3033 node /workspace/sy-codex-notes/fix/deploy-diagnosis-proof/proof.mjs capture
BASE=http://127.0.0.1:3033 node /workspace/sy-codex-notes/fix/deploy-diagnosis-proof/proof.mjs cleanup
BASE=http://127.0.0.1:3033 node /workspace/sy-codex-notes/fix/deploy-diagnosis-proof/proof.mjs verify-cleanup
```

Cleanup verification confirmed all three service IDs and the project ID were
absent from the Dokploy project tree. Identity and deletion timestamps are in
`resources.json`. No pre-existing app was changed or removed.

Limitations: exit 137 was intentionally produced by a build command; actual
memory exhaustion was not induced. These three Compose cases prove live wiring
and navigation; other rule families are covered by repository unit tests.
Diagnosis reads the last 10,000 deployment build-log lines, so an earlier failure
outside that tail is not examined.
