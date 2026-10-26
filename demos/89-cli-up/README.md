# `switchyard deploy`: deploy a local directory (Railway `up` equivalent, RAILWAY-GAP #6)

Branch `codex/cli-up` (base `main`). This is a non-UI change, so the evidence is terminal output.

`switchyard up` already means "install/converge the stack", so the Railway-style `up` ships as **`switchyard deploy [path] --service --project --detach`**.

- **before.txt:** on `main` (1fc46d5), the CLI has no deploy command.
- **after.txt:** `switchyard deploy --help` lists the new command.
- **after-proof.txt:** a live run against the local Dokploy, on a throwaway `cli-up-*` project:
  1. it packs 3 files into a 421 B ZIP;
  2. it creates the project and app;
  3. `application.dropDeployment` uploads the ZIP;
  4. it polls the deployment.

  The Docker build **succeeds**. The final rollout fails with Dokploy's `503 This node is not a swarm manager`, because this VM is intentionally not a swarm and native app deploys need one. Afterwards the throwaway project, app and images were removed through the API.

Packing:
- respects `.gitignore` and `.dockerignore`;
- always skips `.git` and `node_modules`;
- caps uploads at 100 MiB.

Checks: typecheck passes, and node:test passes 79/79.
