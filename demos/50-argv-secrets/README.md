# #50 — Keep secrets out of docker/sudo argv (C-P1-3)

PR: https://github.com/sbdeals/Switchyard/pull/50 · branch `codex/argv-secrets`

This is a non-UI change, so the demo is terminal output.

| File | What it shows |
|---|---|
| `before.txt` / `after.txt` | `argv-secrets-demo.mjs` run against the **built** CLI (main `1fc46d5` vs branch). Fake docker/sudo shims record argv and env names; all credentials are synthetic. **Before:** admin password, session secret and store password are all in the `docker run` argv, and the store password is in the `sudo` argv. **After:** none of them appear; the docker child gets them as env, and sudo gets only `SWITCHYARD_ENV_FILE=<0600 temp file>`. |
| `live-docker-check.sh` / `.txt` | Real Docker on the bridge VM. main's `-e NAME=value` puts the secret in argv. The branch's `-e NAME` and name-only `--env-file` keep it out, and the container still receives the correct value. |
