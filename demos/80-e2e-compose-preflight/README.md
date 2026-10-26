# Compose preflight

Throwaway app compose-5ntm on the local test stack (:3005). The deployment count comes from the Dokploy DB.

| step | before (main-1fc46d5) | after (codex/e2e-compose-preflight) |
|---|---|---|
| Save, invalid YAML | no message; deployments 0 → 0 | "Saved as draft. Invalid YAML at line 3, column 1…"; 2 → 2 |
| Save & deploy, invalid YAML | no message; **deployment started** 0 → 1 | blocked with the YAML error; 2 → 2 |
| Save & deploy, `services: []` | **deployment started** 1 → 2 | "Cannot deploy: … top-level services mapping"; 2 → 2 |
| restore the original file | saved | saved; file verified identical |

Files: before.mp4, after.mp4, before-*.png, after-*.png, before.txt, after.txt. Script: demo-tools/cp.mjs `<label> <out>`.
