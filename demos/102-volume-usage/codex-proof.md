# Volume usage proof

Local dashboard built from `/workspace/wt-volume-usage` and served on port 3034.

- `service-volume-50-mib.png`: Compose-declared named volume shows **50 MiB on disk**.
- `dokploy-mount-50-mib.png`: Dokploy mount `volume-usage-data` matches Docker's prefixed `volume-usage-proof-4cr4uk_volume-usage-data`, still **50 MiB** and displayed once.
- `project-total-50-mib.png`: project total is **50 MiB**.
- Docker `GET /system/df?type=volume` reported **52,428,800 bytes**. The fixture's `dd` output also reported 52,428,800 bytes.
- `compose.yml` contains the one-shot 50 MiB write followed by an idle process; it publishes no ports.

Checks passed:

```sh
cd /workspace/wt-volume-usage/dashboard && npm run lint && npx tsc --noEmit && npx vitest run
```

62 tests passed in 3 files. `git diff --check` passed.

Build/start passed:

```sh
sudo docker build -q -t switchyard-dash:volume-usage dashboard && /tmp/runsy.sh sy-volume-usage 3034 volume-usage
```

The first fixture attempt hit a transient shared-VM inode exhaustion and wrote no data. It was deleted with its volume through `compose.delete` before retrying. The successful fixture used explicit `volume-usage-*` names. `cleanup.json` records deletion of the successful Compose and project through Dokploy, with `deleteVolumes: true`. Read-only Docker checks confirmed both attempts' containers and volumes were absent afterwards. The dashboard launcher container `sy-volume-usage` and its session-created data volume were also removed after proof.

Limitations: reads the dashboard's local Docker socket. Compose-only discovery depends on Compose labels; external/unlabelled volumes require Dokploy mount records. Usage is cached per server process for 30 seconds and refreshes on the next page/tab load. Mount enumeration adds read requests during workspace loading.

No source commits, lockfile changes, production access, or prune calls.
